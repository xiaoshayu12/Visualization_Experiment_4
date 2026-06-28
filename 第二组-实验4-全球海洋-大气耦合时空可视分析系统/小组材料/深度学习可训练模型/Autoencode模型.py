import json
import os
os.environ['ASCEND_GLOBAL_LOG_LEVEL'] = '3'
os.environ['ASCEND_SLOG_PRINT_TO_STDOUT'] = '0'
import numpy as np
import pandas as pd
from dataclasses import dataclass, field
import mindspore as ms
from mindspore import nn, ops, Tensor, save_checkpoint, load_checkpoint
from mindspore import context
import sys
import matplotlib.pyplot as plt

# ==================== 全局常量 ====================
ALL_NUMERIC_FIELDS = [
    "wind_speed", "wind_dir", "pressure", "precipitation", "co2",
    "humidity", "sst", "salinity", "current_speed", "chlorophyll"
]

# ==================== 数据类 ====================
@dataclass
class ModelInput:
    records: list
    fields: list
    regions: list
    params: dict = field(default_factory=dict)

@dataclass
class ModelOutput:
    ok: bool
    model_name: str
    model_version: str
    result: dict
    error: str = ""

@dataclass
class ModelMeta:
    name: str
    version: str
    description: str
    input_schema: dict
    output_schema: dict


