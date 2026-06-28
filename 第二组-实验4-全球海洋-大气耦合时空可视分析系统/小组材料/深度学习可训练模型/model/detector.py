import json
import numpy as np
import mindspore as ms
from mindspore import Tensor, load_checkpoint, load_param_into_net
import os

# ---------- 常量 ----------
ALL_NUMERIC_FIELDS = [
    "wind_speed", "wind_dir", "pressure", "precipitation", "co2",
    "humidity", "sst", "salinity", "current_speed", "chlorophyll"
]

# ---------- 核心推理类（与框架无关，纯粹的业务逻辑） ----------
class AutoencoderDetector:
    """封装加载、预测、异常检测逻辑，与框架解耦"""
    def __init__(self, model_dir):
        self.model = None
        self.feature_cols = None
        self.threshold = None
        self._mean = None
        self._std = None
        self._loaded = False
        self._load_model(model_dir)

    def _load_model(self, model_dir):
        weights_path = os.path.join(model_dir, 'autoencoder_weights.ckpt')
        norm_path = os.path.join(model_dir, 'autoencoder_norm.json')
        result_path = os.path.join(model_dir, 'autoencoder_results.json')

        # 加载归一化参数
        with open(norm_path, 'r') as f:
            norm = json.load(f)
        self._mean = np.array(norm['mean'])
        self._std = np.array(norm['std'])

        # 加载结果文件
        with open(result_path, 'r') as f:
            res = json.load(f)
        self.feature_cols = res.get('feature_cols', ALL_NUMERIC_FIELDS)
        self.threshold = res.get('threshold', None)
        input_dim = len(self.feature_cols)
        hidden_dim = res.get('hidden_dim', 6)
        latent_dim = res.get('latent_dim', 3)

        # 定义网络结构（内联）
        class Encoder(ms.nn.Cell):
            def __init__(self):
                super().__init__()
                self.fc1 = ms.nn.Dense(input_dim, hidden_dim)
                self.fc2 = ms.nn.Dense(hidden_dim, latent_dim)
                self.relu = ms.nn.ReLU()
            def construct(self, x):
                x = self.relu(self.fc1(x))
                x = self.relu(self.fc2(x))
                return x

        class Decoder(ms.nn.Cell):
            def __init__(self):
                super().__init__()
                self.fc3 = ms.nn.Dense(latent_dim, hidden_dim)
                self.fc4 = ms.nn.Dense(hidden_dim, input_dim)
                self.relu = ms.nn.ReLU()
            def construct(self, x):
                x = self.relu(self.fc3(x))
                x = self.relu(self.fc4(x))
                return x

        class Autoencoder(ms.nn.Cell):
            def __init__(self):
                super().__init__()
                self.encoder = Encoder()
                self.decoder = Decoder()
            def construct(self, x):
                return self.decoder(self.encoder(x))

        self.model = Autoencoder()
        param_dict = load_checkpoint(weights_path)
        load_param_into_net(self.model, param_dict)
        self.model.set_train(False)
        self._loaded = True

    def predict(self, records, fields=None):
        if not self._loaded:
            raise RuntimeError("Model not loaded.")

        if fields is None:
            fields = self.feature_cols
        else:
            fields = [f for f in fields if f in self.feature_cols]
        if not fields:
            fields = self.feature_cols

        data_matrix = []
        valid_indices = []
        for idx, rec in enumerate(records):
            row = []
            skip = False
            for f in fields:
                val = rec.get(f)
                if val is None or not np.isfinite(val):
                    skip = True
                    break
                row.append(float(val))
            if not skip:
                data_matrix.append(row)
                valid_indices.append(idx)

        if not data_matrix:
            return {"error": "No valid records provided."}

        X = np.array(data_matrix)
        X_norm = (X - self._mean) / self._std
        X_tensor = Tensor(X_norm, dtype=ms.float32)

        reconstructed = self.model(X_tensor)
        mse = ms.ops.mean((reconstructed - X_tensor) ** 2, axis=1).asnumpy()

        mse_min, mse_max = float(np.min(mse)), float(np.max(mse))
        scores = (mse - mse_min) / (mse_max - mse_min) * 100 if mse_max > mse_min else np.zeros_like(mse)

        anomalies = []
        for i, rec in enumerate(records):
            if i in valid_indices:
                vi = valid_indices.index(i)
                is_anom = bool(scores[vi] >= self.threshold)
                anomalies.append({
                    "id": rec.get("id", "unknown"),
                    "region": rec.get("region", "unknown"),
                    "score": round(float(scores[vi]), 4),
                    "is_anomaly": is_anom
                })
            else:
                anomalies.append({
                    "id": rec.get("id", "unknown"),
                    "region": rec.get("region", "unknown"),
                    "score": -1,
                    "is_anomaly": False
                })

        anomaly_count = sum(1 for a in anomalies if a.get("is_anomaly"))
        total = len(anomalies)

        by_region = {}
        for a in anomalies:
            r = a.get("region", "unknown")
            if r not in by_region:
                by_region[r] = {"total": 0, "anomalies": 0}
            by_region[r]["total"] += 1
            if a.get("is_anomaly"):
                by_region[r]["anomalies"] += 1

        return {
            "anomalies": anomalies,
            "threshold": round(self.threshold, 4),
            "feature_cols": fields,
            "total_checked": total,
            "anomaly_count": anomaly_count,
            "anomaly_ratio": round(anomaly_count / total, 4) if total else 0,
            "metric": "autoencoder",
            "by_region": by_region
        }