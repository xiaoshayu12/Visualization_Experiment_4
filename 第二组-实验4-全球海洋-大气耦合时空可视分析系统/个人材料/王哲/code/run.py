import time
import preprocess as pp
import task1_smoothing
import coupling_pca
import task2_predict
import build_bundle


def main():
    t0 = time.time()
    print("=" * 60)
    print("实验4 算法管线启动（本地 sklearn，无云端依赖）")
    print("=" * 60)

    # 1) 基础算法：清洗 / 异常 / 聚合 / 统计（同时落盘统计 JSON）
    cleaned = pp.run()

    # 后续模块复用同一份清洗后数据，避免重复清洗
    print("-" * 60)
    task1_smoothing.run(df=cleaned)

    print("-" * 60)
    coupling_pca.run(df=cleaned)

    print("-" * 60)
    task2_predict.run(df=cleaned)

    # 把 JSON 打包给前端（保证 file:// 双击可用）
    print("-" * 60)
    build_bundle.build()

    # 汇总产物清单
    print("=" * 60)
    outputs = sorted(p.name for p in pp.OUTPUT_DIR.glob("*.json"))
    print(f"完成：共生成 {len(outputs)} 个 JSON @ output/")
    for name in outputs:
        print(f"   - {name}")
    print(f"总耗时：{time.time() - t0:.1f}s")
    print("=" * 60)


if __name__ == "__main__":
    main()
