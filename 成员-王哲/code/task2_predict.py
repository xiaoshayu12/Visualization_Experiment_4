# -*- coding: utf-8 -*-
"""
任务2：轻量 AI 机器学习模型 —— 多变量 SST 预测
================================================
对应开发文档「五、任务2」与 Tamara 任务层，覆盖 Analyze/Search/Query 三级子任务。

不只用时间预测温度，而是用多维度耦合关系预测 SST：
    - 主模型：随机森林回归（输出特征重要性，适合耦合分析）
    - 对比模型：线性回归（提供可解释系数，用于贡献瀑布图）
    - 8:2 划分，输出 R² / MAE / RMSE

并实现统一预测入口 predict()，为未来接昇腾 ModelArts 预留：
    当前本地 sklearn 实现，未来只替换函数体，调用方不变。
"""

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

import preprocess as pp

RANDOM_STATE = 42

# ----------------------------------------------------------------------------
# 模块级模型工件：训练一次后由 predict() 复用（模拟"服务常驻"语义）
# ----------------------------------------------------------------------------
_SCALER = None            # StandardScaler
_RF_MODEL = None          # 主模型 RandomForestRegressor
_LINEAR_MODEL = None      # 对比模型 LinearRegression
_FEATURE_COLS = None      # 工程化后的特征列顺序（含 region one-hot 与 month）


def build_features(df):
    """特征工程：数值特征 + region one-hot + 时间特征 month。

    返回 (X: DataFrame, y: Series)。列顺序固定，供训练与预测保持一致。
    """
    feat = df[pp.PREDICT_FEATURE_COLS].copy()
    # 时间特征：从 time 提取 month，捕捉季节性
    feat["month"] = df["time"].dt.month.values
    # 类别字段 region 做 one-hot 编码
    region_dummies = pd.get_dummies(df["region"], prefix="region", dtype=float)
    region_dummies = region_dummies.reindex(
        columns=[f"region_{r}" for r in pp.REGION_ORDER], fill_value=0.0
    )
    X = pd.concat([feat.reset_index(drop=True),
                   region_dummies.reset_index(drop=True)], axis=1)
    # 预测未来时无目标列，y 返回 None；训练/评估时正常返回目标
    y = df[pp.TARGET].reset_index(drop=True) if pp.TARGET in df.columns else None
    return X, y


def train_models(df):
    """训练随机森林与线性回归，返回评估所需的测试集与指标。"""
    global _SCALER, _RF_MODEL, _LINEAR_MODEL, _FEATURE_COLS

    X, y = build_features(df)
    _FEATURE_COLS = list(X.columns)

    # 保留原始元信息（id/time/region），便于前端按样本回查
    meta = df[["id", "time", "region"]].reset_index(drop=True)

    X_train, X_test, y_train, y_test, meta_train, meta_test = train_test_split(
        X, y, meta, test_size=0.2, random_state=RANDOM_STATE
    )

    # 标准化：在训练集上 fit，避免测试集信息泄漏
    _SCALER = StandardScaler().fit(X_train.values)
    X_train_s = _SCALER.transform(X_train.values)
    X_test_s = _SCALER.transform(X_test.values)

    _RF_MODEL = RandomForestRegressor(
        n_estimators=200, max_depth=None, random_state=RANDOM_STATE, n_jobs=-1
    ).fit(X_train_s, y_train.values)

    _LINEAR_MODEL = LinearRegression().fit(X_train_s, y_train.values)

    return {
        "X_test": X_test, "X_test_s": X_test_s,
        "y_test": y_test, "meta_test": meta_test,
    }


def predict(features: pd.DataFrame) -> np.ndarray:
    """统一预测入口。当前本地 sklearn 实现；
    未来接 ModelArts 时只替换函数体，调用方不变。

    参数 features：经 build_features 工程化后的特征表（列与训练一致）。
    返回：SST 预测值数组。
    """
    if _RF_MODEL is None or _SCALER is None:
        # 懒加载：若尚未训练，则用清洗后的全量数据训练一次
        train_models(pp.load_clean_data())
    X = features.reindex(columns=_FEATURE_COLS, fill_value=0.0).values
    X_scaled = _SCALER.transform(X)
    return _RF_MODEL.predict(X_scaled)


def _metrics(y_true, y_pred):
    """统一计算 R² / MAE / RMSE。"""
    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
    return {
        "r2": round(float(r2_score(y_true, y_pred)), 4),
        "mae": round(float(mean_absolute_error(y_true, y_pred)), 4),
        "rmse": round(rmse, 4),
    }


