import requests
import numpy as np
import json 

# ---------- 配置 ----------
SERVICE_URL = "https://infer-app-modelarts-cn-southwest-2.myhuaweicloud.com/v1/infers/84347763-e22e-4c21-9660-d2f938ac870c"  # 请从旧版服务“调用指南”复制
APP_CODE = "d7342a1ce487410b9f530b7da1305cd7680ee704203742b0af7456a554571eb6"

headers = {
    "Content-Type": "application/json",
    "X-Apig-AppCode": APP_CODE
}

# 测试数据（与原代码相同）
test_records = [
    {
        "id": 9999,
        "region": "测试区域",
        "wind_speed": 5.2,
        "pressure": 1012.3,
        "precipitation": 0.0,
        "co2": 412.5,
        "humidity": 78.1,
        "sst": 18.6,
        "salinity": 34.2,
        "current_speed": 0.3,
        "chlorophyll": 0.12
    },
    # ... 其他样本 ...
]

fields = ["wind_speed", "pressure", "precipitation", "co2", "humidity", "sst", "salinity", "current_speed", "chlorophyll"]

payload = {
    "records": test_records,
    "fields": fields
}

# ---------- 发送请求 ----------
try:
    response = requests.post(SERVICE_URL, json=payload, headers=headers, timeout=30)
    print(f"状态码: {response.status_code}")
    print(f"响应内容（前500字符）:\n{response.text[:500]}")
    response.raise_for_status()
except requests.exceptions.RequestException as e:
    print(f"请求失败: {e}")
    exit(1)

# ---------- 解析 JSON（兼容双重序列化） ----------
try:
    result = response.json()
    # 如果 result 是字符串，说明被双重序列化了，再解析一次
    if isinstance(result, str):
        result = json.loads(result)
    print("解析成功，result 类型：", type(result))  # 现在应该是 <class 'dict'>
except Exception as e:
    print("解析 JSON 失败：", e)
    exit(1)


# ---------- 展示结果 ----------
print("\n=== 推理结果 ===")
print(f"总样本数: {result['total_checked']}")
print(f"异常数量: {result['anomaly_count']}")
print(f"异常比例: {result['anomaly_ratio']:.2%}")
print(f"使用的阈值: {result['threshold']}")
print(f"使用的特征: {result['feature_cols']}")
print("\n各区域统计:")
for region, stats in result['by_region'].items():
    print(f"  {region}: 总数={stats['total']}, 异常={stats['anomalies']}")

print("\n详细异常列表:")
for item in result['anomalies']:
    status = "异常" if item['is_anomaly'] else "正常"
    print(f"  ID={item['id']}, 区域={item['region']}, 分数={item['score']:.4f}, 判定={status}")

# 分数统计
scores = [item['score'] for item in result['anomalies'] if item['score'] >= 0]
if scores:
    print(f"\n分数统计: 最小值={min(scores):.4f}, 最大值={max(scores):.4f}, 平均值={np.mean(scores):.4f}")