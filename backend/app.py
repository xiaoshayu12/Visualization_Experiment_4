# -*- coding: utf-8 -*-
"""
全球海洋大气耦合时空可视分析系统 —— 统一后端
==============================================
合并王哲(端口5001)与刘国宁(端口5000)的 Flask 后端。
技术栈: Flask + CORS + 统一数据适配层

核心接口:
  GET /api/meta                  — 数据集元信息
  GET /api/data/filter           — 统一过滤/分页/聚合
  GET /api/data/point?id=        — 单点详情
  GET /api/geojson               — GeoJSON FeatureCollection
  GET /api/health                — 服务健康检查
  GET /api/stats/regional        — 区域统计
  GET /api/stats/outliers        — 异常值摘要
  GET /api/stats/extremes        — 极值记录
  GET /api/stats/overview        — 数据概览
  GET /api/model/*               — ML 模型接口
"""
import os
import sys
import socket
import time

# 确保项目根目录在 Python 路径中（支持 python backend/app.py 直接启动）
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask import Flask, jsonify, request, send_from_directory, redirect, abort
from flask_cors import CORS

from backend import data_adapter as da
from backend.model_adapter import get_registry, model_status, run_model, get_ModelInput

ModelInput = None  # 延迟初始化

app = Flask(
    __name__,
    static_folder=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static"),
    static_url_path="/static",
)
CORS(app)

# ================================================================
#  缓存（刘国宁的预处理逻辑）
# ================================================================
_cache = {
    "health": None,
    "regional": None,
    "outliers": None,
    "extremes": None,
    "overview": None,
}


def build_cache():
    print("[后端] 正在加载数据...")
    raw_data = [r["_raw"] for r in da.get_dataset()]
    print(f"[后端] 原始记录: {len(raw_data)}")

    da.impute_missing(raw_data)
    cleaned, outlier_summary = da.detect_outliers(raw_data)
    print(f"[后端] 清洗后记录: {len(cleaned)}, 剔除异常: {len(raw_data) - len(cleaned)}")

    regional = da.compute_regional_stats(cleaned)
    extremes = da.compute_extremes(cleaned)

    time_span_min = min((d.get("time", "") for d in cleaned), default="")
    time_span_max = max((d.get("time", "") for d in cleaned), default="")
    regions_active = len(set(d["region"] for d in cleaned))

    _cache["health"] = {
        "status": "ok",
        "records_before": len(raw_data),
        "records_after": len(cleaned),
        "regions": da.KNOWN_REGIONS,
        "fields": da.ALL_NUMERIC_FIELDS,
        "model": model_status(),
    }
    _cache["regional"] = regional
    _cache["outliers"] = {
        "total_removed": len(raw_data) - len(cleaned),
        "pct_removed": round((len(raw_data) - len(cleaned)) / len(raw_data) * 100, 2) if raw_data else 0,
        "by_region": dict(outlier_summary.get("by_region", {})),
        "by_variable": dict(outlier_summary.get("by_variable", {})),
    }
    _cache["extremes"] = extremes
    _cache["overview"] = {
        "total_records": len(cleaned),
        "regions_active": regions_active,
        "time_span": f"{time_span_min} ~ {time_span_max}",
        "coupling_baseline": "Pearson r 矩阵由前端计算",
    }
    _cache["_cleaned_data"] = cleaned
    print("[后端] 缓存构建完毕")

    # ── 模型预热 ────────────────────────────────────────
    global ModelInput
    ModelInput = get_ModelInput()
    ALL_NUM_FIELDS = da.ALL_NUMERIC_FIELDS
    REGIONS = da.KNOWN_REGIONS

    try:
        lof_model = get_registry().get("lof")
        if lof_model and not lof_model.is_loaded():
            if not lof_model.load_pretrained():
                temp_inp = ModelInput(records=list(da.get_dataset()),
                                      fields=ALL_NUM_FIELDS, regions=REGIONS)
                lof_model.predict(temp_inp)
                print("[后端] LOF 模型在线训练完成（预训练文件未找到）")
    except Exception as e:
        print(f"[后端] LOF 模型加载警告: {e}")

    try:
        ae_model = get_registry().get("autoencoder")
        if ae_model and not ae_model.is_loaded():
            if not ae_model.load_pretrained():
                temp_inp = ModelInput(records=list(da.get_dataset()),
                                      fields=ALL_NUM_FIELDS, regions=REGIONS)
                ae_model.predict(temp_inp)
                print("[后端] Autoencoder 模型在线训练完成（预训练文件未找到）")
    except Exception as e:
        print(f"[后端] Autoencoder 模型加载警告: {e}")


# ================================================================
#  工具
# ================================================================
def _int(name, default):
    try:
        return int(request.args.get(name, default))
    except (TypeError, ValueError):
        return default


def _get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


# ================================================================
#  前端页面路由
# ================================================================
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT_DIR, "data")


@app.route("/data/<path:filename>")
def serve_data(filename):
    return send_from_directory(DATA_DIR, filename)


