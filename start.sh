#!/bin/bash
# 全球海洋大气耦合时空可视分析系统 — 一键启动脚本 (macOS/Linux)

echo "================================================"
echo "  全球海洋大气耦合时空可视分析系统"
echo "================================================"
echo ""

# 检查 Python
if ! command -v python3 &> /dev/null; then
    if ! command -v python &> /dev/null; then
        echo "[错误] 未检测到 Python，请先安装 Python 3.8+"
        exit 1
    fi
    PYTHON=python
else
    PYTHON=python3
fi

echo "[1/2] 检查 Python 依赖..."
$PYTHON -m pip install -r requirements.txt -q 2>/dev/null

# 检测端口
if lsof -i :5000 &> /dev/null 2>&1; then
    echo "[警告] 端口 5000 已被占用"
    echo "       可使用 PORT 环境变量指定其他端口："
    echo "       PORT=5001 $PYTHON backend/app.py"
    exit 1
fi

# 启动服务
echo "[2/2] 启动后端服务..."
echo ""
$PYTHON backend/app.py
