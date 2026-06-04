import os
import re
import uuid
import yt_dlp
import static_ffmpeg
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize static-ffmpeg to ensure ffmpeg is in PATH
try:
    logger.info("Initializing static-ffmpeg...")
    static_ffmpeg.add_paths()
    logger.info("static-ffmpeg initialized successfully.")
except Exception as e:
    logger.error(f"Error initializing static-ffmpeg: {e}")

def get_clean_title(title):
    # Keep only alphanumeric, spaces, and hyphens/underscores to avoid file path errors
    clean = re.sub(r'[^\w\s-]', '', title)
    return re.sub(r'[-\s]+', '_', clean).strip().strip('_')

def get_ydl_opts(extra_opts=None):
    """
    Builds a robust configuration for yt-dlp, applying connection timeouts,
    limited retries, and browser TLS impersonation to prevent bot blocking.
    """
    opts = {
        'quiet': True,
        'no_warnings': True,
        'socket_timeout': 15,
        'retries': 3,
        'fragment_retries': 3,
    }
    
    # Check for cookies file to bypass bot verification (Sign in to confirm you're not a bot)
    possible_cookie_files = [
        os.path.join(os.path.dirname(__file__), "cookies.txt"),
        os.path.join(os.path.dirname(__file__), "..", "cookies.txt"),
        os.path.join(os.path.dirname(__file__), "youtube-cookies.txt"),
        os.path.join(os.path.dirname(__file__), "..", "youtube-cookies.txt"),
    ]
    for cookie_path in possible_cookie_files:
        if os.path.exists(cookie_path):
            # On Vercel/read-only environments, copy cookies to /tmp so yt-dlp can write/update it without crashing
            if os.environ.get("VERCEL") or not os.access(cookie_path, os.W_OK):
                import shutil
                tmp_cookie_path = "/tmp/cookies.txt"
                try:
                    shutil.copy2(cookie_path, tmp_cookie_path)
                    opts['cookiefile'] = tmp_cookie_path
                    logger.info(f"Copied read-only cookies file to writable path: {tmp_cookie_path}")
                except Exception as e:
                    logger.error(f"Failed to copy cookies file to /tmp: {e}")
                    opts['cookiefile'] = os.path.abspath(cookie_path)
            else:
                opts['cookiefile'] = os.path.abspath(cookie_path)
                logger.info(f"Using writable cookies file: {cookie_path}")
            break

    # Optimize extractor args to rotate player clients and avoid simple bot flags
    opts['extractor_args'] = {
        'youtube': {
            'player_client': ['ios', 'web', 'mweb', 'android']
        }
    }

    # Try using Chrome TLS impersonation via curl_cffi to bypass scraper blocklists
    try:
        from yt_dlp.networking.impersonate import ImpersonateTarget
        opts['impersonate'] = ImpersonateTarget.from_str('chrome-110:windows-10')
    except Exception:
        # Fallback to standard request headers
        opts['http_headers'] = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        }
        
    if extra_opts:
        opts.update(extra_opts)
    return opts

def get_video_info(url: str):
    """
    Extracts metadata and available download resolutions from the given URL.
    """
    ydl_opts = get_ydl_opts({'extract_flat': False})
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
            # Basic metadata
            title = info.get('title', 'Video')
            thumbnail = info.get('thumbnail')
            # If thumbnail is not direct or empty, check thumbnails list
            if not thumbnail and info.get('thumbnails'):
                thumbnail = info['thumbnails'][-1].get('url')
                
            duration = info.get('duration', 0)
            extractor = info.get('extractor_key', 'Generic').lower()
            
            # Process formats to find available resolutions
            formats = info.get('formats', [])
            resolutions = set()
            has_video = False
            has_audio = False
            
            for f in formats:
                # Check for video streams
                if f.get('vcodec') != 'none':
                    has_video = True
                    height = f.get('height')
                    if height:
                        resolutions.add(height)
                # Check for audio streams
                if f.get('acodec') != 'none':
                    has_audio = True
            
            # Sort resolutions descending (e.g., 2160, 1080, 720, 480...)
            sorted_resolutions = sorted(list(resolutions), reverse=True)
            
            # Prepare options list for the user
            download_options = []
            
            # Add video quality options
            for res in sorted_resolutions:
                # Human readable label
                label = f"{res}p"
                if res >= 2160:
                    label = f"{res}p (4K UHD)"
                elif res >= 1440:
                    label = f"{res}p (2K QHD)"
                elif res >= 1080:
                    label = f"{res}p (Full HD)"
                elif res >= 720:
                    label = f"{res}p (HD)"
                
                download_options.append({
                    "id": f"video_{res}",
                    "label": label,
                    "resolution": res,
                    "type": "video",
                    "ext": "mp4" # We will force mp4 output
                })
                
            # If no specific heights were found, but there are video streams, add a default best video option
            if has_video and not download_options:
                download_options.append({
                    "id": "video_best",
                    "label": "Tải Video (Chất lượng tốt nhất)",
                    "resolution": None,
                    "type": "video",
                    "ext": "mp4"
                })
                
            # Add audio-only option if any audio stream exists
            if has_audio or has_video:
                download_options.append({
                    "id": "audio_mp3",
                    "label": "Tải Âm thanh (MP3 chất lượng cao)",
                    "resolution": None,
                    "type": "audio",
                    "ext": "mp3"
                })
                
            return {
                "success": True,
                "title": title,
                "thumbnail": thumbnail,
                "duration": duration,
                "extractor": extractor,
                "options": download_options
            }
            
    except Exception as e:
        logger.error(f"Error extracting video info: {e}")
        return {
            "success": False,
            "error": str(e)
        }

