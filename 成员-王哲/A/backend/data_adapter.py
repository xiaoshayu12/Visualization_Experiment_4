# -*- coding: utf-8 -*-
"""
数据适配层 (Data Adapter)
=========================
职责：
  1. 加载实验2扩展数据集 (JSON, ≥3000 条时空记录)
  2. 将原始字段适配/派生为分析所需的关键字段：
        lon, lat, time, sst_anomaly, ohc, wind_stress
  3. 提供缓存、过滤(时间/区域)、分页能力

派生口径(均为物理上可解释的代理量, proxy)：
  - sst_anomaly : SST 距平 = sst - 该(区域,月份)的气候态月均值
  - ohc         : 海洋热含量代理 = ρ·cp·H·(sst - T_ref)  (单位 GJ/m²)
                  ρ=1025 kg/m³, cp=3850 J/(kg·℃), H=50 m, T_ref=0℃
  - wind_stress : 风应力 = ρ_air·Cd·U²  (单位 N/m²)
                  ρ_air=1.225 kg/m³, Cd=1.3e-3, U=wind_speed
"""
import json
import os
import time as _time
from collections import defaultdict
from functools import lru_cache

# ---------------------------------------------------------------- 路径 & 常量
_BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
_DATA_FILE = os.path.join(
    _BASE, "data", "组号-全球海洋大气耦合-实验2-选题扩展数据集.json"
)

# OHC 代理参数
_RHO_W, _CP, _H, _T_REF = 1025.0, 3850.0, 50.0, 0.0
# 风应力参数
_RHO_A, _CD = 1.225, 1.3e-3

# 已知命名区域(用于 region= 命名筛选)
KNOWN_REGIONS = ["太平洋", "大西洋", "印度洋", "北极海域", "南极海域", "赤道区域"]


# ---------------------------------------------------------------- 加载 & 派生
def _derive(records):
    """在原始记录上派生 sst_anomaly / ohc / wind_stress / month 字段。"""
    # 1) 计算 (区域, 月份) 气候态月均 SST 作为距平基准
    buckets = defaultdict(list)
    for r in records:
        month = r["time"][5:7]                      # "MM"
        buckets[(r["region"], month)].append(r["sst"])
    clim = {k: sum(v) / len(v) for k, v in buckets.items()}

    out = []
    for r in records:
        month = r["time"][5:7]
        u = r.get("wind_speed", 0.0) or 0.0
        sst = r.get("sst", 0.0) or 0.0
        rec = {
            "id": r["id"],
            "time": r["time"],
            "month": r["time"][:7],                 # "YYYY-MM"
            "lon": round(r["longitude"], 4),
            "lat": round(r["latitude"], 4),
            "region": r["region"],
            "sst": round(sst, 2),
            "sst_anomaly": round(sst - clim[(r["region"], month)], 3),
            "ohc": round(_RHO_W * _CP * _H * (sst - _T_REF) / 1e9, 3),  # GJ/m²
            "wind_stress": round(_RHO_A * _CD * u * u, 4),               # N/m²
            "wind_speed": round(u, 2),
            "wind_dir": r.get("wind_dir"),
            "salinity": r.get("salinity"),
            "pressure": r.get("pressure"),
            "precipitation": r.get("precipitation"),
            "co2": r.get("co2"),
            "humidity": r.get("humidity"),
            "current_speed": r.get("current_speed"),
            "chlorophyll": r.get("chlorophyll"),
            "wave_height": r.get("wave_height"),
        }
        out.append(rec)
    out.sort(key=lambda x: x["time"])
    return out


def get_dataset():
    """返回派生数据集（通过统一缓存）。"""
    return build_cache()["_cleaned_data"]


