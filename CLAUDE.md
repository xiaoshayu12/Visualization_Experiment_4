# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

可视化课程实验三：全球海洋大气耦合时空可视分析系统。四个成员各自独立完成一个分析子任务，共享同一份数据集，通过统一 Flask 后端对外服务。

## 启动方式

```bash
# 安装依赖
pip install -r requirements.txt

# 统一启动（端口 5000，可通过 PORT 环境变量覆盖）
python backend/app.py

# 或使用一键脚本
#   Windows: 双击 启动.bat
#   macOS/Linux: ./start.sh
```

启动后访问：
- `http://localhost:5000/` — SST 距平分析（王哲，主页）
- `http://localhost:5000/members/liu/` — 海气耦合与异常检测（刘国宁）
- `http://localhost:5000/members/cheng/` — 碳汇压力分析（程传哲）
- `http://localhost:5000/members/xu/` — 综合分析（许一凡）

## 架构

```
实验三/
├── backend/                    # 统一 Flask 后端（合并了王哲和刘国宁的独立后端）
│   ├── app.py                  # Flask 应用入口，端口 5000。同时提供 API + 静态页面路由
│   └── data_adapter.py         # 统一数据层：加载、派生字段、缺失值填补、IQR异常检测、过滤/分页/聚合/统计
├── static/                     # 全局共享前端资源
│   ├── css/global.css          # CSS 变量、全局重置、通用组件样式
│   ├── css/nav.css             # 导航栏样式（暗色渐变，sticky 顶部）
│   ├── js/config.js            # window.CONFIG：API_BASE、页面路由、海域颜色、图表主题色
│   ├── js/nav.js               # 自动渲染四页导航标签，根据 URL 高亮当前页
│   └── lib/world.json          # 世界地图 GeoJSON（ECharts 用）
├── data/                       # 共享数据集 (3600条, 6海域×36月)
│   └── 第2组-全球海洋大气耦合-实验3-地理数据.json
├── 成员-王哲/A/                # SST 距平时空分析（ECharts 四图联动）
├── 成员-刘国宁/                # 海气耦合与异常检测（D3.js + ML 占位层）
├── 成员-程传哲/                # 碳汇压力分析（纯静态 D3.js）
├── 成员-许一凡/                # 单文件自包含可视化
├── requirements.txt            # flask>=2.3.0, flask-cors>=4.0.0
├── 启动.bat / start.sh         # 一键启动脚本
```

## 统一后端 API

`backend/app.py` 是唯一的服务入口，同时提供前端页面和 REST API：