# 提供原始 JSON 数据（避免中文文件名 URL 编码问题）
@app.route("/api/data/raw")
def api_raw_data():
    return send_from_directory(DATA_DIR, "第2组-全球海洋大气耦合-实验3-地理数据.json")


@app.route("/")
def index():
    """主页：王哲的海洋-大气多维耦合分析（frontend/ 自包含离线系统）"""
    return send_from_directory(
        os.path.join(ROOT_DIR, "成员-王哲", "frontend"), "index.html"
    )


@app.route("/members/<member>")
def redirect_member(member):
    """无末尾斜杠 → 重定向到带斜杠版本，确保浏览器相对路径正确解析"""
    if member not in ("liu", "cheng", "xu"):
        abort(404)
    return redirect(f"/members/{member}/")


@app.route("/members/liu/")
def page_liu():
    return send_from_directory(
        os.path.join(ROOT_DIR, "成员-刘国宁"), "个人界面.html"
    )


@app.route("/members/cheng/")
def page_cheng():
    return send_from_directory(
        os.path.join(ROOT_DIR, "成员-程传哲"), "index.html"
    )


@app.route("/members/xu/")
def page_xu():
    return send_from_directory(
        os.path.join(ROOT_DIR, "成员-许一凡"), "代码_许一凡.html"
    )


# 静态资源：王哲主页（frontend/）通过相对路径引用的 css/js/lib
#   页面在 "/" 提供，相对路径 css/、js/、lib/ 解析为根级 /css /js /lib
_WANG_FRONTEND = os.path.join(ROOT_DIR, "成员-王哲", "frontend")


@app.route("/css/<path:filename>")
def static_wang_css(filename):
    return send_from_directory(os.path.join(_WANG_FRONTEND, "css"), filename)


@app.route("/js/<path:filename>")
def static_wang_js(filename):
    return send_from_directory(os.path.join(_WANG_FRONTEND, "js"), filename)


@app.route("/lib/<path:filename>")
def static_wang_lib(filename):
    return send_from_directory(os.path.join(_WANG_FRONTEND, "lib"), filename)


# 成员静态资源
@app.route("/members/liu/个人界面.css")
def static_liu_css():
    return send_from_directory(
        os.path.join(ROOT_DIR, "成员-刘国宁"), "个人界面.css"
    )


@app.route("/members/liu/个人界面.js")
def static_liu_js():
    return send_from_directory(
        os.path.join(ROOT_DIR, "成员-刘国宁"), "个人界面.js"
    )


# 各成员页面通过 ../static/ 相对路径引用的共享资源（nav.css, global.css, config.js, nav.js 等）
@app.route("/members/static/<path:filename>")
def static_members_shared(filename):
    return send_from_directory(
        os.path.join(ROOT_DIR, "static"), filename
    )


@app.route("/members/cheng/assets/<path:filename>")
def static_cheng_assets(filename):
    return send_from_directory(
        os.path.join(ROOT_DIR, "成员-程传哲", "assets"), filename
    )


@app.route("/members/cheng/data/<path:filename>")
def static_cheng_data(filename):
    return send_from_directory(
        os.path.join(ROOT_DIR, "成员-程传哲", "data"), filename
    )


# ================================================================
#  API: 元信息 & 数据过滤（王哲）
# ================================================================
@app.route("/api/meta")
def api_meta():
    return jsonify({"ok": True, "data": da.get_meta()})


@app.route("/api/data/filter")
def api_filter():
    t0 = time.time()
    qtype = request.args.get("type")
    time_str = request.args.get("time")
    region = request.args.get("region")
    agg_metric = request.args.get("agg")
    page = _int("page", 1)
    page_size = _int("page_size", 500)

    records, applied = da.filter_records(qtype=qtype, time_str=time_str, region=region)
    total_matched = len(records)
    page_records, page_info = da.paginate(records, page, page_size)

    # 移除内部字段 _raw，不暴露给前端
    clean_records = [{k: v for k, v in r.items() if k != "_raw"} for r in page_records]

    resp = {
        "ok": True,
        "filters": applied or {"type": "全量"},
        "page": page_info,
        "count": len(clean_records),
        "total_matched": total_matched,
        "elapsed_ms": round((time.time() - t0) * 1000, 2),
        "data": clean_records,
    }
    if agg_metric in ("ohc", "sst", "sst_anomaly", "wind_stress"):
        resp["aggregate"] = {
            "metric": agg_metric,
            "series": da.aggregate_monthly(records, agg_metric),
        }
    return jsonify(resp)


@app.route("/api/data/point")
def api_point():
    pid = _int("id", -1)
    ds = da.get_dataset()
    rec = next((r for r in ds if r["id"] == pid), None)
    if rec is None:
        return jsonify({"ok": False, "msg": f"id={pid} not found"}), 404

    month = rec["time"][5:7]
    same = [r for r in ds if r["region"] == rec["region"] and r["time"][5:7] == month]
    clim_sst = round(sum(r["sst"] for r in same) / len(same), 2)
    clean = {k: v for k, v in rec.items() if k != "_raw"}
    return jsonify({
        "ok": True,
        "data": clean,
        "climatology": {
            "region": rec["region"],
            "month": month,
            "sst_mean": clim_sst,
            "sst_deviation": round(rec["sst"] - clim_sst, 2),
            "sample_size": len(same),
        },
    })


