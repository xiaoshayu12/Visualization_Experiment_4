# -*- coding: utf-8 -*-
"""
前端数据打包：output/*.json -> frontend/js/data-bundle.js
================================================
浏览器在 file:// 协议下禁止 fetch 本地 JSON（CORS 限制），
为满足文档「双击 index.html 能直接打开运行」，把所有算法产物打成一个
JS 文件，挂到 window.OCEAN_DATA，前端 data-adapter.js 直接读取。

由 run.py 在算法跑完后自动调用，无需手动执行。
"""

import json
from pathlib import Path

from preprocess import OUTPUT_DIR, ROOT_DIR

BUNDLE_PATH = ROOT_DIR / "frontend" / "js" / "data-bundle.js"


def build():
    """读取 output 下全部 JSON，生成 data-bundle.js。"""
    bundle = {}
    for path in sorted(OUTPUT_DIR.glob("*.json")):
        with open(path, "r", encoding="utf-8") as f:
            bundle[path.stem] = json.load(f)

    BUNDLE_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(bundle, ensure_ascii=False, separators=(",", ":"))
    header = (
        "// 自动生成，请勿手改。由 code/build_bundle.py 从 output/*.json 打包。\n"
        "// 作用：file:// 双击打开时绕过浏览器对本地 JSON 的 fetch 限制。\n"
    )
    with open(BUNDLE_PATH, "w", encoding="utf-8") as f:
        f.write(header)
        f.write("window.OCEAN_DATA = ")
        f.write(payload)
        f.write(";\n")

    size_kb = BUNDLE_PATH.stat().st_size // 1024
    print(f"[bundle] 打包 {len(bundle)} 个数据集 -> frontend/js/data-bundle.js（{size_kb}KB）")
    return BUNDLE_PATH


if __name__ == "__main__":
    build()
