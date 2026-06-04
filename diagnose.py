import os
import sys
import subprocess
import json
import traceback

report_path = "diagnostics_report.txt"

def log(msg, to_file_only=False):
    if not to_file_only:
        print(msg)
    with open(report_path, "a", encoding="utf-8") as f:
        f.write(msg + "\n")

# Clear old report
if os.path.exists(report_path):
    os.remove(report_path)

log("===================================================")
log("             RzVid DIAGNOSTICS REPORT              ")
log("===================================================\n")

# 1. Environment Details
log("--- 1. ENVIRONMENT DETAILS ---")
log(f"Python Version: {sys.version}")
log(f"Platform: {sys.platform}")
log(f"Current Directory: {os.getcwd()}")
log(f"Executable: {sys.executable}\n")

# 2. Imports Check
log("--- 2. IMPORTING LIBRARIES ---")
libs = ["fastapi", "uvicorn", "yt_dlp", "static_ffmpeg", "aiofiles", "curl_cffi", "yt_dlp_ejs"]
for lib in libs:
    try:
        __import__(lib)
        log(f"  [OK] {lib} imported successfully.")
    except Exception as e:
        log(f"  [FAIL] {lib} failed to import: {e}")
log("")

# 3. FFmpeg Initialization & Execution Test
log("--- 3. FFMPEG BINARY TEST ---")
try:
    import static_ffmpeg
    log("  Initializing static-ffmpeg...")
    static_ffmpeg.add_paths()
    log("  static-ffmpeg paths added to PATH.")
    
    # Try calling ffmpeg
    try:
        res = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True, check=True)
        first_line = res.stdout.split("\n")[0] if res.stdout else "No output"
        log(f"  [OK] FFmpeg works! Version info: {first_line}")
    except Exception as e:
        log(f"  [FAIL] FFmpeg execution failed: {e}")
        log(traceback.format_exc(), to_file_only=True)
except Exception as e:
    log(f"  [FAIL] static-ffmpeg module error: {e}")
    log(traceback.format_exc(), to_file_only=True)
log("")

# 4. Network Connectivity Test
log("--- 4. NETWORK CONNECTIVITY ---")
import urllib.request
urls_to_test = {
    "Google": "https://www.google.com",
    "YouTube": "https://www.youtube.com",
    "TikTok": "https://www.tiktok.com"
}
for name, url in urls_to_test.items():
    try:
        req = urllib.request.Request(
            url, 
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'}
        )
        with urllib.request.urlopen(req, timeout=5) as response:
            log(f"  [OK] Successfully connected to {name} (Status: {response.status})")
    except Exception as e:
        log(f"  [FAIL] Connection to {name} failed: {e}")
log("")

# 5. yt-dlp Extraction Test
log("--- 5. YT-DLP EXTRACTION TESTS ---")
try:
    import yt_dlp
    from backend.downloader import get_ydl_opts
    
    # YouTube Test
    yt_url = "https://www.youtube.com/watch?v=jNQXAC9IVRw"
    log(f"  Testing YouTube extraction on: {yt_url}")
    try:
        ydl_opts = get_ydl_opts({'extract_flat': False})
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(yt_url, download=False)
            log(f"    [OK] YouTube extractor succeeded. Video title: '{info.get('title')}'")
    except Exception as e:
        log(f"    [FAIL] YouTube extractor failed: {e}")
        log(traceback.format_exc(), to_file_only=True)
        
    # TikTok Test
    tiktok_url = "https://www.tiktok.com/@tiktok/video/7106194347530603822"
    log(f"  Testing TikTok extraction on: {tiktok_url}")
    try:
        ydl_opts = get_ydl_opts({'extract_flat': False})
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(tiktok_url, download=False)
            log(f"    [OK] TikTok extractor succeeded. Video title: '{info.get('title')}'")
    except Exception as e:
        log(f"    [FAIL] TikTok extractor failed: {e}")
        log(traceback.format_exc(), to_file_only=True)
except Exception as e:
    log(f"  [FAIL] Failed during yt-dlp test setup: {e}")
    log(traceback.format_exc(), to_file_only=True)

log("\n===================================================")
log("              DIAGNOSTICS COMPLETED                ")
log("===================================================")
print("\nDiagnostics report written to 'diagnostics_report.txt'")
