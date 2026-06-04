@echo off
title RzVid Downloader Launcher
echo ===================================================
echo             RzVid Downloader Launcher
echo ===================================================
echo.

:: Check if Python is installed
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in PATH.
    echo Vui long tai va cai dat Python tu: https://www.python.org/downloads/
    echo hay tick chon "Add Python to PATH" khi cai dat.
    echo.
    pause
    exit /b 1
)

:: Create Virtual Environment if not exists
if not exist ".venv" (
    echo [INFO] Dang tao moi truong ao (Virtual Environment)...
    python -m venv .venv
    if %errorlevel% neq 0 (
        echo [ERROR] Khong the tao Virtual Environment.
        pause
        exit /b 1
    )
    echo [INFO] Da tao Virtual Environment thanh cong.
    echo.
)

:: Activate Virtual Environment
echo [INFO] Dang kich hoat moi truong ao...
call .venv\Scripts\activate
if %errorlevel% neq 0 (
    echo [ERROR] Khong the kich hoat Virtual Environment.
    pause
    exit /b 1
)
echo.

:: Install dependencies
echo [INFO] Dang kiem tra va cai dat cac goi thu vien can thiet...
echo [INFO] Qua trinh nay co the mat vai phut trong lan chay dau tien.
python -m pip install --upgrade pip
pip install -r backend/requirements.txt
if %errorlevel% neq 0 (
    echo [ERROR] Cai dat thu vien that bai. Vui long kiem tra ket noi mang.
    pause
    exit /b 1
)
echo [INFO] Thu vien da duoc cai dat day du.
echo.

:: The web browser is opened automatically by the FastAPI python server on startup

:: Start FastAPI server using uvicorn
echo [INFO] Dang khoi chay may chu RzVid...
echo [INFO] De dung may chu, nhan to hop phim Ctrl+C hoac dong cua so nay.
echo.
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000

pause
