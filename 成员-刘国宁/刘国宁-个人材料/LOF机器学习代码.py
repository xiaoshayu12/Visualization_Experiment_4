from sklearn.preprocessing import StandardScaler
from dataclasses import dataclass, field
import json
import pandas as pd
import os
import numpy as np
from sklearn.neighbors import LocalOutlierFactor
ALL_NUMERIC_FIELDS = [
    "wind_speed", "wind_dir", "pressure", "precipitation", "co2",
    "humidity", "sst", "salinity", "current_speed", "chlorophyll"
]



@dataclass
class ModelInput:
    """模型标准输入格式"""
    records: list          # 清洗后的数据列表
    fields: list           # 请求分析的目标变量
    regions: list          # 请求分析的目标海区
    params: dict = field(default_factory=dict)  # 模型特定参数


@dataclass
class ModelOutput:
    """模型标准输出格式"""
    ok: bool
    model_name: str
    model_version: str
    result: dict           # 模型返回的有效载荷
    error: str = ""        # 出错时的信息

@dataclass
class ModelMeta:
    """模型元信息"""
    name: str
    version: str
    description: str
    input_schema: dict     # 描述期望的输入结构
    output_schema: dict    # 描述输出的 JSON 结构

class LofModel():
    """基于 LOF（局部异常因子）的密度感知异常检测。"""
    def __init__(self):
        self._loaded = False
        self.lof = None
        self.feature_cols = None
        self.n_neighbors = 20
        self.threshold = None
        self._pretrained_result = None

    def meta(self):
        return ModelMeta(
            name="lof",
            version="1.0.0-lof",
            description="基于 LOF 的密度感知异常检测 — 发现不同海域局部密度下的隐藏异常",
            input_schema={"records": "list", "fields": "list[str]", "regions": "list[str]", "n_neighbors": "int"},
            output_schema={
                "anomalies": "list[{id, region, score, is_anomaly}]",
                "threshold": "float",
                "feature_cols": "list[str]",
                "total_checked": "int",
                "anomaly_count": "int",
                "anomaly_ratio": "float",
                "metric": "lof",
                "n_neighbors": "int",
                "by_region": "dict"
            }
        )

    def is_loaded(self):
        return self._loaded

    def load_pretrained(self, results_path=None):
        """加载预训练的 LOF 结果。文件不存在时返回 False。"""
        if results_path is None:
            results_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                        'models', 'lof_results.json')
        if not os.path.exists(results_path):
            print(f"[LofModel] 预训练文件未找到: {results_path}")
            return False
        with open(results_path, 'r', encoding='utf-8') as f:
            self._pretrained_result = json.load(f)
        self._loaded = True
        self.feature_cols = self._pretrained_result.get('feature_cols', [])
        self.n_neighbors = self._pretrained_result.get('n_neighbors', 20)
        self.threshold = self._pretrained_result.get('threshold', None)
        self._fitted_count = self._pretrained_result.get('total_checked', 0)
        print(f"[LofModel] 预训练结果已加载: {self._pretrained_result['total_checked']} 条, "
              f"{self._pretrained_result['anomaly_count']} 异常")
        return True

    def _fit_predict(self, records, fields, n_neighbors=20):
        """拟合 LOF 模型并返回每条记录的异常检测结果"""
        valid_fields = [f for f in fields if f in records[0] and records[0].get(f) is not None]
        if not valid_fields:
            valid_fields = [f for f in ALL_NUMERIC_FIELDS if f in records[0]]

        # 提取特征矩阵
        data_matrix = []
        valid_indices = []
        for idx, rec in enumerate(records):
            row = []
            skip = False
            for f in valid_fields:
                val = rec.get(f)
                if val is None or not np.isfinite(val):
                    skip = True
                    break
                row.append(float(val))
            if not skip:
                data_matrix.append(row)
                valid_indices.append(idx)

        if len(data_matrix) < 2:
            self._loaded = False
            raise ValueError(f"有效样本数不足（{len(data_matrix)}），无法拟合 LOF 模型。")

        X = np.array(data_matrix)
        self.feature_cols = valid_fields
        self._fitted_count = X.shape[0]
        self.n_neighbors = n_neighbors

        # 拟合 LOF
        self.lof = LocalOutlierFactor(
            n_neighbors=min(n_neighbors, X.shape[0] - 1),
            contamination='auto',
            novelty=False  # 使用 fit_predict 模式
        )
        labels = self.lof.fit_predict(X)  # 1=正常, -1=异常
        raw_scores = -self.lof.negative_outlier_factor_  # 正值，越大越异常

        # 把 raw_scores 转为 0~100 映射
        lo_min = float(np.min(raw_scores))
        lo_max = float(np.max(raw_scores))
        if lo_max > lo_min:
            normalized = (raw_scores - lo_min) / (lo_max - lo_min) * 100
        else:
            normalized = np.zeros_like(raw_scores)

        # 确定阈值：基于 LOF 默认 label 的边界（-1为异常）
        anomaly_indices_lof = np.where(labels == -1)[0]
        if len(anomaly_indices_lof) > 0:
            boundary_score = np.min(normalized[anomaly_indices_lof])
        else:
            boundary_score = np.percentile(normalized, 95)
        self.threshold = float(boundary_score)
        self._scores = normalized

        # 构建结果列表
        anomalies = []
        for i in range(len(records)):
            if i in valid_indices:
                vi = valid_indices.index(i)
                is_anom = bool(labels[vi] == -1)
                anomalies.append({
                    "id": records[i].get("id", "unknown"),
                    "region": records[i].get("region", "unknown"),
                    "score": round(float(normalized[vi]), 4),
                    "is_anomaly": is_anom
                })
            else:
                anomalies.append({
                    "id": records[i].get("id", "unknown"),
                    "region": records[i].get("region", "unknown"),
                    "score": -1,
                    "is_anomaly": False
                })

        self._loaded = True
        print(f"[LofModel] 拟合完成。特征: {self.feature_cols}, n_neighbors={n_neighbors}, 样本: {self._fitted_count}, 阈值(score): {self.threshold:.4f}")

        return anomalies

        
    def predict(self,inp: ModelInput):
        """执行 LOF 推理"""
        if self._pretrained_result is not None:
            return ModelOutput(ok=True, model_name="lof", model_version="1.0.0-lof",
                               result=self._pretrained_result, error="")
        n_neighbors = inp.params.get("n_neighbors", 20)

        try:
            anomalies = self._fit_predict(inp.records, inp.fields, n_neighbors=n_neighbors)
        except Exception as e:
            return ModelOutput(
                ok=False,
                model_name="lof",
                model_version="1.0.0-lof",
                result={},
                error=f"LOF 模型拟合失败: {str(e)}"
            )

        anomaly_count = sum(1 for a in anomalies if a.get("is_anomaly", False))
        total = len(anomalies)

        # 按海域统计
        by_region = {}
        for a in anomalies:
            r = a.get("region", "unknown")
            if r not in by_region:
                by_region[r] = {"total": 0, "anomalies": 0}
            by_region[r]["total"] += 1
            if a.get("is_anomaly"):
                by_region[r]["anomalies"] += 1

        return ModelOutput(
            ok=True,
            model_name="lof",
            model_version="1.0.0-lof",
            result={
                "anomalies": anomalies,
                "threshold": round(self.threshold, 4),
                "feature_cols": self.feature_cols,
                "total_checked": total,
                "anomaly_count": anomaly_count,
                "anomaly_ratio": round(anomaly_count / total, 4) if total else 0,
                "metric": "lof",
                "n_neighbors": self.n_neighbors,
                "by_region": by_region
            },
            error=""
        )

model = LofModel()
# 若需要调整邻域大小，可通过参数传入
your_records = pd.read_json("./clean_records.json")
your_fields = pd.read_json("./feature_cols.json")
records = your_records.to_dict('records')
regions = list(set(rec['region'] for rec in records))
inp = ModelInput(
    records=records,   # list of dict
    fields=your_fields,    # optional, list of field names
    regions=regions,
    params={"n_neighbors": 20}  # 可选，默认20
)
lof_output = model.predict(inp)
with open("lof_results.json", "w") as f:
    json.dump(lof_output.result, f)