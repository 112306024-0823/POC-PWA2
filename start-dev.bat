@echo off
echo 正在啟動 PWA 員工管理系統...
echo.

REM 檢查 Node.js 是否安裝
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo 錯誤：未找到 Node.js，請先安裝 Node.js
    pause
    exit /b 1
)

echo 1. 啟動後端服務器...
cd backend
start "後端服務器" cmd /k "npm run dev"
cd ..

echo 2. 等待 3 秒後啟動前端...
timeout /t 3 /nobreak >nul

echo 3. 啟動前端開發服務器...
start "前端開發服務器" cmd /k "npm run dev"

echo.
echo ✅ 系統已啟動！
echo.
echo 📊 前端應用：http://localhost:9000
echo 🔌 後端 API：http://localhost:3001
echo.
echo 按任意鍵關閉此視窗...
pause >nul 