def get_meta():
    """返回数据集元信息：时间范围、区域、经纬度范围、各指标范围。"""
    ds = get_dataset()
    times = sorted({r["month"] for r in ds})
    lons = [r["lon"] for r in ds]
    lats = [r["lat"] for r in ds]

    def _rng(key):
        vals = [r[key] for r in ds if r.get(key) is not None]
        if not vals:
            return [0, 0]
        return [round(min(vals), 3), round(max(vals), 3)]

    value_range = {}
    for key in ALL_NUMERIC_FIELDS + ["sst_anomaly", "ohc", "wind_stress"]:
        vals = [r.get(key) for r in ds if r.get(key) is not None]
        if vals:
            value_range[key] = [round(min(vals), 3), round(max(vals), 3)]

    return {
        "total": len(ds),
        "time_range": [ds[0]["time"], ds[-1]["time"]],
        "months": times,
        "regions": KNOWN_REGIONS,
        "lon_range": [round(min(lons), 2), round(max(lons), 2)],
        "lat_range": [round(min(lats), 2), round(max(lats), 2)],
        "value_range": value_range,
    }


# ---------------------------------------------------------------- 过滤逻辑
def _in_time(rec, start, end):
    # 统一按字符串比较(ISO 日期可直接字典序比较)；支持 YYYY-MM 或 YYYY-MM-DD
    t = rec["time"]
    if start and t < start:
        return False
    if end and t[: len(end)] > end:
        return False
    return True


def _in_bbox(rec, bbox):
    lon_min, lat_min, lon_max, lat_max = bbox
    return lon_min <= rec["lon"] <= lon_max and lat_min <= rec["lat"] <= lat_max


def _parse_bbox(region):
    """'minLon,minLat,maxLon,maxLat' -> (floats) 或 None。"""
    parts = region.split(",")
    if len(parts) != 4:
        return None
    try:
        return tuple(float(p) for p in parts)
    except ValueError:
        return None


# 过滤结果按规范化 query key 做缓存
_filter_cache = {}
_CACHE_MAX = 64


def filter_records(qtype=None, time_str=None, region=None):
    """
    统一过滤入口。
      qtype  : '全量' / None      -> 不过滤
      time_str: 'start,end'        -> 时间范围(任一侧可空, 如 ',2021-06')
      region : 命名区域 或 bbox 'minLon,minLat,maxLon,maxLat'
    返回 (records, filters_applied_dict)
    """
    cache_key = (qtype or "", time_str or "", region or "")
    if cache_key in _filter_cache:
        return _filter_cache[cache_key]

    ds = get_dataset()
    applied = {}

    # 时间范围
    start = end = None
    if time_str:
        seg = time_str.split(",")
        start = seg[0].strip() or None
        end = (seg[1].strip() if len(seg) > 1 else "") or None
        applied["time"] = {"start": start, "end": end}

    # 区域：bbox 或 命名
    bbox = None
    named = None
    if region:
        bbox = _parse_bbox(region)
        if bbox:
            applied["bbox"] = list(bbox)
        elif region in KNOWN_REGIONS:
            named = region
            applied["region"] = named

    if (qtype in (None, "", "全量")) and not time_str and not region:
        result = ds
    else:
        result = []
        for r in ds:
            if start or end:
                if not _in_time(r, start, end):
                    continue
            if bbox and not _in_bbox(r, bbox):
                continue
            if named and r["region"] != named:
                continue
            result.append(r)

    out = (result, applied)
    if len(_filter_cache) >= _CACHE_MAX:
        _filter_cache.clear()
    _filter_cache[cache_key] = out
    return out


def paginate(records, page, page_size):
    """分页；page 从 1 开始；page_size<=0 表示不分页返回全部。"""
    total = len(records)
    if page_size <= 0:
        return records, {"page": 1, "page_size": total, "total": total, "pages": 1}
    page = max(1, page)
    start = (page - 1) * page_size
    end = start + page_size
    pages = (total + page_size - 1) // page_size if total else 0
    return records[start:end], {
        "page": page,
        "page_size": page_size,
        "total": total,
        "pages": pages,
    }


# --------------------------------------------------- 聚合(供图表降采样/汇总)
def aggregate_monthly(records, metric):
    """按 (区域, 月份) 聚合均值，用于折线/柱状图，避免前端传输全部散点。"""
    acc = defaultdict(lambda: defaultdict(list))
    for r in records:
        v = r.get(metric)
        if v is not None:
            acc[r["region"]][r["month"]].append(v)
    series = {}
    for region, months in acc.items():
        series[region] = [
            {"month": m, "value": round(sum(vs) / len(vs), 3), "count": len(vs)}
            for m, vs in sorted(months.items())
        ]
    return series


