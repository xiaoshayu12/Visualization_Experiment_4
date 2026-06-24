# -*- coding: utf-8 -*-
"""
统一数据适配层
================
职责：
  1. 加载共享数据集（根目录 data/）
  2. 派生关键分析变量：sst_anomaly, ohc, wind_stress
  3. 数据预处理：缺失值填补、IQR 异常检测
  4. 提供缓存、过滤、分页、聚合、统计能力

派生口径：
  - sst_anomaly : SST 距平 = sst - 该(区域,月份)的气候态月均值
  - ohc         : 海洋热含量代理 = rho*cp*H*(sst - T_ref) / 1e9  (GJ/m²)
  - wind_stress : 风应力 = rho_air*Cd*U²  (N/m²)
"""
import json
import os
import math
import statistics
import time as _time
from collections import defaultdict
from functools import lru_cache

# ---------------------------------------------------------------- 路径 & 常量
_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_DATA_FILE = os.path.join(
    _BASE, "data", "第2组-全球海洋大气耦合-实验3-地理数据.json"
)

# OHC 代理参数
_RHO_W, _CP, _H, _T_REF = 1025.0, 3850.0, 50.0, 0.0
# 风应力参数
_RHO_A, _CD = 1.225, 1.3e-3

KNOWN_REGIONS = ["太平洋", "大西洋", "印度洋", "北极海域", "南极海域", "赤道区域"]
ALL_NUMERIC_FIELDS = [
    "wind_speed", "wind_dir", "pressure", "precipitation", "co2",
    "humidity", "sst", "salinity", "current_speed", "chlorophyll"
]


# ---------------------------------------------------------------- 数据加载 & 派生
def _derive(records):
    """在原始记录上派生 sst_anomaly / ohc / wind_stress / month 字段（保留所有原始字段）。"""
    buckets = defaultdict(list)
    for r in records:
        month = r["time"][5:7]
        buckets[(r["region"], month)].append(r["sst"])
    clim = {k: sum(v) / len(v) for k, v in buckets.items()}

    out = []
    for r in records:
        month = r["time"][5:7]
        u = r.get("wind_speed", 0.0) or 0.0
        sst = r.get("sst", 0.0) or 0.0
        rec = {
            # 原始字段（保留全部用于各成员分析）
            "id": r["id"],
            "time": r["time"],
            "longitude": r["longitude"],
            "latitude": r["latitude"],
            "region": r["region"],
            "sst": sst,
            "salinity": r.get("salinity"),
            "wind_speed": u,
            "wind_dir": r.get("wind_dir"),
            "pressure": r.get("pressure"),
            "precipitation": r.get("precipitation"),
            "co2": r.get("co2"),
            "wave_height": r.get("wave_height"),
            "humidity": r.get("humidity"),
            "current_speed": r.get("current_speed"),
            "chlorophyll": r.get("chlorophyll"),
            # 派生字段
            "month": r["time"][:7],
            "lon": round(r["longitude"], 4),
            "lat": round(r["latitude"], 4),
            "sst_anomaly": round(sst - clim[(r["region"], month)], 3),
            "ohc": round(_RHO_W * _CP * _H * (sst - _T_REF) / 1e9, 3),
            "wind_stress": round(_RHO_A * _CD * u * u, 4),
            # 保留原始记录（供内部使用）
            "_raw": r,
        }
        out.append(rec)
    out.sort(key=lambda x: x["time"])
    return out


@lru_cache(maxsize=1)
def get_dataset():
    """加载并派生数据集(单例缓存)。"""
    with open(_DATA_FILE, "r", encoding="utf-8") as f:
        raw = json.load(f)
    return _derive(raw)


