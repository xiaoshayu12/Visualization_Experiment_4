# -*- coding: utf-8 -*-
"""
基础算法：数据清洗 / 异常剔除 / 聚合 / 统计
================================================
对应开发文档「九、基础算法」。本模块同时承担全管线的公共职责：
    1. 统一的路径常量与列名常量（其余 task*.py / coupling_pca.py 复用）
    2. 原始 JSON 加载 -> 清洗后的 DataFrame（load_clean_data）
    3. 缺失值填充、3σ 异常剔除、按海域+月份聚合、各海域统计量

设计原则（见文档「十三、关键约束」）：
    - 复用而非重写：清洗逻辑只在此实现一次，下游 import 即可
    - 算法用标准库：interpolate / groupby 等 pandas 自带函数，不手写公式
    - 本地优先：无任何云端依赖
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd

# ----------------------------------------------------------------------------
# 路径常量：以 code/ 的上一级作为项目根，保证任意工作目录下都能跑通
# ----------------------------------------------------------------------------
ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT_DIR / "data" / "ocean_atmosphere.json"
OUTPUT_DIR = ROOT_DIR / "output"

# ----------------------------------------------------------------------------
# 列名常量：各模块统一引用，避免散落的硬编码字符串
# ----------------------------------------------------------------------------
# 预测目标
TARGET = "sst"

# 全部数值型变量（用于相关系数矩阵 / 耦合热力图）。
# 原始记录共 16 个字段，去掉 id（标识）、time（日期）、region（类别）后，
# 余下的均为数值型海洋-大气变量，共 13 维。
NUMERIC_COLS = [
    "longitude", "latitude", "sst", "salinity", "wind_speed", "wind_dir",
    "pressure", "precipitation", "co2", "wave_height", "humidity",
    "current_speed", "chlorophyll",
]

# PCA 降维使用的特征：按文档「6.2」去掉 wind_dir（方向角为周期量，不宜直接做 PCA）
PCA_FEATURE_COLS = [c for c in NUMERIC_COLS if c != "wind_dir"]

# 任务2 多变量预测的输入特征（文档「5.3」，基于物理相关性筛选）
PREDICT_FEATURE_COLS = [
    "latitude", "co2", "wind_speed", "salinity",
    "humidity", "pressure", "current_speed",
]

# Okabe-Ito 色盲友好色板对应的 6 海域顺序（前端 data-adapter.js 复用此顺序）
REGION_ORDER = ["太平洋", "大西洋", "印度洋", "北极海域", "南极海域", "赤道区域"]


def ensure_output_dir():
    """确保 output/ 目录存在。"""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def save_json(obj, filename, *, indent=2):
    """统一的 JSON 落盘出口：UTF-8、保留中文、NaN -> null。"""
    ensure_output_dir()
    path = OUTPUT_DIR / filename
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=indent, allow_nan=False)
    return path


def _json_safe(value):
    """把 numpy 标量 / NaN 转成原生可序列化类型。"""
    if isinstance(value, (np.floating, float)):
        return None if pd.isna(value) else float(value)
    if isinstance(value, (np.integer,)):
        return int(value)
    return value


def load_raw():
    """读取原始数据集为 DataFrame，并把 time 解析为 datetime。"""
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        records = json.load(f)
    df = pd.DataFrame(records)
    df["time"] = pd.to_datetime(df["time"])
    return df


def fill_missing(df):
    """缺失值填充：按海域排序后线性插值，首尾残缺再用前/后向填充兜底。"""
    df = df.sort_values(["region", "time"]).reset_index(drop=True)
    filled_parts = []
    for _, g in df.groupby("region", sort=False):
        g = g.copy()
        g[NUMERIC_COLS] = (
            g[NUMERIC_COLS]
            .interpolate(method="linear", limit_direction="both")
            .ffill()
            .bfill()
        )
        filled_parts.append(g)
    return pd.concat(filled_parts).reset_index(drop=True)


def remove_outliers_3sigma(df, col=TARGET):
    """异常值剔除：3σ 原则，按海域分别统计阈值过滤指定列的离群点。

    返回 (清洗后 df, 被剔除的行数)。海域内分别计算均值/标准差，
    避免不同海域温度基线差异导致的误删。
    """
    keep_mask = pd.Series(True, index=df.index)
    for _, g in df.groupby("region", sort=False):
        mu, sigma = g[col].mean(), g[col].std()
        lower, upper = mu - 3 * sigma, mu + 3 * sigma
        in_range = (g[col] >= lower) & (g[col] <= upper)
        keep_mask.loc[g.index] = in_range
    removed = int((~keep_mask).sum())
    return df[keep_mask].reset_index(drop=True), removed


def region_statistics(df, col=TARGET):
    """统计计算：各海域 SST 的均值 / 方差 / 极值。"""
    stats = (
        df.groupby("region")[col]
        .agg(["mean", "var", "min", "max", "count"])
        .reindex(REGION_ORDER)
        .reset_index()
    )
    records = []
    for _, row in stats.iterrows():
        records.append({
            "region": row["region"],
            "sst_mean": _json_safe(round(row["mean"], 4)),
            "sst_var": _json_safe(round(row["var"], 4)),
            "sst_min": _json_safe(round(row["min"], 4)),
            "sst_max": _json_safe(round(row["max"], 4)),
            "count": int(row["count"]),
        })
    return records


def build_records_json(df):
    """导出清洗后记录的关键字段，供前端 Query（查询）/ Search（多维筛选）任务使用。

    保留 id/time/region 与全部 13 个数值维度：既覆盖三级任务（按任意维度
    查询/筛选），又支持星云图按热力图选中的维度重新着色（按 id 关联）。
    数据均为清洗后的真实观测，不做任何编造。
    """
    records = []
    for _, row in df[["id", "time", "region"] + NUMERIC_COLS].iterrows():
        rec = {"id": int(row["id"]),
               "time": row["time"].strftime("%Y-%m-%d"),
               "region": row["region"]}
        for c in NUMERIC_COLS:
            rec[c] = round(float(row[c]), 3)
        records.append(rec)
    return records


def load_clean_data():
    """对外主入口：返回清洗完成、可直接用于建模的 DataFrame。

    下游模块（task1 / task2 / coupling_pca）统一调用本函数，确保它们
    见到的是同一份经过插值 + 3σ 去噪的数据。
    """
    df = load_raw()
    df = fill_missing(df)
    df, _ = remove_outliers_3sigma(df, TARGET)
    return df


def run():
    """独立执行：跑完整清洗流程并落盘统计结果，打印验证信息。"""
    raw = load_raw()
    print(f"[preprocess] 原始记录数：{len(raw)}，海域数：{raw['region'].nunique()}")
    print(f"[preprocess] 时间范围：{raw['time'].min().date()} ~ {raw['time'].max().date()}")

    missing_before = int(raw[NUMERIC_COLS].isna().sum().sum())
    filled = fill_missing(raw)
    missing_after = int(filled[NUMERIC_COLS].isna().sum().sum())
    print(f"[preprocess] 缺失值：填充前 {missing_before} -> 填充后 {missing_after}")

    cleaned, removed = remove_outliers_3sigma(filled, TARGET)
    print(f"[preprocess] 3σ 异常剔除：移除 {removed} 条，剩余 {len(cleaned)} 条")

    stats = region_statistics(cleaned, TARGET)

    save_json(stats, "region_stats.json")
    save_json(build_records_json(cleaned), "records.json")
    print(f"[preprocess] 海域SST统计 -> output/region_stats.json")
    print(f"[preprocess] 记录明细（Query/Search用）-> records.json（{len(cleaned)} 条）")
    return cleaned


if __name__ == "__main__":
    run()