# ==================== Autoencoder 异常检测模型 ====================
class AutoencoderModel:
    """基于 Autoencoder 的深度学习异常检测（MindSpore 实现）"""

    def __init__(self):
        self._loaded = False
        self.model = None
        self.feature_cols = None
        self.threshold = None
        self._mean = None
        self._std = None
        self._train_losses = []
        self._pretrained_result = None
        self._scores = None
        self._fitted_count = 0

    # -------------------- 元信息 --------------------
    def meta(self):
        return ModelMeta(
            name="autoencoder",
            version="1.0.0-autoencoder-mindspore",
            description="基于 Autoencoder 的深度学习异常检测 — MindSpore 版本",
            input_schema={
                "records": "list",
                "fields": "list[str]",
                "regions": "list[str]",
                "hidden_dim": "int",
                "latent_dim": "int",
                "epochs": "int",
                "lr": "float",
                "contamination": "float"
            },
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

    # -------------------- 加载预训练模型 --------------------
    def load_pretrained(self, results_path=None, weights_path=None, norm_path=None):
        base_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models')
        results_path = results_path or os.path.join(base_dir, 'autoencoder_results.json')
        weights_path = weights_path or os.path.join(base_dir, 'autoencoder_weights.ckpt')
        norm_path = norm_path or os.path.join(base_dir, 'autoencoder_norm.json')

        missing = [p for p in (results_path, weights_path, norm_path) if not os.path.exists(p)]
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

        param_dict = load_checkpoint(weights_path)
        load_checkpoint(param_dict, self.model)
        self.model.set_train(False)
        self._loaded = True
        return True

    # -------------------- 构建网络 --------------------
    def _build_model(self, input_dim, hidden_dim, latent_dim):
        class Encoder(nn.Cell):
            def __init__(self):
                super().__init__()
                self.fc1 = nn.Dense(input_dim, hidden_dim)
                self.fc2 = nn.Dense(hidden_dim, latent_dim)
                self.relu = nn.ReLU()

            def construct(self, x):
                x = self.relu(self.fc1(x))
                x = self.relu(self.fc2(x))
                return x

        class Decoder(nn.Cell):
            def __init__(self):
                super().__init__()
                self.fc3 = nn.Dense(latent_dim, hidden_dim)
                self.fc4 = nn.Dense(hidden_dim, input_dim)
                self.relu = nn.ReLU()

            def construct(self, x):
                x = self.relu(self.fc3(x))
                x = self.relu(self.fc4(x))
                return x

        class Autoencoder(nn.Cell):
            def __init__(self):
                super().__init__()
                self.encoder = Encoder()
                self.decoder = Decoder()

            def construct(self, x):
                return self.decoder(self.encoder(x))

        return Autoencoder()

    # -------------------- 训练与预测（核心） --------------------
    def _fit_predict(self, records, fields, hidden_dim=6, latent_dim=3,
                 epochs=200, lr=0.001, contamination=0.05):
        """训练 Autoencoder 并返回异常检测结果（全量数据单批次训练）"""
        print("开始训练 Autoencoder (全量数据，无批次划分)...")
    
        # 1. 提取有效数值特征
        valid_fields = [f for f in fields if f in records[0] and records[0].get(f) is not None]
        if not valid_fields:
            valid_fields = [f for f in ALL_NUMERIC_FIELDS if f in records[0]]
    
        data_matrix, valid_indices = [], []
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
            raise ValueError(f"有效样本数不足（{len(data_matrix)}），无法训练 Autoencoder。")
    
        X = np.array(data_matrix)
        self.feature_cols = valid_fields
        self._fitted_count = X.shape[0]
        input_dim = X.shape[1]
    
        # 2. 标准化
        self._mean = np.mean(X, axis=0)
        self._std = np.std(X, axis=0)
        self._std[self._std == 0] = 1e-8
        X_norm = (X - self._mean) / self._std
    
        # 3. 构建模型（自动调整维度）
        hidden_dim = min(hidden_dim, input_dim - 1)
        latent_dim = min(latent_dim, hidden_dim - 1)
        self.model = self._build_model(input_dim, hidden_dim, latent_dim)
    
        # 4. 准备训练（全量数据作为一个批次）
        X_tensor = Tensor(X_norm, dtype=ms.float32)
        criterion = nn.MSELoss()
        optimizer = nn.Adam(self.model.trainable_params(), learning_rate=lr)
    
        def forward_fn(x):
            pred = self.model(x)
            return criterion(pred, x)
    
        grad_fn = ops.value_and_grad(forward_fn, None, optimizer.parameters)
    
        # 5. 训练循环（每 epoch 只更新一次）
        self._train_losses = []
        best_loss = float('inf')
        best_params = None
        patience_counter = 0
        patience = 20
    
        self.model.set_train(True)
        for epoch in range(epochs):
            loss, grads = grad_fn(X_tensor)
            optimizer(grads)
            loss_val = loss.asnumpy().item()
            self._train_losses.append(loss_val)
    
            if loss_val < best_loss:
                best_loss = loss_val
                best_params = [p.asnumpy().copy() for p in self.model.trainable_params()]
                patience_counter = 0
            else:
                patience_counter += 1
    
            if patience_counter >= patience:
                break
    
        # 恢复最佳参数
        if best_params is not None:
            params = self.model.trainable_params()
            for p, best_p in zip(params, best_params):
                p.set_data(Tensor(best_p, dtype=p.dtype))
    
        # 6. 计算重建误差与异常分数（全量评估）
        self.model.set_train(False)
        reconstructed = self.model(X_tensor)
        mse = ops.mean((reconstructed - X_tensor) ** 2, axis=1).asnumpy()
        self._scores = mse   # 原始MSE（后续归一化到0~100）
    
        # 归一化分数到 0~100
        mse_min, mse_max = float(np.min(mse)), float(np.max(mse))
        scores = (mse - mse_min) / (mse_max - mse_min) * 100 if mse_max > mse_min else np.zeros_like(mse)
        self._scores = scores
    
        # 7. 确定阈值
        threshold_pct = 100 - contamination * 100
        self.threshold = float(np.percentile(scores, threshold_pct))
    
        # 8. 构建输出
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
    
        self._loaded = True
        print(f"[AutoencoderModel] 训练完成。特征数: {len(self.feature_cols)}, "
              f"架构: {input_dim}→{hidden_dim}→{latent_dim}→{hidden_dim}→{input_dim}, "
              f"样本: {self._fitted_count}, 初始损失: {self._train_losses[0]:.4f}, "
              f"最终损失: {self._train_losses[-1]:.4f}, 阈值: {self.threshold:.4f}")
        return anomalies

    # -------------------- 对外预测接口 --------------------
    def predict(self, inp: ModelInput):
        """执行推理（若已加载预训练结果则直接返回，否则训练）"""
        if self._pretrained_result is not None:
            return ModelOutput(
                ok=True,
                model_name="autoencoder",
                model_version="1.0.0-autoencoder-mindspore",
                result=self._pretrained_result,
                error=""
            )

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
                model_version="1.0.0-autoencoder-mindspore",
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
            model_version="1.0.0-autoencoder-mindspore",
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


# ==================== 命令行训练与保存三件套 ====================
# 设置运行环境（根据需要切换 CPU/GPU/Ascend）
context.set_context(mode=context.PYNATIVE_MODE, device_target="CPU")

print("[train] 训练 Autoencoder 模型 (MindSpore)...")

# 请确保 clean_records.json 和 feature_cols.json 存在
records_data = pd.read_json("./clean_records.json")
fields_data = pd.read_json("./feature_cols.json")
records = records_data.to_dict('records')
regions = list(set(rec['region'] for rec in records))

model = AutoencoderModel()
inp = ModelInput(
    records=records,
    fields=fields_data,
    regions=regions,
    params={"hidden_dim": 6, "latent_dim": 3, "epochs": 200,
            "lr": 0.001, "contamination": 0.05}
)
output = model.predict(inp)

if not output.ok:
    print(f"[train] Autoencoder 训练失败: {output.error}")
    exit(1)

# 保存三件套
models_dir = "./models"
os.makedirs(models_dir, exist_ok=True)

weights_path = os.path.join(models_dir, 'autoencoder_weights.ckpt')
save_checkpoint(model.model, weights_path)
print(f"[train] 权重已保存: {weights_path}")

norm_path = os.path.join(models_dir, 'autoencoder_norm.json')
with open(norm_path, 'w', encoding='utf-8') as f:
    json.dump({
        "mean": model._mean.tolist(),
        "std": model._std.tolist(),
    }, f, ensure_ascii=False, indent=2)
print(f"[train] 归一化参数已保存: {norm_path}")

results_path = os.path.join(models_dir, 'autoencoder_results.json')
with open(results_path, 'w', encoding='utf-8') as f:
    json.dump(output.result, f, ensure_ascii=False, indent=2)
print(f"[train] 结果已保存: {results_path}")

print("[train] 预训练完成！")
print(f"  - {weights_path}")
print(f"  - {norm_path}")
print(f"  - {results_path}")

losses = model._train_losses

if losses:
    plt.figure(figsize=(10, 6))
    epochs = range(1, len(losses) + 1)
    plt.plot(epochs, losses, label='Training Loss (per epoch)', alpha=0.6, linewidth=0.8)

    # 移动平均平滑线
    window = min(50, len(losses) // 2)
    if len(losses) > window and window > 1:
        import numpy as np
        moving_avg = np.convolve(losses, np.ones(window)/window, mode='valid')
        # 移动平均对应每个窗口的末尾，x 坐标从 window 到 len(losses)
        plt.plot(range(window, len(losses)+1), moving_avg,
                 label=f'Moving Average (window={window})', color='red', linewidth=2)

    plt.xlabel('Epoch')
    plt.ylabel('Loss')
    plt.title('Autoencoder Training Loss Curve')
    plt.legend()
    plt.grid(True, alpha=0.3)

    loss_curve_path = os.path.join(models_dir, 'loss_curve.png')
    plt.savefig(loss_curve_path, dpi=150, bbox_inches='tight')
    print(f"[train] 损失曲线图已保存: {loss_curve_path}")
    plt.close()
else:
    print("[train] 未记录到损失值，无法绘制曲线。")