# ---------------------------------------------------------------- 统一预处理 (源自 刘国宁 api.py)
ALL_NUMERIC_FIELDS = [
    "wind_speed", "wind_dir", "pressure", "precipitation", "co2",
    "humidity", "sst", "salinity", "current_speed", "chlorophyll"
]


def percentile(sorted_data, p):
    """计算百分位数（线性插值）"""
    n = len(sorted_data)
    if n == 0:
        return 0
    k = (n - 1) * p
    f = int(k)
    c = k - f
    if f + 1 >= n:
        return sorted_data[f]
    return sorted_data[f] + c * (sorted_data[f + 1] - sorted_data[f])


def impute_missing(records):
    """按海区+月份分组，取中位数填充缺失值"""
    import math, statistics
    groups = defaultdict(lambda: defaultdict(list))
    for d in records:
        month = d.get("time", "")[:7]
        groups[d["region"]][month].append(d)

    for field in ALL_NUMERIC_FIELDS:
        all_vals = [r.get(field) for r in records
                    if r.get(field) is not None and math.isfinite(r[field])]

        for d in records:
            val = d.get(field)
            if val is None or (isinstance(val, float) and not math.isfinite(val)):
                region = d["region"]
                month = d.get("time", "")[:7]
                group_vals = [r.get(field) for r in groups[region][month]
                              if r.get(field) is not None and math.isfinite(r[field])]
                if group_vals:
                    d[field] = statistics.median(group_vals)
                elif all_vals:
                    d[field] = statistics.median(all_vals)
                else:
                    d[field] = 0


def detect_outliers(records):
    """按海区 IQR×1.5 + 物理约束，返回 (清洗后数据, 异常摘要)"""
    import math
    by_region = defaultdict(list)
    for d in records:
        by_region[d["region"]].append(d)

    bounds = {}
    for field in ALL_NUMERIC_FIELDS:
        bounds[field] = {}
        for region, recs in by_region.items():
            vals = sorted([r[field] for r in recs
                           if r.get(field) is not None and math.isfinite(r[field])])
            if len(vals) < 4:
                continue
            q1 = percentile(vals, 0.25)
            q3 = percentile(vals, 0.75)
            iqr = q3 - q1
            bounds[field][region] = {
                "lower": q1 - 1.5 * iqr,
                "upper": q3 + 1.5 * iqr
            }

    outlier_summary = {
        "by_variable": defaultdict(int),
        "by_region": defaultdict(int)
    }
    cleaned = []
    for d in records:
        # 物理约束
        if d.get("salinity") is not None and d["salinity"] < 5:
            outlier_summary["by_variable"]["salinity"] += 1
            outlier_summary["by_region"][d["region"]] += 1
            continue
        if d.get("chlorophyll") is not None and d["chlorophyll"] < 0:
            outlier_summary["by_variable"]["chlorophyll"] += 1
            outlier_summary["by_region"][d["region"]] += 1
            continue
        is_outlier = False
        for field in ALL_NUMERIC_FIELDS:
            b = bounds[field].get(d["region"])
            if b is None or d.get(field) is None:
                continue
            if d[field] < b["lower"] or d[field] > b["upper"]:
                outlier_summary["by_variable"][field] += 1
                outlier_summary["by_region"][d["region"]] += 1
                is_outlier = True
                break
        if is_outlier:
            continue
        cleaned.append(d)

    return cleaned, {"by_region": dict(outlier_summary["by_region"]),
                     "by_variable": dict(outlier_summary["by_variable"])}


