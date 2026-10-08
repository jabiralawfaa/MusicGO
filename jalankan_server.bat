@echo off
setlocal enabledelayedexpansion

:: Cek apakah Python sudah terinstall
python --version >nul 2>&1
if %errorlevel% equ 0 (
    echo [INFO] Python sudah terinstall. Menjalankan HTTP Server...
    python -m http.server
    goto end
)

echo [WARNING] Python tidak ditemukan. Memulai unduhan otomatis versi terbaru...

:: Mengunduh installer Python terbaru untuk Windows (64-bit) menggunakan PowerShell
set "URL=https://www.python.org/ftp/python/3.12.2/python-3.12.2-amd64.exe"
set "INSTALLER=%temp%\python_installer.exe"

echo [INFO] Mengunduh installer dari %URL%...
powershell -Command "Invoke-WebRequest -Uri '%URL%' -OutFile '%INSTALLER%'"

if not exist "%INSTALLER%" (
    echo [ERROR] Gagal mengunduh installer Python.
    goto error
)

echo [INFO] Menginstall Python secara senyap (Silent Install)...
echo Silakan tunggu beberapa saat...
start /wait "" "%INSTALLER%" /quiet InstallAllUsers=1 PrependPath=1 Include_test=0

:: Bersihkan file installer setelah selesai
del "%INSTALLER%"

:: Refresh environment variables tanpa restart cmd
call :refresh_env

:: Cek kembali setelah instalasi
python --version >nul 2>&1
if %errorlevel% equ 0 (
    echo [SUCCESS] Python berhasil diinstall. Menjalankan HTTP Server...
    python -m http.server
) else (
    echo [ERROR] Instalasi selesai tetapi Python tetap tidak terdeteksi. 
    echo Harap buka ulang command prompt ini atau restart PC Anda.
    goto error
)

goto end

:refresh_env
for /f "tokens=2*" %%a in ('reg query "HKLM\System\CurrentControlSet\Control\Session Manager\Environment" /v Path') do set "syspath=%%b"
for /f "tokens=2*" %%a in ('reg query "HKCU\Environment" /v Path') do set "userpath=%%b"
set "Path=%syspath%;%userpath%"
goto :eof

:error
pause
:end
pause