| 路由 | 说明 |
|------|------|
| `GET /api/meta` | 数据集元信息（时间范围、值域、区域等） |
| `GET /api/data/filter` | 统一过滤（支持 type/time/region/bbox），分页，聚合 |
| `GET /api/data/point?id=` | 单点详情 + 气候态对比 |
| `GET /api/data/raw` | 原始 JSON 文件直读（程传哲页面 fallback，其他页面不依赖此端点） |
| `GET /api/geojson` | GeoJSON FeatureCollection（同 filter 参数） |
| `GET /api/health` | 服务健康检查 |
| `GET /api/stats/regional` | 按海域分字段统计（mean/std/min/max） |
| `GET /api/stats/outliers` | IQR 异常值摘要 |
| `GET /api/stats/extremes` | 极值记录（2σ 以上，取 top 100） |
| `GET /api/stats/overview` | 数据概览 |
| `GET/POST /api/model/{anomaly,coupling,forecast,cluster}` | ML 模型占位接口（均返回 `"model not loaded"） |

## 数据适配层 (`backend/data_adapter.py`)

从原始 JSON 加载后自动派生三个关键变量：

- **`sst_anomaly`** = `sst − 该(海域,月份)气候态月均值`
- **`ohc`** = `1025 × 3850 × 50 × (sst − 0) / 1e9`（GJ/m² 海洋热含量代理）
- **`wind_stress`** = `1.225 × 1.3e-3 × wind_speed²`（N/m² 风应力）

核心函数：`get_dataset()`（lru_cache 单例）、`filter_records()`（LRU 64 条缓存）、`paginate()`、`aggregate_monthly()`、`impute_missing()`（按海域+月份中位数填补）、`detect_outliers()`（按海域 IQR×1.5 + 物理约束）。

## 成员子系统

### 王哲 — 海洋-大气多维耦合分析（主页）
- `成员-王哲/frontend/index.html` + `frontend/js/*.js`（自包含离线系统，D3.js v7 + Plotly）
- 五视图单屏切换：总览 / 3D 耦合星云（PCA 降维，本组创新图表）/ 维度相关矩阵 / 海温平滑+预测 / 单点预测归因瀑布
- 数据来自 `frontend/js/data-bundle.js`（`window.OCEAN_DATA`），由离线算法管线 `code/run.py` 生成 `output/*.json` 后经 `code/build_bundle.py` 打包，**前端不依赖统一后端 API**
- 算法管线：`code/preprocess.py`（清洗/3σ/聚合）、`task1_smoothing.py`（滑动+指数平滑）、`coupling_pca.py`（PCA+相关矩阵）、`task2_predict.py`（随机森林/线性回归 SST 预测，留 `predict()` 接口）
- 整合方式：统一后端 `/` 路由直发 `frontend/index.html`，并桥接根级 `/css`、`/js`、`/lib` 三组相对资源；页面引入共享 `/static/css/{global,nav}.css` + `/static/js/{config,nav}.js` 渲染顶部四页导航

### 刘国宁 — 海气耦合与异常检测
- `成员-刘国宁/个人界面.html` + `个人界面.js`
- D3.js v7 三面板：Pearson 相关性热力图（10×10 下三角）+ 双变量耦合地图（颜色/大小/形状编码）+ 信息侧栏
- `成员-刘国宁/model.py`：ML 模型 ABC 接口 + Registry，四个占位模型类（Anomaly/Coupling/Forecast/Cluster），替换占位类即可接入真实模型

### 程传哲 — 碳汇压力分析
- `成员-程传哲/index.html`（1295行自包含 D3.js）
- 从 CO2/SST/风速/叶绿素/盐度五个因子加权计算碳汇压力指数，分五级状态
- 布局：KPI 条 + 区域卡片 + Region×Month 热力图 + 解释面板（驱动贡献/时序/散点/状态构成）
- `成员-程传哲/assets/data-adapter.js`：前端 IIFE `Adapter` 模块，支持多数据源加载（`window.MEMBER4_RAW_DATA` / API / fetch JSON）

### 许一凡 — 综合分析
- `成员-许一凡/代码_许一凡.html`：单文件自包含可视化

## 共享前端基础设施

- **导航系统**：`js/nav.js` 从 `window.CONFIG.PAGES` 自动生成四个标签页，根据 `location.pathname` 高亮
- **配色体系**：Okabe-Ito 色盲友好调色板，6 海域各一色，距平用 RdBu 发散色标
- **CSS 变量**：定义在 `global.css`（`--primary`、`--bg`、`--surface`、`--text-primary` 等）

## 数据口径说明

原始数据集字段：id, time, longitude, latitude, region, sst, salinity, wind_speed, wind_dir, pressure, precipitation, co2, wave_height, humidity, current_speed, chlorophyll。

6 个海域：太平洋、大西洋、印度洋、北极海域、南极海域、赤道区域。36 个月：2020-01 ~ 2022-12。

所有数值型字段在统计接口中经过两步预处理：先按(海域,月份)分组中位数填补缺失值，再按海域 IQR×1.5 + 物理约束（盐度≥5，叶绿素≥0）剔除异常值。

## 页面路由分发机制

Flask 应用使用 `send_from_directory` 将各成员的 HTML/JS/CSS 文件映射到统一的 URL 命名空间下，对前端透明。成员的页面内相对路径引用（如 `../static/`）通过额外的 `/members/static/<path>` 路由桥接。不依赖成员目录下的旧 `app.py`/`api.py`/`server.py` — 这些文件仍保留但不再由统一启动脚本使用。

## 注意事项

- **数据文件改名**：如果修改 `data/` 下的 JSON 文件名，必须同步更新两处硬编码路径：`backend/data_adapter.py` 的 `_DATA_FILE` 和 `backend/app.py` 的 `/api/data/raw` 端点（`api_raw_data`）。成员目录下的旧 `data_adapter.py`/`api.py` 已不被统一后端使用，可忽略。
- **王哲主页（frontend/）的资源桥接**：主页在 `/` 提供，其相对路径 `css/`、`js/`、`lib/` 由 `backend/app.py` 中的根级路由 `/css`、`/js`、`/lib`（`static_wang_css`/`static_wang_js`/`static_wang_lib`）映射到 `成员-王哲/frontend/` 下对应目录。新增此类相对引用时需保证前缀落在这三组内。
- **王哲算法产物的更新**：修改 `成员-王哲/code/` 下任一算法后，需依次重跑 `python code/run.py`（重新生成 `output/*.json`）与 `python code/build_bundle.py`（重新打包 `frontend/js/data-bundle.js`），前端才会读到新结果。管线输入为 `成员-王哲/Data/ocean_atmosphere.json`。
- 各成员页面通过 `../static/js/config.js` 获取 `window.CONFIG.API_BASE`（值 = `{origin}/api`），所有数据请求应通过此配置统一管理。
- `启动.bat` 的编码为 GBK（Windows 批处理），修改中文内容时需注意编码。