def _aggregate_region_importance(importances):
    """把 region one-hot 的多列重要性合并成单一 'region' 项。"""
    agg = {}
    for col, imp in zip(_FEATURE_COLS, importances):
        key = "region" if col.startswith("region_") else col
        agg[key] = agg.get(key, 0.0) + float(imp)
    return agg


def build_prediction_json(artifacts):
    """构造 prediction.json：双模型指标 + 测试集真实/预测 + 各海域误差 + 贡献分解。"""
    X_test_s = artifacts["X_test_s"]
    y_test = artifacts["y_test"].values
    meta_test = artifacts["meta_test"].reset_index(drop=True)

    y_pred_rf = _RF_MODEL.predict(X_test_s)
    y_pred_lr = _LINEAR_MODEL.predict(X_test_s)

    # 线性模型逐样本贡献分解（瀑布图）：baseline=截距，贡献=系数×标准化特征值
    intercept = float(_LINEAR_MODEL.intercept_)
    coef = _LINEAR_MODEL.coef_
    contrib_matrix = X_test_s * coef  # 形状 (N, n_features)

    # 把 region one-hot 各列的贡献并到单一 'region' 项，便于瀑布图阅读
    waterfall_keys = pp.PREDICT_FEATURE_COLS + ["month", "region"]

    test_records = []
    for i in range(len(y_test)):
        contributions = {k: 0.0 for k in waterfall_keys}
        for col, c in zip(_FEATURE_COLS, contrib_matrix[i]):
            key = "region" if col.startswith("region_") else col
            contributions[key] += float(c)
        contributions = {k: round(v, 4) for k, v in contributions.items()}
        test_records.append({
            "id": int(meta_test.loc[i, "id"]),
            "time": meta_test.loc[i, "time"].strftime("%Y-%m-%d"),
            "region": meta_test.loc[i, "region"],
            "y_true": round(float(y_test[i]), 3),
            "y_pred": round(float(y_pred_rf[i]), 3),
            "y_pred_lr": round(float(y_pred_lr[i]), 3),
            "baseline": round(intercept, 4),
            "contributions": contributions,
        })

    # 各海域预测误差（随机森林主模型）
    region_error = []
    df_err = pd.DataFrame({
        "region": meta_test["region"].values,
        "y_true": y_test, "y_pred": y_pred_rf,
    })
    for region in pp.REGION_ORDER:
        g = df_err[df_err["region"] == region]
        if g.empty:
            continue
        region_error.append({
            "region": region,
            "count": int(len(g)),
            **_metrics(g["y_true"], g["y_pred"]),
        })

    return {
        "metrics": {
            "random_forest": _metrics(y_test, y_pred_rf),
            "linear_regression": _metrics(y_test, y_pred_lr),
        },
        "waterfall_keys": waterfall_keys,
        "region_error": region_error,
        "test": test_records,
    }


def build_feature_importance_json():
    """构造 feature_importance.json：随机森林特征重要性（region 已聚合）。"""
    agg = _aggregate_region_importance(_RF_MODEL.feature_importances_)
    items = [{"feature": k, "importance": round(v, 4)}
             for k, v in sorted(agg.items(), key=lambda kv: kv[1], reverse=True)]
    return {"model": "RandomForestRegressor", "importance": items}


def _rf_ensemble_predict(features: pd.DataFrame):
    """用训练好的随机森林做预测，并返回每棵树预测的均值与标准差。

    返回 (mean, std)：mean 即 RF 的预测值；std 为森林内各决策树预测的离散度，
    作为模型自带的不确定性度量（用于置信区间），而非人为假设的残差。
    """
    X = features.reindex(columns=_FEATURE_COLS, fill_value=0.0).values
    X_scaled = _SCALER.transform(X)
    # 形状 (n_trees, n_samples)：逐棵树预测
    per_tree = np.stack([est.predict(X_scaled) for est in _RF_MODEL.estimators_])
    return per_tree.mean(axis=0), per_tree.std(axis=0)


