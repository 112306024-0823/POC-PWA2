@echo off
echo 啟動 PWA 應用程式...
echo.

echo 1. 啟動後端伺服器...
start "Backend Server" cmd /k "cd backend & node server.js"

echo 2. 等待後端啟動...
timeout /t 3 /nobreak > nul

echo 3. 啟動前端 PWA...
start "Frontend PWA" cmd /k "npx quasar dev -m pwa"

echo.
echo PWA 應用程式已啟動！
echo 後端: http://localhost:3001
echo 前端: http://localhost:9201
echo.
pause
