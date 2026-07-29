@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title FilmManager — 一键构建 Windows 安装包

echo.
echo =============================================
echo   FilmManager 一键构建工具 (Windows)
echo =============================================
echo.

:: ── 检查 Node.js ─────────────────────────────
node --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请安装 Node.js 20 LTS
    echo   下载: https://nodejs.org/
    pause & exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo [OK] Node.js %NODE_VER%

:: ── 检查 Python（node-gyp 需要）─────────────
python --version >nul 2>&1
if errorlevel 1 (
    python3 --version >nul 2>&1
    if errorlevel 1 (
        echo [警告] 未检测到 Python，若原生模块编译失败请安装 Python 3.x
        echo   下载: https://www.python.org/
    )
)

echo.
echo [1/4] 安装依赖（含原生模块重编）...
echo       此步骤会自动为 Electron 重编 better-sqlite3 和 sharp
call npm install
if errorlevel 1 (
    echo.
    echo [错误] npm install 失败
    echo   常见原因:
    echo     1. 网络问题 - 检查代理或使用镜像: npm config set registry https://registry.npmmirror.com
    echo     2. Python/C++ 编译工具缺失 - 运行: npm install -g windows-build-tools
    echo     3. 权限问题 - 以管理员身份运行此脚本
    pause & exit /b 1
)

echo.
echo [2/4] 编译 TypeScript / 前端资源...
call npx electron-vite build
if errorlevel 1 (
    echo [错误] 编译失败，请检查上方错误信息
    pause & exit /b 1
)

echo.
echo [3/4] 打包 Windows 安装程序 (NSIS x64)...
call npx electron-builder --win --x64
if errorlevel 1 (
    echo [错误] electron-builder 打包失败
    echo   常见原因:
    echo     1. 原生模块未正确编译 (better-sqlite3 / sharp)
    echo     2. 缺少 NSIS - electron-builder 会自动下载，确保网络畅通
    pause & exit /b 1
)

echo.
echo =============================================
echo   ✓ 构建成功！
echo =============================================
echo.
echo   安装包位于 dist-electron\ 目录:
echo.
dir /b "dist-electron\*.exe" 2>nul
echo.
echo   将 .exe 文件复制到目标 Windows 机器，双击即可安装。
echo   安装后无需 Node.js 等任何额外环境。
echo.
pause