def download_media(url: str, option_id: str, output_dir: str, progress_hook=None):
    """
    Downloads media from URL based on option_id and saves it in output_dir.
    Returns the absolute path to the downloaded file.
    """
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
        
    # Parse option_id
    # option_id can be "video_1080", "video_720", "video_best", "audio_mp3"
    is_audio = option_id.startswith("audio_")
    
    # Generate a unique temp name to avoid conflicts, but keep the original title for the final file
    temp_id = str(uuid.uuid4())
    
    ydl_opts = get_ydl_opts({
        'outtmpl': os.path.join(output_dir, f'{temp_id}.%(ext)s'),
    })
    
    if progress_hook:
        ydl_opts['progress_hooks'] = [progress_hook]
        
    if is_audio:
        # Download best audio and convert to mp3
        ydl_opts.update({
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
        })
    else:
        # Download video
        # Check if option_id specifies a resolution
        res_match = re.match(r'video_(\d+)', option_id)
        if res_match:
            height = res_match.group(1)
            # Try to get the specific video height + best audio, merge to mp4
            # Fall back to best pre-merged if it fails
            ydl_opts.update({
                'format': f'bestvideo[height={height}]+bestaudio/best[height={height}]/bestvideo[height<={height}]+bestaudio/best',
                'merge_output_format': 'mp4',
            })
        else:
            # Best quality
            ydl_opts.update({
                'format': 'bestvideo+bestaudio/best',
                'merge_output_format': 'mp4',
            })
            
    try:
        # Get title first to name the final file nicely
        info_opts = get_ydl_opts()
        with yt_dlp.YoutubeDL(info_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            title = info.get('title', 'Video')
            clean_title = get_clean_title(title)
            
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info_dict = ydl.extract_info(url, download=True)
            # Find the downloaded file
            # Since yt-dlp might have postprocessed it (e.g. merged to mp4 or extracted mp3),
            # let's look for files starting with our temp_id in the output directory.
            downloaded_file = None
            ext = "mp3" if is_audio else "mp4"
            
            # Check if ydl returned the filepath in the info_dict
            if 'requested_downloads' in info_dict:
                for d in info_dict['requested_downloads']:
                    if os.path.exists(d.get('filepath', '')):
                        downloaded_file = d['filepath']
                        break
                        
            if not downloaded_file or not os.path.exists(downloaded_file):
                # Search directory
                for filename in os.listdir(output_dir):
                    if filename.startswith(temp_id):
                        downloaded_file = os.path.join(output_dir, filename)
                        break
            
            if downloaded_file and os.path.exists(downloaded_file):
                # Rename the file to a user-friendly name while preserving extension
                file_ext = os.path.splitext(downloaded_file)[1]
                if not file_ext:
                    file_ext = f".{ext}"
                
                final_filename = f"{clean_title}{file_ext}"
                final_path = os.path.join(output_dir, final_filename)
                
                # If file exists, add a suffix
                counter = 1
                while os.path.exists(final_path):
                    final_filename = f"{clean_title}_{counter}{file_ext}"
                    final_path = os.path.join(output_dir, final_filename)
                    counter += 1
                    
                os.rename(downloaded_file, final_path)
                return {
                    "success": True,
                    "filepath": final_path,
                    "filename": final_filename
                }
            else:
                return {
                    "success": False,
                    "error": "Could not locate downloaded file."
                }
                
    except Exception as e:
        logger.error(f"Download error: {e}")
        return {
            "success": False,
            "error": str(e)
        }