@app.route("/api/geojson")
def api_geojson():
    qtype = request.args.get("type")
    time_str = request.args.get("time")
    region = request.args.get("region")
    records, applied = da.filter_records(qtype=qtype, time_str=time_str, region=region)
    features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [r["lon"], r["lat"]]},
            "properties": {
                k: r[k]
                for k in ("id", "time", "region", "sst", "sst_anomaly", "ohc", "wind_stress")
            },
        }
        for r in records
    ]
    return jsonify({"type": "FeatureCollection", "filters": applied, "features": features})


# ================================================================
#  API: 统计分析（刘国宁）
# ================================================================
@app.route("/api/health")
def api_health():
    return jsonify(_cache.get("health", {"status": "warming"}))


@app.route("/api/stats/regional")
def api_stats_regional():
    return jsonify(_cache.get("regional", {}))


@app.route("/api/stats/outliers")
def api_stats_outliers():
    return jsonify(_cache.get("outliers", {}))


@app.route("/api/stats/extremes")
def api_stats_extremes():
    return jsonify(_cache.get("extremes", []))


@app.route("/api/stats/overview")
def api_stats_overview():
    return jsonify(_cache.get("overview", {}))


# ================================================================
#  API: ML 模型（占位）
# ================================================================
@app.route("/api/model/status")
def api_model_status():
    try:
        return jsonify(model_status())
    except Exception as e:
        return jsonify({"models": [], "any_ready": False, "error": str(e)})


def _make_model_input(fields=None, regions=None, params=None):
    full_data = list(da.get_dataset())  # 使用全量 3600 条（含派生字段），让模型在原始空间检测异常
    mi = ModelInput or get_ModelInput()
    return mi(
        records=full_data,
        fields=fields or da.ALL_NUMERIC_FIELDS,
        regions=regions or da.KNOWN_REGIONS,
        params=params or {}
    )


@app.route("/api/model/lof", methods=["GET", "POST"])
def api_model_lof():
    n_neighbors = int(request.args.get("n_neighbors", 20))
    inp = _make_model_input(params={"n_neighbors": n_neighbors})
    out = run_model("lof", inp)
    return jsonify({
        "ok": out.ok, "model": out.model_name,
        "version": out.model_version, "result": out.result,
        "error": out.error
    })


@app.route("/api/model/autoencoder", methods=["GET", "POST"])
def api_model_autoencoder():
    params = {}
    for key in ("hidden_dim", "latent_dim", "epochs", "lr", "contamination"):
        if key in request.args:
            params[key] = float(request.args.get(key)) if key in ("lr", "contamination") else int(request.args.get(key))
    inp = _make_model_input(params=params)
    out = run_model("autoencoder", inp)
    return jsonify({
        "ok": out.ok, "model": out.model_name,
        "version": out.model_version, "result": out.result,
        "error": out.error
    })


@app.route("/api/model/coupling", methods=["GET", "POST"])
def api_model_coupling():
    inp = _make_model_input()
    out = run_model("coupling", inp)
    return jsonify({
        "ok": out.ok, "model": out.model_name,
        "version": out.model_version, "result": out.result,
        "error": out.error
    })


@app.route("/api/model/forecast", methods=["GET", "POST"])
def api_model_forecast():
    field = request.args.get("field", "sst")
    horizon = int(request.args.get("horizon", 6))
    inp = _make_model_input(fields=[field], params={"horizon": horizon})
    out = run_model("forecast", inp)
    return jsonify({
        "ok": out.ok, "model": out.model_name,
        "version": out.model_version, "result": out.result,
        "error": out.error
    })


@app.route("/api/model/cluster", methods=["GET", "POST"])
def api_model_cluster():
    n = int(request.args.get("n_clusters", 3))
    inp = _make_model_input(params={"n_clusters": n})
    out = run_model("cluster", inp)
    return jsonify({
        "ok": out.ok, "model": out.model_name,
        "version": out.model_version, "result": out.result,
        "error": out.error
    })


# ================================================================
#  启动
# ================================================================
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    host = os.environ.get("HOST", "0.0.0.0")

    da.get_dataset()  # 预热数据
    build_cache()      # 构建统计缓存
    app.config["JSON_AS_ASCII"] = False

    local_ip = _get_local_ip()
    print("=" * 50)
    print("  全球海洋大气耦合时空可视分析系统")
    print("=" * 50)
    print(f"  本地访问：  http://127.0.0.1:{port}")
    print(f"  局域网访问：http://{local_ip}:{port}")
    print("=" * 50)

    app.run(host=host, port=port, debug=False)
