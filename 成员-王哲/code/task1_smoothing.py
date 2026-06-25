# -*- coding: utf-8 -*-
"""
任务1：标准时空数据变换 —— 滑动平均趋势提取
================================================
对应开发文档「四、任务1」与 Tamara 抽象层（数据抽象）。

把抖动的原始 SST 时间序列平滑成趋势线，作为任务2预测模型的前置输入。
按 region 分组、按 time 排序，分别计算两种平滑供前端对比：
    - 简单滑动平均：rolling(window=W, min_periods=1).mean()
    - 指数加权平均：ewm(span=W).mean()

窗口 W 默认 10，作为可调参数（前端时序图滑块复用此参数）。
全部使用 pandas 自带函数，不手写公式。
"""

import json

import preprocess as pp

DEFAULT_WINDOW = 10  # 默认滑动窗口，前端滑块默认值与此一致


def smooth_by_region(df, window=DEFAULT_WINDOW):
    """按海域分组做两种平滑，返回 {region: [{time, sst_raw, sst_ma, sst_ewm}]}。"""
    result = {}
    for region in pp.REGION_ORDER:
        g = df[df["region"] == region].sort_values("time").copy()
        if g.empty:
            continue
        # 简单滑动平均：min_periods=1 让序列开头也有值，避免前 W-1 个 NaN
        g["sst_ma"] = g["sst"].rolling(window=window, min_periods=1).mean()
        # 指数加权平均：越近的观测权重越大，对趋势变化更敏感
        g["sst_ewm"] = g["sst"].ewm(span=window).mean()

        series = []
        for _, row in g.iterrows():
            series.append({
                "time": row["time"].strftime("%Y-%m-%d"),
                "sst_raw": round(float(row["sst"]), 3),
                "sst_ma": round(float(row["sst_ma"]), 3),
                "sst_ewm": round(float(row["sst_ewm"]), 3),
            })
        result[region] = series
    return result


def run(window=DEFAULT_WINDOW, df=None):
    """执行任务1：生成 output/smoothed.json。"""
    if df is None:
        df = pp.load_clean_data()
    smoothed = smooth_by_region(df, window=window)

    payload = {
        "window": window,                 # 记录使用的窗口，前端初始化滑块
        "regions": pp.REGION_ORDER,
        "series": smoothed,
    }
    path = pp.save_json(payload, "smoothed.json")
    total = sum(len(v) for v in smoothed.values())
    print(f"[task1] 滑动平均(W={window}) 完成：{len(smoothed)} 海域 / {total} 点 -> {path.name}")
    return payload


if __name__ == "__main__":
    run()
