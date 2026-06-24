# -*- coding: utf-8 -*-
"""
模型适配层 —— 桥接 成员-刘国宁/model.py 到统一后端。
使用 importlib 动态加载，因为成员目录名含中文/连字符，不能作为 Python 包。
"""

import importlib.util
import os
import sys

_MODEL_MODULE = None


def _load_model_module():
    """懒加载 model.py，确保只加载一次"""
    global _MODEL_MODULE
    if _MODEL_MODULE is not None:
        return _MODEL_MODULE

    model_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "成员-刘国宁", "model.py"
    )

    if not os.path.exists(model_path):
        raise FileNotFoundError(f"模型文件不存在: {model_path}")

    spec = importlib.util.spec_from_file_location("liu_model", model_path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["liu_model"] = mod
    spec.loader.exec_module(mod)
    _MODEL_MODULE = mod
    return mod


def get_registry():
    return _load_model_module().registry


def model_status():
    return _load_model_module().model_status()


def run_model(name, inp):
    return _load_model_module().run_model(name, inp)


def get_ModelInput():
    return _load_model_module().ModelInput


def get_ALL_NUMERIC_FIELDS():
    return _load_model_module().ALL_NUMERIC_FIELDS
