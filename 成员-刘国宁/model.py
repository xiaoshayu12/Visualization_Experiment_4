"""
全球海洋-大气耦合时空可视分析系统 — 模型层
---
模型集成入口。本文件定义模型接口规范和占位实现。
接入真实模型时：替换占位类，保持接口不变即可。
"""

import os
import json
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional
import numpy as np

from sklearn.neighbors import LocalOutlierFactor

import torch
import torch.nn as nn
import torch.optim as optim

# --- 0. 数据 Schema ---
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


# --- 1. 模型接口（ABC）---

class ModelInterface(ABC):
    """所有模型必须实现的接口"""

    @abstractmethod
    def meta(self) -> ModelMeta:
        """返回模型元信息"""
        ...

    @abstractmethod
    def is_loaded(self) -> bool:
        """模型是否已加载到内存"""
        ...

    @abstractmethod
    def predict(self, inp: ModelInput) -> ModelOutput:
        """执行推理"""
        ...


# --- 2. 模型注册表 ---

class ModelRegistry:
    """管理所有已注册模型，按名称获取"""

    def __init__(self):
        self._models: dict[str, ModelInterface] = {}

    def register(self, model: ModelInterface):
        self._models[model.meta().name] = model

    def get(self, name: str) -> Optional[ModelInterface]:
        return self._models.get(name)

    def list_models(self) -> list[ModelMeta]:
        return [m.meta() for m in self._models.values()]

    def is_ready(self, name: str) -> bool:
        m = self._models.get(name)
        return m is not None and m.is_loaded()


# --- 3. 模型实现 ---

# --- 3a. LOF 密度感知异常检测 ---
class LofModel(ModelInterface):
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

    def predict(self, inp: ModelInput):
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


