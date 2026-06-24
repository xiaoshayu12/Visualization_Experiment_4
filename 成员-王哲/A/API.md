# 接口文档与数据适配说明（成员A · 后端）

> 全球海洋大气耦合时空可视分析系统 · 数据层 + 接口层
> 技术栈：Flask + Python + GeoJSON

## 1. 启动

```bash
pip install -r requirements.txt
python app.py
# → http://127.0.0.1:5001   （个人独立分析界面；端口可用 PORT 环境变量覆盖）
```

---

## 2. 数据适配说明

原始数据集 `data/组号-全球海洋大气耦合-实验2-选题扩展数据集.json`，共 **3600 条**时空记录，
时间范围 2020-01 ~ 2022-12（36 个月），覆盖 6 大海域、全球经纬度网格。

原始字段为 `longitude, latitude, time, region, sst, salinity, wind_speed, …`。
按需求规定的关键字段 `lon, lat, time, sst_anomaly, ohc, wind_stress`，在数据适配层
[backend/data_adapter.py](backend/data_adapter.py) 中**派生**得到（均为物理可解释的代理量）：

| 字段 | 口径 | 公式 / 说明 |
| --- | --- | --- |
| `lon` / `lat` | 经纬度 | 直接取自 `longitude` / `latitude` |
| `time` / `month` | 时间 | 原始日期 / 截取 `YYYY-MM` |
| `sst_anomaly` | SST 距平(℃) | `sst − 该(海域,月份)气候态月均值` |
| `ohc` | 海洋热含量代理(GJ/m²) | `ρ·cp·H·(sst−T_ref) / 1e9`，ρ=1025, cp=3850, H=50m, T_ref=0℃ |
| `wind_stress` | 风应力(N/m²) | `ρ_air·Cd·U²`，ρ_air=1.225, Cd=1.3e-3, U=wind_speed |

**性能策略**
- 数据集与气候态基准用 `lru_cache` 单例缓存，仅首访读盘一次（~17ms）。
- 过滤结果按规范化 query key 做 LRU 缓存（容量 64），重复查询直接命中。
- 接口支持分页（`page` / `page_size`），支持 ≥3000 条动态加载；前端图表用
  `aggregate_monthly` 做服务端降采样（按海域/月份均值），避免传输全部散点。

---

## 3. 核心接口

### 3.1 `GET /api/data/filter` — 统一过滤接口（4 种形态）

| 形态 | 示例 | 含义 |
| --- | --- | --- |
| 全量 | `?type=全量` | 返回全量时空数据 |
| 时间范围 | `?time=2021-06,2021-08` | 时间区间筛选（任一侧可空，如 `,2021-08`） |
| 区域 | `?region=120,-10,180,10` | bbox 空间筛选 `minLon,minLat,maxLon,maxLat` |
| 区域（命名） | `?region=赤道区域` | 按命名海域筛选 |
| 混合 | `?time=2022-01,2022-12&region=赤道区域` | 时间 + 区域 |

**公共参数**

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `page` | 1 | 页码（从 1 开始） |
| `page_size` | 500 | 每页条数；`≤0` 表示不分页返回全部 |
| `agg` | — | `ohc` / `sst` / `sst_anomaly` / `wind_stress`，附带按海域·月份的均值序列 |

**响应示例**

```json
{
  "ok": true,
  "filters": { "time": { "start": "2021-06", "end": "2021-08" } },
  "page": { "page": 1, "page_size": 500, "total": 290, "pages": 1 },
  "count": 290,
  "total_matched": 290,
  "elapsed_ms": 0.27,
  "data": [ { "id": 1, "time": "2021-06-…", "lon": …, "lat": …, "region": "太平洋",
              "sst": 28.1, "sst_anomaly": 0.83, "ohc": 5.54, "wind_stress": 0.11, … } ],
  "aggregate": { "metric": "ohc", "series": { "太平洋": [{ "month": "2021-06", "value": 5.4, "count": 12 }, …] } }
}
```

### 3.2 `GET /api/meta` — 数据集元信息
返回 `total`、`time_range`、`months[]`、`regions[]`、`lon_range`、`lat_range`、各指标 `value_range`。

### 3.3 `GET /api/data/point?id=<id>` — 单点详情（低级 Query 任务）
返回该站点全部字段，并附带同（海域·月份）历史气候态均值与 **SST 偏差**。

### 3.4 `GET /api/geojson` — GeoJSON 输出
按与 `filter` 相同的参数返回 `FeatureCollection`（Point 几何 + 关键属性），供 GIS / 地图组件直接消费。

---

## 4. 前端联动界面

入口 `GET /`（[static/index.html](static/index.html)）即「全球海洋热力时空分布分析」独立界面，
四图联动详见 [任务抽象.md](任务抽象.md)。