def compute_regional_stats(records):
    """每海区每变量的 mean/std/min/max/count"""
    import math, statistics
    result = {}
    for region in KNOWN_REGIONS:
        recs = [d for d in records if d["region"] == region]
        result[region] = {}
        for field in ALL_NUMERIC_FIELDS:
            vals = [d[field] for d in recs
                    if d.get(field) is not None and math.isfinite(d[field])]
            if vals:
                result[region][field] = {
                    "mean": round(statistics.mean(vals), 4),
                    "std": round(statistics.stdev(vals) if len(vals) >= 2 else 0, 4),
                    "min": round(min(vals), 4),
                    "max": round(max(vals), 4),
                    "count": len(vals)
                }
            else:
                result[region][field] = {
                    "mean": 0, "std": 0, "min": 0, "max": 0, "count": 0
                }
    return result


def compute_extremes(records):
    """找出超过 2σ 的极端记录，最多 100 条，按 sigma 降序"""
    import math, statistics
    stats = {}
    for field in ALL_NUMERIC_FIELDS:
        vals = [d[field] for d in records
                if d.get(field) is not None and math.isfinite(d[field])]
        if vals:
            stats[field] = {
                "mean": statistics.mean(vals),
                "std": statistics.stdev(vals) if len(vals) >= 2 else 0
            }

    extremes = []
    for d in records:
        for field in ALL_NUMERIC_FIELDS:
            val = d.get(field)
            if val is None or not math.isfinite(val):
                continue
            s = stats.get(field)
            if not s or s["std"] == 0:
                continue
            sigma = abs(val - s["mean"]) / s["std"]
            if sigma > 2:
                extremes.append({
                    "id": d["id"],
                    "region": d["region"],
                    "field": field,
                    "value": round(val, 4),
                    "sigma": round(sigma, 4)
                })

    extremes.sort(key=lambda x: x["sigma"], reverse=True)
    return extremes[:100]


_preprocess_cache = None


def build_cache():
    """统一预处理入口：加载→填补→异常检测→派生字段→区域统计→极值"""
    global _preprocess_cache
    if _preprocess_cache is not None:
        return _preprocess_cache

    _t0 = _time.time()
    print("[data_adapter] 正在加载原始数据...")
    raw = load_raw()
    print(f"[data_adapter] 原始记录: {len(raw)}")

    impute_missing(raw)
    cleaned, outlier_summary = detect_outliers(raw)
    print(f"[data_adapter] 清洗后记录: {len(cleaned)}, 剔除异常: {len(raw) - len(cleaned)}")

    # 派生字段
    derived = _derive(cleaned)

    regional = compute_regional_stats(derived)
    extremes = compute_extremes(derived)

    time_span_min = min((d.get("time", "") for d in derived), default="")
    time_span_max = max((d.get("time", "") for d in derived), default="")
    regions_active = len(set(d["region"] for d in derived))

    _preprocess_cache = {
        "health": {
            "status": "ok",
            "records_before": len(raw),
            "records_after": len(derived),
            "regions": KNOWN_REGIONS,
            "fields": ALL_NUMERIC_FIELDS,
        },
        "regional": regional,
        "outliers": {
            "total_removed": len(raw) - len(derived),
            "pct_removed": round((len(raw) - len(derived)) / len(raw) * 100, 2) if raw else 0,
            "by_region": outlier_summary.get("by_region", {}),
            "by_variable": outlier_summary.get("by_variable", {}),
        },
        "extremes": extremes,
        "overview": {
            "total_records": len(derived),
            "regions_active": regions_active,
            "time_span": f"{time_span_min} ~ {time_span_max}",
            "coupling_baseline": "Pearson r 矩阵由前端计算"
        },
        "_cleaned_data": derived,
        "_raw_data": raw,
    }
    print(f"[data_adapter] 缓存构建完毕 ({(_time.time()-_t0)*1000:.1f} ms)")
    return _preprocess_cache


def load_raw():
    """加载原始 JSON（不做任何处理）"""
    with open(_DATA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


if __name__ == "__main__":
    t0 = _time.time()
    cache = build_cache()
    print(f"built cache in {(_time.time()-t0)*1000:.1f} ms")
    print("health:", json.dumps(cache["health"], ensure_ascii=False))
    print("sample:", json.dumps(cache["_cleaned_data"][0], ensure_ascii=False))
