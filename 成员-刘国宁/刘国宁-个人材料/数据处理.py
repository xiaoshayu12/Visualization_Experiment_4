import json
import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler


def preprocess_for_lof(records):
    
    df = pd.DataFrame(records)
    # 1. 定义各海域的正常物理阈值（基于领域常识）
    bounds = {
        'sst': (-2, 35),
        'salinity': (30, 38),   # 排除 0 和极高值
        # 其他特征暂不设硬阈值，留待 LOF 识别
    }
    
    # 2. 按海域分组处理（避免引入跨海域偏差）
    processed_dfs = []
    for region, group in df.groupby('region'):
        g = group.copy()
        
        # 2.1 硬阈值清洗 + 中位数填充
        for col, (low, high) in bounds.items():
            if col in g.columns:
                # 将异常物理值设为 NaN
                mask = (g[col] < low) | (g[col] > high) | (g[col] == 0)
                g.loc[mask, col] = np.nan
                # 用该海域该列的中位数填充
                median_val = g[col].median()
                g[col].fillna(median_val, inplace=True)
        
        # 2.2 处理循环特征 wind_dir (若存在)
        if 'wind_dir' in g.columns:
            g['wind_dir_sin'] = np.sin(np.radians(g['wind_dir']))
            g['wind_dir_cos'] = np.cos(np.radians(g['wind_dir']))
            g.drop(columns=['wind_dir'], inplace=True)  # 删掉原始列
        
        # 2.3 选择最终特征（删除非数值列）
        feature_cols = ['sst', 'salinity', 'wind_speed', 'pressure', 'precipitation', 
                        'co2', 'wave_height', 'humidity', 'current_speed', 'chlorophyll',
                        'wind_dir_sin', 'wind_dir_cos']  # 根据实际调整
        available_cols = [c for c in feature_cols if c in g.columns]
        
        # 2.4 标准化（仅对当前海域拟合 Scaler，避免数据泄露）
        scaler = StandardScaler()
        g[available_cols] = scaler.fit_transform(g[available_cols].values)
        
        processed_dfs.append(g)
    
    # 合并回所有海域
    final_df = pd.concat(processed_dfs, ignore_index=True)
    
    # 转回 records 格式（ModelInput 需要 list of dict）
    return final_df.to_dict('records'), available_cols

df = pd.read_json("./data/第2组-全球海洋大气耦合-实验3-地理数据.json")
clean_records, feature_cols = preprocess_for_lof(df)
with open("clean_records.json", "w") as f:
    json.dump(clean_records, f)
with open("feature_cols.json", "w") as f:
    json.dump(feature_cols, f)