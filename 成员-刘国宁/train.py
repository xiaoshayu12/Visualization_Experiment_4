# -*- coding: utf-8 -*-
"""
离线预训练脚本
==============
一次性加载全量数据，训练 LOF 和 Autoencoder 模型，
将结果保存到 models/ 目录。

使用方式（从项目根目录）：
    python 成员-刘国宁/train.py
"""
import os
import sys
import json
from backend import data_adapter as da
from backend.model_adapter import get_registry, get_ModelInput

# 确保项目根目录在 Python 路径中，兼容任意目录启动
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.dirname(_SCRIPT_DIR)
sys.path.insert(0, _PROJECT_ROOT)

ModelInput = get_ModelInput()
ALL_NUM_FIELDS = da.ALL_NUMERIC_FIELDS
REGIONS = da.KNOWN_REGIONS

MODELS_DIR = os.path.join(_SCRIPT_DIR, 'models')


def main():
    # 创建 models/ 目录
    os.makedirs(MODELS_DIR, exist_ok=True)

    # 加载全量数据
    print("[train] 加载数据...")
    records = list(da.get_dataset())
    print(f"[train] 记录数: {len(records)}")

    # ── 训练 LOF ──────────────────────────────────────────
    print("[train] 训练 LOF 模型...")
    lof_model = get_registry().get("lof")
    inp = ModelInput(records=records, fields=ALL_NUM_FIELDS, regions=REGIONS,
                     params={"n_neighbors": 20})
    lof_output = lof_model.predict(inp)
    if not lof_output.ok:
        print(f"[train] LOF 训练失败: {lof_output.error}")
        return

    lof_path = os.path.join(MODELS_DIR, 'lof_results.json')
    with open(lof_path, 'w', encoding='utf-8') as f:
        json.dump(lof_output.result, f, ensure_ascii=False, indent=2)
    print(f"[train] LOF 结果已保存: {lof_path}")

    # ── 训练 Autoencoder ──────────────────────────────────
    print("[train] 训练 Autoencoder 模型...")
    ae_model = get_registry().get("autoencoder")
    inp = ModelInput(records=records, fields=ALL_NUM_FIELDS, regions=REGIONS,
                     params={"hidden_dim": 6, "latent_dim": 3, "epochs": 200,
                             "lr": 0.001, "contamination": 0.05})
    ae_output = ae_model.predict(inp)
    if not ae_output.ok:
        print(f"[train] Autoencoder 训练失败: {ae_output.error}")
        return

    # 保存三件套
    weights_path = os.path.join(MODELS_DIR, 'autoencoder_weights.pt')
    import torch
    torch.save(ae_model.model.state_dict(), weights_path)
    print(f"[train] Autoencoder 权重已保存: {weights_path}")

    norm_path = os.path.join(MODELS_DIR, 'autoencoder_norm.json')
    with open(norm_path, 'w', encoding='utf-8') as f:
        json.dump({
            "mean": ae_model._mean.tolist(),
            "std": ae_model._std.tolist(),
        }, f, ensure_ascii=False, indent=2)
    print(f"[train] Autoencoder 归一化参数已保存: {norm_path}")

    results_path = os.path.join(MODELS_DIR, 'autoencoder_results.json')
    with open(results_path, 'w', encoding='utf-8') as f:
        json.dump(ae_output.result, f, ensure_ascii=False, indent=2)
    print(f"[train] Autoencoder 结果已保存: {results_path}")

    print("\n[train] 预训练完成！")
    print(f"  - {weights_path}")
    print(f"  - {norm_path}")
    print(f"  - {results_path}")
    print(f"  - {lof_path}")


if __name__ == "__main__":
    main()
