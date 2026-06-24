# 全球海洋热力时空分布分析系统（成员A · 后端 + 独立分析界面）

实验3 成员A 交付：Flask 数据/接口层 + 多图联动的个人独立分析界面
「全球海洋热力时空分布分析」（OHC 异常 × ENSO × 海气耦合）。

## 快速开始

```bash
pip install -r requirements.txt
python app.py
# 浏览器打开 http://127.0.0.1:5001   （端口被占用时可 PORT=5002 python app.py）
```

## 目录结构

```
app.py                  Flask 服务：4 个 filter 接口 + meta/point/geojson
backend/data_adapter.py 数据适配层：派生 sst_anomaly/ohc/wind_stress、缓存、过滤、分页、聚合
static/index.html       个人独立分析界面（四图布局 + 时间轴）
static/js/main.js       多图联动控制器（ECharts）
static/css/style.css    样式
static/lib/world.json   世界地图 GeoJSON
data/                   实验2 扩展数据集（3600 条时空记录）
API.md                  接口文档与数据适配说明
任务抽象.md              三级任务抽象 + 四图编码 + 联动逻辑
```

## 功能要点

- **4 个核心接口**：全量 / 时间范围 / 区域(bbox 或命名) / 时间+区域混合，含缓存与分页（≥3000 条动态加载）。
- **四图联动**：折线(SST距平)、地理热力(主图)、柱状(OHC)、散点(SST距平 vs 风应力)。
- **交互（≥4 类）**：时间轴筛选、地图点击下钻、折线刷选、散点框选高亮、四图 Tooltip。

详见 [API.md](API.md) 与 [任务抽象.md](任务抽象.md)。
