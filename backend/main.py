import os
import time
import uuid
import threading
import logging
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from .downloader import get_video_info, download_media, get_clean_title

from contextlib import asynccontextmanager

# Configure logging: Only use StreamHandler on serverless/Vercel environments to prevent PermissionError
log_handlers = [logging.StreamHandler()]
if not os.environ.get("VERCEL"):
    try:
        LOG_FILE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "server.log"))
        log_handlers.append(logging.FileHandler(LOG_FILE, encoding='utf-8'))
    except Exception as e:
        print(f"Could not setup FileHandler for logging: {e}")

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    handlers=log_handlers
)
logger = logging.getLogger("RzVid")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Auto-open default web browser on startup only on local environments
    if not os.environ.get("VERCEL"):
        import webbrowser
        def open_browser():
            time.sleep(1.5) # Wait for Uvicorn to bind to port 8000
            try:
                logger.info("Auto-opening default browser to http://127.0.0.1:8000")
                webbrowser.open("http://127.0.0.1:8000")
            except Exception as e:
                logger.error(f"Failed to auto-open browser: {e}")
                
        threading.Thread(target=open_browser, daemon=True).start()
    yield

app = FastAPI(title="RzVid API", version="1.0.0", lifespan=lifespan)

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if os.environ.get("VERCEL"):
    DOWNLOADS_DIR = "/tmp/downloads"
else:
    DOWNLOADS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "downloads"))

os.makedirs(DOWNLOADS_DIR, exist_ok=True)
FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))

# Global task state
DOWNLOAD_TASKS = {}
tasks_lock = threading.Lock()

class InfoRequest(BaseModel):
    url: str

class DownloadRequest(BaseModel):
    url: str
    option_id: str

def remove_file(filepath: str):
    """Safely removes a file from disk."""
    try:
        if os.path.exists(filepath):
            os.remove(filepath)
            print(f"Cleaned up temporary file: {filepath}")
    except Exception as e:
        print(f"Error removing file {filepath}: {e}")

def cleanup_old_files():
    """Deletes files and clears task states older than 15 minutes."""
    # 1. Clean files on disk
    if os.path.exists(DOWNLOADS_DIR):
        now = time.time()
        for filename in os.listdir(DOWNLOADS_DIR):
            filepath = os.path.join(DOWNLOADS_DIR, filename)
            if os.path.isfile(filepath) and os.path.getmtime(filepath) < now - 900:
                remove_file(filepath)
                
    # 2. Clean task states in memory
    with tasks_lock:
        now = time.time()
        expired_tasks = []
        for tid, task in DOWNLOAD_TASKS.items():
            t_time = task.get("timestamp", 0)
            if now - t_time > 900:
                expired_tasks.append(tid)
        for tid in expired_tasks:
            DOWNLOAD_TASKS.pop(tid, None)

def bg_download_thread(task_id: str, url: str, option_id: str):
    """Background worker that handles the download process using yt-dlp."""
    with tasks_lock:
        DOWNLOAD_TASKS[task_id] = {
            "status": "downloading",
            "progress": 0.0,
            "speed": "0 KB/s",
            "eta": "Đang chuẩn bị...",
            "filename": None,
            "filepath": None,
            "error": None,
            "timestamp": time.time()
        }

    def progress_hook(d):
        with tasks_lock:
            if task_id not in DOWNLOAD_TASKS:
                return
                
            if d['status'] == 'downloading':
                total = d.get('total_bytes') or d.get('total_bytes_estimate') or 0
                downloaded = d.get('downloaded_bytes') or 0
                if total > 0:
                    pct = (downloaded / total) * 100
                    DOWNLOAD_TASKS[task_id]["progress"] = round(pct, 1)
                
                speed = d.get('speed')
                if speed:
                    if speed > 1024 * 1024:
                        DOWNLOAD_TASKS[task_id]["speed"] = f"{speed / (1024*1024):.1f} MB/s"
                    else:
                        DOWNLOAD_TASKS[task_id]["speed"] = f"{speed / 1024:.1f} KB/s"
                        
                eta = d.get('eta')
                if eta is not None:
                    DOWNLOAD_TASKS[task_id]["eta"] = f"{eta} giây"
                    
            elif d['status'] == 'finished':
                DOWNLOAD_TASKS[task_id]["status"] = "merging"
                DOWNLOAD_TASKS[task_id]["progress"] = 99.0
                DOWNLOAD_TASKS[task_id]["speed"] = "Đang xử lý..."
                DOWNLOAD_TASKS[task_id]["eta"] = "Đang gộp file/Chuyển đổi âm thanh..."

    try:
        res = download_media(url, option_id, DOWNLOADS_DIR, progress_hook=progress_hook)
        
        with tasks_lock:
            if task_id in DOWNLOAD_TASKS:
                if res["success"]:
                    DOWNLOAD_TASKS[task_id].update({
                        "status": "completed",
                        "progress": 100.0,
                        "filename": res["filename"],
                        "filepath": res["filepath"]
                    })
                else:
                    DOWNLOAD_TASKS[task_id].update({
                        "status": "failed",
                        "error": res.get("error", "Lỗi tải video thất bại.")
                    })
    except Exception as e:
        logger.exception(f"Unexpected error in background download for task {task_id}: {e}")
        with tasks_lock:
            if task_id in DOWNLOAD_TASKS:
                DOWNLOAD_TASKS[task_id].update({
                    "status": "failed",
                    "error": str(e)
                })

