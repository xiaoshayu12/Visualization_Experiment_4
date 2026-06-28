# -*- coding: utf-8 -*-
"""
降维耦合分析：PCA 三维投影 + 相关系数矩阵
================================================
对应开发文档「六、降维耦合分析」，是主视图「3D 耦合星云图」与
辅助视图「特征耦合热力图」的数据基础。

    1. 对标准化后的数值特征做 PCA(n_components=3)，得到每条记录的三个主成分坐标
    2. 计算数值变量两两 Pearson 相关系数矩阵
    3. 输出三个主成分的方差解释率
"""

import pandas as pd
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

import preprocess as pp


def compute_pca(df):
    """对 PCA_FEATURE_COLS 标准化后降到 3 维，返回坐标 DataFrame 与解释率。"""
    X = df[pp.PCA_FEATURE_COLS].values
    X_scaled = StandardScaler().fit_transform(X)  # 沿用任务1的归一化思想

    pca = PCA(n_components=3, random_state=42)
    coords = pca.fit_transform(X_scaled)

    points = df[["id", "region", "co2", "sst"]].copy().reset_index(drop=True)
    points["pc1"] = coords[:, 0]
    points["pc2"] = coords[:, 1]
    points["pc3"] = coords[:, 2]
    return points, pca.explained_variance_ratio_


def build_points_json(points):
    """构造 pca_points.json：每条记录的三维坐标 + region/co2/sst。"""
    records = []
    for _, row in points.iterrows():
        records.append({
            "id": int(row["id"]),
            "pc1": round(float(row["pc1"]), 4),
            "pc2": round(float(row["pc2"]), 4),
            "pc3": round(float(row["pc3"]), 4),
            "region": row["region"],
            "co2": round(float(row["co2"]), 2),
            "sst": round(float(row["sst"]), 2),
        })
    return records


def build_correlation_json(df):
    """计算数值变量两两 Pearson 相关系数矩阵（耦合热力图数据）。"""
    corr = df[pp.NUMERIC_COLS].corr(method="pearson")
    return {
        "labels": pp.NUMERIC_COLS,
        "matrix": [[round(float(v), 4) for v in row] for row in corr.values],
    }


def run(df=None):
    """执行降维耦合分析：生成 3 个 JSON。"""
    if df is None:
        df = pp.load_clean_data()

    points, explained = compute_pca(df)

    pp.save_json(build_points_json(points), "pca_points.json")
    pp.save_json(build_correlation_json(df), "correlation_matrix.json")

    explained_payload = {
        "components": ["PC1", "PC2", "PC3"],
        "explained_variance_ratio": [round(float(r), 4) for r in explained],
        "cumulative": round(float(sum(explained)), 4),
    }
    pp.save_json(explained_payload, "pca_explained.json")

    print(f"[pca] PCA 3维完成：{len(points)} 点，"
          f"累计方差解释率 {explained_payload['cumulative']:.2%}")
    print(f"[pca] 相关矩阵 {len(pp.NUMERIC_COLS)}×{len(pp.NUMERIC_COLS)} -> correlation_matrix.json")
    return explained_payload


if __name__ == "__main__":
    run()
