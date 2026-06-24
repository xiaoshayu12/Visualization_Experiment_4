@echo off
cd /d "%~dp0"
title 启动器

echo ================================================
echo   全球海洋大气耦合时空可视分析系统
echo ================================================
echo.
echo   正在启动后端...
echo.
echo   后端 API  : http://localhost:5000
echo   王哲界面   : http://localhost:5000/
echo   程传哲界面 : http://localhost:5000/members/cheng/
echo   刘国宁界面 : http://localhost:5000/members/liu/
echo   许一凡界面 : http://localhost:5000/members/xu/
echo.
echo   5 秒后将自动打开浏览器...
echo   关闭后端窗口即可停止服务。
echo ================================================
echo.

:: 在新窗口中启动 Python 后端
start "全球海洋大气耦合后端" python backend\app.py

:: 等待服务就绪
timeout /t 5 /nobreak >nul

:: 打开浏览器
start "" http://127.0.0.1:5000/

echo 浏览器已打开，按任意键关闭此窗口...
pause >nul