# --- 3b. Autoencoder 深度学习异常检测 ---
class AutoencoderModel(ModelInterface):
    """
    基于 Autoencoder 的深度学习异常检测。
    通过学习正常数据的压缩-重建模式，将重建误差大的记录标记为异常。
    架构: 10→6→3→6→10（对称瓶颈）
    """
    def __init__(self):
        self._loaded = False
        self.model = None
        self.feature_cols = None
        self.threshold = None
        self._mean = None
        self._std = None
        self._train_losses = []
        self._pretrained_result = None

    def meta(self):
        return ModelMeta(
            name="autoencoder",
            version="1.0.0-autoencoder",
            description="基于 Autoencoder 的深度学习异常检测 — 非线性压缩重建，捕捉多维耦合异常",
            input_schema={"records": "list", "fields": "list[str]", "regions": "list[str]",
                          "hidden_dim": "int", "latent_dim": "int", "epochs": "int",
                          "lr": "float", "contamination": "float"},
            output_schema={
                "anomalies": "list[{id, region, score, is_anomaly}]",
                "threshold": "float",
                "feature_cols": "list[str]",
                "total_checked": "int",
                "anomaly_count": "int",
                "anomaly_ratio": "float",
                "metric": "autoencoder",
                "hidden_dim": "int",
                "latent_dim": "int",
                "train_info": "dict",
                "by_region": "dict"
            }
        )

    def is_loaded(self):
        return self._loaded

    def load_pretrained(self, results_path=None, weights_path=None, norm_path=None):
        base_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models')
        if results_path is None: results_path = os.path.join(base_dir, 'autoencoder_results.json')
        if weights_path is None: weights_path = os.path.join(base_dir, 'autoencoder_weights.pt')
        if norm_path is None: norm_path = os.path.join(base_dir, 'autoencoder_norm.json')

        missing = [p for p in [results_path, weights_path, norm_path] if not os.path.exists(p)]
        if missing:
            print(f"[AutoencoderModel] 预训练文件未找到: {missing}")
            return False

        with open(results_path, 'r', encoding='utf-8') as f:
            self._pretrained_result = json.load(f)
        with open(norm_path, 'r', encoding='utf-8') as f:
            norm = json.load(f)
        self._mean = np.array(norm['mean'])
        self._std = np.array(norm['std'])
        self.feature_cols = self._pretrained_result.get('feature_cols', ALL_NUMERIC_FIELDS)
        self.threshold = self._pretrained_result.get('threshold', None)
        self._fitted_count = self._pretrained_result.get('total_checked', 0)

        input_dim = len(self.feature_cols)
        hidden_dim = self._pretrained_result.get('hidden_dim', 6)
        latent_dim = self._pretrained_result.get('latent_dim', 3)
        self.model = self._build_model(input_dim, hidden_dim, latent_dim)
        self.model.load_state_dict(torch.load(weights_path, map_location='cpu'))
        self.model.eval()
        self._loaded = True
        return True

    def _build_model(self, input_dim, hidden_dim, latent_dim):
        """构建对称瓶颈自编码器"""
        encoder = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, latent_dim),
            nn.ReLU(),
        )
        decoder = nn.Sequential(
            nn.Linear(latent_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, input_dim),
            nn.ReLU(),
        )
        return nn.Sequential(encoder, decoder)

    def _fit_predict(self, records, fields, hidden_dim=6, latent_dim=3,
                     epochs=200, lr=0.001, contamination=0.05):
        """训练 Autoencoder 并检测异常"""
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

        if len(data_matrix) < 10:
            self._loaded = False
            raise ValueError(f"有效样本数不足（{len(data_matrix)}），无法训练 Autoencoder。")

        X = np.array(data_matrix)
        self.feature_cols = valid_fields
        self._fitted_count = X.shape[0]
        input_dim = X.shape[1]

        # 标准化
        self._mean = np.mean(X, axis=0)
        self._std = np.std(X, axis=0)
        self._std[self._std == 0] = 1e-8
        X_norm = (X - self._mean) / self._std

        # 构建模型
        hidden_dim = min(hidden_dim, input_dim - 1)
        latent_dim = min(latent_dim, hidden_dim - 1)
        self.model = self._build_model(input_dim, hidden_dim, latent_dim)
        optimizer = optim.Adam(self.model.parameters(), lr=lr)
        criterion = nn.MSELoss()

        X_tensor = torch.tensor(X_norm, dtype=torch.float32)

        # 训练
        self._train_losses = []
        best_loss = float('inf')
        best_state = None
        patience_counter = 0
        patience = 20

        self.model.train()
        for epoch in range(epochs):
            optimizer.zero_grad()
            reconstructed = self.model(X_tensor)
            loss = criterion(reconstructed, X_tensor)
            loss.backward()
            optimizer.step()

            loss_val = loss.item()
            self._train_losses.append(loss_val)

            if loss_val < best_loss:
                best_loss = loss_val
                best_state = {k: v.clone() for k, v in self.model.state_dict().items()}
                patience_counter = 0
            else:
                patience_counter += 1

            if patience_counter >= patience:
                break

        # 恢复最佳状态
        if best_state:
            self.model.load_state_dict(best_state)

        # 计算重建误差
        self.model.eval()
        with torch.no_grad():
            reconstructed = self.model(X_tensor)
            mse = torch.mean((reconstructed - X_tensor) ** 2, dim=1).numpy()

        # 归一化得分 0~100
        mse_min = float(np.min(mse))
        mse_max = float(np.max(mse))
        if mse_max > mse_min:
            scores = (mse - mse_min) / (mse_max - mse_min) * 100
        else:
            scores = np.zeros_like(mse)

        # 阈值：按 contamination 分位数确定
        threshold_pct = 100 - contamination * 100
        self.threshold = float(np.percentile(scores, threshold_pct))
        self._scores = scores

        # 构建结果
        anomalies = []
        for i in range(len(records)):
            if i in valid_indices:
                vi = valid_indices.index(i)
                is_anom = bool(scores[vi] >= self.threshold)
                anomalies.append({
                    "id": records[i].get("id", "unknown"),
                    "region": records[i].get("region", "unknown"),
                    "score": round(float(scores[vi]), 4),
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
        print(f"[AutoencoderModel] 训练完成。特征: {self.feature_cols}, "
              f"架构: {input_dim}→{hidden_dim}→{latent_dim}→{hidden_dim}→{input_dim}, "
              f"样本: {self._fitted_count}, initial_loss: {self._train_losses[0]:.4f}, "
              f"final_loss: {self._train_losses[-1]:.4f}, 阈值(score): {self.threshold:.4f}")

        return anomalies

    def predict(self, inp: ModelInput):
        """执行 Autoencoder 推理"""
        if self._pretrained_result is not None:
            return ModelOutput(ok=True, model_name="autoencoder", model_version="1.0.0-autoencoder",
                               result=self._pretrained_result, error="")
        hidden_dim = inp.params.get("hidden_dim", 6)
        latent_dim = inp.params.get("latent_dim", 3)
        epochs = inp.params.get("epochs", 200)
        lr = inp.params.get("lr", 0.001)
        contamination = inp.params.get("contamination", 0.05)

        try:
            anomalies = self._fit_predict(
                inp.records, inp.fields,
                hidden_dim=hidden_dim, latent_dim=latent_dim,
                epochs=epochs, lr=lr, contamination=contamination
            )
        except Exception as e:
            return ModelOutput(
                ok=False,
                model_name="autoencoder",
                model_version="1.0.0-autoencoder",
                result={},
                error=f"Autoencoder 模型训练失败: {str(e)}"
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
            model_name="autoencoder",
            model_version="1.0.0-autoencoder",
            result={
                "anomalies": anomalies,
                "threshold": round(self.threshold, 4),
                "feature_cols": self.feature_cols,
                "total_checked": total,
                "anomaly_count": anomaly_count,
                "anomaly_ratio": round(anomaly_count / total, 4) if total else 0,
                "metric": "autoencoder",
                "hidden_dim": hidden_dim,
                "latent_dim": latent_dim,
                "train_info": {
                    "initial_loss": round(self._train_losses[0], 6) if self._train_losses else 0,
                    "final_loss": round(self._train_losses[-1], 6) if self._train_losses else 0,
                    "epochs_trained": len(self._train_losses),
                },
                "by_region": by_region
            },
            error=""
        )

# --- 4. 全局注册表（单例）---

registry = ModelRegistry()
registry.register(LofModel())
registry.register(AutoencoderModel())

# --- 5. 便捷函数 ---

def get_registry() -> ModelRegistry:
    return registry


def model_status() -> dict:
    """返回所有模型的状态摘要"""
    models = []
    for m in registry.list_models():
        ready = registry.is_ready(m.name)
        models.append({
            "name": m.name,
            "version": m.version,
            "description": m.description,
            "loaded": ready,
            "status": "ready" if ready else "placeholder"
        })
    return {"models": models, "any_ready": any(m["loaded"] for m in models)}


def run_model(model_name: str, inp: ModelInput) -> ModelOutput:
    """按名称运行指定模型"""
    model = registry.get(model_name)
    if model is None:
        return ModelOutput(
            ok=False, model_name=model_name, model_version="unknown",
            result={}, error=f"未找到模型 '{model_name}'"
        )
    return model.predict(inp)


if __name__ == "__main__":
    # 模块测试：打印模型状态
    status = model_status()
    print(json.dumps(status, indent=2))