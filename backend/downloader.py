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

def ensure_js_runtime():
    """
    Ensures that a supported JS runtime (deno, node, qjs, bun) is available in PATH.
    If none is found globally, looks for a local deno binary in backend/bin.
    If that is also missing, downloads Deno from GitHub and extracts it.
    Finally, appends the local bin folder to the process PATH.
    """
    import shutil
    import platform
    import urllib.request
    import zipfile
    
    # 1. Check if a global JS runtime is already in PATH
    for runtime in ['deno', 'node', 'qjs', 'bun']:
        if shutil.which(runtime):
            logger.info(f"Found global JS runtime: {runtime}")
            return
            
    # 2. Check the local bin directory
    bin_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "bin"))
    os.makedirs(bin_dir, exist_ok=True)
    
    system = platform.system().lower()
    is_windows = system == "windows"
    
    binary_name = "deno.exe" if is_windows else "deno"
    local_binary = os.path.join(bin_dir, binary_name)
    
    # Add local bin to PATH early so subsequent checks find it
    if bin_dir not in os.environ.get("PATH", ""):
        os.environ["PATH"] = bin_dir + os.pathsep + os.environ.get("PATH", "")
        
    if os.path.exists(local_binary):
        logger.info(f"Found local JS runtime at: {local_binary}")
        return

    # On Vercel, check if we need to redirect to writable /tmp
    if os.environ.get("VERCEL"):
        # Vercel should have Node.js globally, so we shouldn't hit this.
        # But if we do, use /tmp since the filesystem is read-only.
        bin_dir = "/tmp/bin"
        os.makedirs(bin_dir, exist_ok=True)
        local_binary = os.path.join(bin_dir, binary_name)
        if bin_dir not in os.environ.get("PATH", ""):
            os.environ["PATH"] = bin_dir + os.pathsep + os.environ.get("PATH", "")
        if os.path.exists(local_binary):
            return

    logger.info("No JS runtime found. Automatically downloading portable Deno for YouTube challenge solving...")
    
    # Determine the download URL based on OS and architecture
    if is_windows:
        url = "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip"
    elif system == "darwin":
        machine = platform.machine().lower()
        if "arm" in machine or "aarch" in machine:
            url = "https://github.com/denoland/deno/releases/latest/download/deno-aarch64-apple-darwin.zip"
        else:
            url = "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-apple-darwin.zip"
    else:
        machine = platform.machine().lower()
        if "arm" in machine or "aarch" in machine:
            url = "https://github.com/denoland/deno/releases/latest/download/deno-aarch64-unknown-linux-gnu.zip"
        else:
            url = "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip"
            
    zip_path = os.path.join(bin_dir, "deno.zip")
    try:
        logger.info(f"Downloading Deno from {url}...")
        # Use a user agent to prevent download blocks
        req = urllib.request.Request(
            url, 
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        )
        with urllib.request.urlopen(req) as response, open(zip_path, 'wb') as out_file:
            out_file.write(response.read())
            
        logger.info("Extracting Deno...")
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(bin_dir)
            
        # Clean up ZIP file
        if os.path.exists(zip_path):
            os.remove(zip_path)
            
        # Set executable permission for Unix systems
        if not is_windows and os.path.exists(local_binary):
            os.chmod(local_binary, 0o755)
            
        logger.info("Deno JS runtime configured successfully.")
    except Exception as e:
        logger.error(f"Failed to auto-download Deno: {e}")

# Run JS runtime check/download on module import
ensure_js_runtime()

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