def _build_future_features(g, future_dates):
    """为某海域构造未来日期的输入特征向量（喂给训练模型）。

    特征来源严格基于历史观测，不编造：
      - 季节性变量（纬度/风速/盐度/湿度/气压/流速）：取该海域「逐月气候态均值」，
        即历史同月实测值的平均，捕捉季节循环；
      - CO₂：呈持续上升趋势，用历史观测拟合 day->co2 线性趋势并外推，
        反映其单调上升而非用历史均值（否则会系统性低估未来）。
    返回可直接传入 build_features 的 DataFrame（含 time/region 列）。
    """
    region = g["region"].iloc[0]
    g = g.copy()
    g["month"] = g["time"].dt.month
    # 逐月气候态：历史同月各特征的均值
    monthly_clim = g.groupby("month")[pp.PREDICT_FEATURE_COLS].mean()

    # CO₂ 线性趋势外推（基于真实观测拟合）
    t0 = g["time"].min()
    g["day"] = (g["time"] - t0).dt.days
    co2_lr = LinearRegression().fit(g[["day"]].values, g["co2"].values)

    rows = []
    for fd in future_dates:
        month = fd.month
        # 若某月历史缺失（一般不会），回退到全局均值
        clim = (monthly_clim.loc[month] if month in monthly_clim.index
                else g[pp.PREDICT_FEATURE_COLS].mean())
        row = {c: float(clim[c]) for c in pp.PREDICT_FEATURE_COLS}
        future_day = int((fd - t0).days)
        row["co2"] = float(co2_lr.predict([[future_day]])[0])  # 用趋势覆盖气候态
        row["time"] = fd
        row["region"] = region
        rows.append(row)
    return pd.DataFrame(rows)


def build_forecast_json(df, horizon_days=180, span=10):
    """构造 forecast.json：由训练好的随机森林预测未来 SST + 95% 置信区间。

    与 prediction.json 同源——调用同一个训练模型，而非对曲线做直线外推：
      1. 为每个海域构造未来特征向量（逐月气候态 + CO₂ 趋势外推，见 _build_future_features）；
      2. 用训练好的 RF predict 出未来 SST；
      3. 置信区间取森林内各树预测的离散度 ±1.96σ（模型自带不确定性）。
    """
    if _RF_MODEL is None or _SCALER is None:
        train_models(df)

    forecasts = {}
    for region in pp.REGION_ORDER:
        g = df[df["region"] == region].sort_values("time").copy()
        if len(g) < 30:
            continue

        last_time = g["time"].max()
        # 每 15 天一个未来预测点
        future_dates = [last_time + pd.Timedelta(days=d)
                        for d in range(15, horizon_days + 1, 15)]

        future_feat = _build_future_features(g, future_dates)
        X_future, _ = build_features(future_feat)         # 与训练同一套特征工程
        yhat, yhat_std = _rf_ensemble_predict(X_future)   # 训练模型预测 + 不确定性

        future_points = []
        for fd, mu, sd in zip(future_dates, yhat, yhat_std):
            ci = 1.96 * float(sd)
            future_points.append({
                "time": fd.strftime("%Y-%m-%d"),
                "yhat": round(float(mu), 3),
                "lower": round(float(mu) - ci, 3),
                "upper": round(float(mu) + ci, 3),
            })

        # anchor 为最近一个平滑实测值，保证前端预测曲线与历史曲线衔接
        anchor_sst = float(g["sst"].ewm(span=span).mean().iloc[-1])
        forecasts[region] = {
            "anchor": {
                "time": last_time.strftime("%Y-%m-%d"),
                "sst_ewm": round(anchor_sst, 3),
            },
            "forecast": future_points,
        }
    return {
        "horizon_days": horizon_days,
        "span": span,
        "model": "RandomForestRegressor",
        "ci_method": "ensemble_tree_std_1.96sigma",
        "feature_assumption": "monthly_climatology + co2_linear_trend",
        "series": forecasts,
    }


def run(df=None):
    """执行任务2：训练 + 评估 + 生成 3 个 JSON。"""
    if df is None:
        df = pp.load_clean_data()

    artifacts = train_models(df)

    prediction = build_prediction_json(artifacts)
    pp.save_json(prediction, "prediction.json")
    pp.save_json(build_feature_importance_json(), "feature_importance.json")
    pp.save_json(build_forecast_json(df), "forecast.json")

    rf = prediction["metrics"]["random_forest"]
    lr = prediction["metrics"]["linear_regression"]
    print(f"[task2] 随机森林 R²={rf['r2']} MAE={rf['mae']} RMSE={rf['rmse']}")
    print(f"[task2] 线性回归 R²={lr['r2']} MAE={lr['mae']} RMSE={lr['rmse']}")
    print(f"[task2] 测试集 {len(prediction['test'])} 样本 -> prediction.json / "
          f"feature_importance.json / forecast.json")
    return prediction


if __name__ == "__main__":
    run()