# ---------------------------------------------------------------- 元信息
def get_meta():
    ds = get_dataset()
    times = sorted({r["month"] for r in ds})
    lons = [r["lon"] for r in ds]
    lats = [r["lat"] for r in ds]

    def _rng(key):
        vals = [r[key] for r in ds if r[key] is not None]
        return [round(min(vals), 3), round(max(vals), 3)]

    return {
        "total": len(ds),
        "time_range": [ds[0]["time"], ds[-1]["time"]],
        "months": times,
        "regions": KNOWN_REGIONS,
        "lon_range": [round(min(lons), 2), round(max(lons), 2)],
        "lat_range": [round(min(lats), 2), round(max(lats), 2)],
        "value_range": {
            "sst": _rng("sst"),
            "sst_anomaly": _rng("sst_anomaly"),
            "ohc": _rng("ohc"),
            "wind_stress": _rng("wind_stress"),
        },
    }


# ---------------------------------------------------------------- 过滤
def _in_time(rec, start, end):
    t = rec["time"]
    if start and t < start:
        return False
    if end and t[:len(end)] > end:
        return False
    return True


def _in_bbox(rec, bbox):
    lon_min, lat_min, lon_max, lat_max = bbox
    return lon_min <= rec["lon"] <= lon_max and lat_min <= rec["lat"] <= lat_max


def _parse_bbox(region):
    parts = region.split(",")
    if len(parts) != 4:
        return None
    try:
        return tuple(float(p) for p in parts)
    except ValueError:
        return None


_filter_cache = {}
_CACHE_MAX = 64


def filter_records(qtype=None, time_str=None, region=None):
    cache_key = (qtype or "", time_str or "", region or "")
    if cache_key in _filter_cache:
        return _filter_cache[cache_key]

    ds = get_dataset()
    applied = {}

    start = end = None
    if time_str:
        seg = time_str.split(",")
        start = seg[0].strip() or None
        end = (seg[1].strip() if len(seg) > 1 else "") or None
        applied["time"] = {"start": start, "end": end}

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


def aggregate_monthly(records, metric):
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


# ---------------------------------------------------------------- 预处理 (刘国宁)
def _percentile(sorted_data, p):
    n = len(sorted_data)
    if n == 0:
        return 0
    k = (n - 1) * p
    f = int(k)
    c = k - f
    if f + 1 >= n:
        return sorted_data[f]
    return sorted_data[f] + c * (sorted_data[f + 1] - sorted_data[f])


def _extract_raw(records):
    """从派生记录中提取原始字段字典。"""
    return [r["_raw"] for r in records]


def impute_missing(data):
    """按海区+月份分组，取中位数填充。"""
    groups = defaultdict(lambda: defaultdict(list))
    for d in data:
        month = d.get("time", "")[:7]
        groups[d["region"]][month].append(d)

    for field in ALL_NUMERIC_FIELDS:
        all_vals = [r.get(field) for r in data
                    if r.get(field) is not None and math.isfinite(r[field])]

        for d in data:
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


def detect_outliers(data):
    """按海区 IQR x1.5 + 物理约束，返回 (清洗后数据, 异常摘要)。"""
    by_region = defaultdict(list)
    for d in data:
        by_region[d["region"]].append(d)

    bounds = {}
    for field in ALL_NUMERIC_FIELDS:
        bounds[field] = {}
        for region, records in by_region.items():
            vals = sorted([r[field] for r in records
                           if r.get(field) is not None and math.isfinite(r[field])])
            if len(vals) < 4:
                continue
            q1 = _percentile(vals, 0.25)
            q3 = _percentile(vals, 0.75)
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
    for d in data:
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

    return cleaned, dict(outlier_summary)


def compute_regional_stats(data):
    result = {}
    for region in KNOWN_REGIONS:
        records = [d for d in data if d["region"] == region]
        result[region] = {}
        for field in ALL_NUMERIC_FIELDS:
            vals = [d[field] for d in records
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


def compute_extremes(data):
    stats = {}
    for field in ALL_NUMERIC_FIELDS:
        vals = [d[field] for d in data
                if d.get(field) is not None and math.isfinite(d[field])]
        if vals:
            stats[field] = {
                "mean": statistics.mean(vals),
                "std": statistics.stdev(vals) if len(vals) >= 2 else 0
            }

    extremes = []
    for d in data:
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