@app.post("/api/info")
def get_info(req: InfoRequest):
    """Retrieves video metadata and options."""
    logger.info(f"Retrieving info for URL: {req.url}")
    # Clean up old files on new requests
    cleanup_old_files()
    
    if not req.url:
        logger.warning("Empty URL provided")
        raise HTTPException(status_code=400, detail="URL cannot be empty")
        
    result = get_video_info(req.url)
    if not result["success"]:
        err_msg = result.get("error", "Không thể lấy thông tin video. Vui lòng kiểm tra lại đường dẫn.")
        logger.error(f"Error fetching info: {err_msg}")
        raise HTTPException(status_code=400, detail=err_msg)
        
    logger.info(f"Successfully retrieved info for: {result.get('title')}")
    return result

@app.post("/api/download")
def start_download(req: DownloadRequest):
    """Starts the download process in the background and returns a task ID."""
    logger.info(f"Download request: URL={req.url}, Option={req.option_id}")
    cleanup_old_files()
    
    if not req.url or not req.option_id:
        logger.warning("Missing url or option_id")
        raise HTTPException(status_code=400, detail="Missing required parameters")
        
    task_id = str(uuid.uuid4())
    
    # Start download in a separate daemon thread
    thread = threading.Thread(
        target=bg_download_thread,
        args=(task_id, req.url, req.option_id),
        daemon=True
    )
    thread.start()
    logger.info(f"Started background download task: ID={task_id}")
    return {"success": True, "task_id": task_id}

@app.get("/api/progress/{task_id}")
def get_progress(task_id: str):
    """Returns the progress of the specified download task."""
    with tasks_lock:
        task = DOWNLOAD_TASKS.get(task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        return task

@app.get("/api/retrieve/{task_id}")
def retrieve_file(task_id: str):
    """Serves the downloaded file. File cleanup is handled periodically by cleanup_old_files."""
    logger.info(f"Retrieving file for task ID: {task_id}")
    with tasks_lock:
        task = DOWNLOAD_TASKS.get(task_id)
        if not task:
            logger.warning(f"Task ID {task_id} not found for retrieval")
            raise HTTPException(status_code=404, detail="Không tìm thấy tiến trình tải.")
            
        if task["status"] != "completed":
            logger.warning(f"Task ID {task_id} status is {task['status']}, not completed")
            raise HTTPException(status_code=400, detail="Tiến trình tải chưa hoàn thành.")
            
        filepath = task["filepath"]
        filename = task["filename"]
        
    if not os.path.exists(filepath):
        logger.error(f"Downloaded file not found on disk: {filepath}")
        raise HTTPException(status_code=404, detail="Tệp tin không tồn tại trên hệ thống.")
        
    # Encode filename properly for Content-Disposition header
    import urllib.parse
    encoded_filename = urllib.parse.quote(filename)
    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"
    }
    
    logger.info(f"Serving file: {filename} ({filepath})")
    return FileResponse(
        path=filepath,
        media_type="application/octet-stream",
        headers=headers
    )

# Serve Frontend static files
if os.path.exists(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
else:
    # Fallback endpoint if Frontend folder is missing during initialization
    @app.get("/")
    def index():
        return JSONResponse({"status": "Frontend directory is missing. Please create it."})
