实验4：算法集成与 AI 增强分析（成员A·王哲）
============================================================

一、运行环境
------------------------------------------------------------
算法：Python 3.11 + pandas + numpy + scikit-learn + statsmodels
conda 环境名：ocean-vis（本地运行，无任何云端依赖）

二、首次准备（搭建虚拟环境）
------------------------------------------------------------
方式①（推荐，按 environment.yml 重建）：
    conda env create -f environment.yml
方式②（手动创建）：
    conda create -y -n ocean-vis python=3.11 pandas numpy scikit-learn statsmodels

三、一键运行算法管线
------------------------------------------------------------
    conda activate ocean-vis
    cd code
    python run.py

跑通后 output/ 下生成全部 JSON，供前端读取渲染。

四、目录结构
------------------------------------------------------------
data/    ocean_atmosphere.json   复用实验2数据集（约3600条，6海域，2020-2022）
code/    preprocess.py           基础算法：清洗 / 3σ异常 / 聚合 / 统计（公共模块）
         task1_smoothing.py      任务1：滑动平均 + 指数加权平均趋势提取
         coupling_pca.py         PCA 降维(3D) + 相关系数矩阵
         task2_predict.py        任务2：随机森林 / 线性回归 多变量SST预测（含 predict 接口）
         run.py                  一键执行：串联全部算法生成 JSON
output/  *.json                  算法输出（前端读取）
frontend/                        可视化界面（4视图，后续阶段开发）

五、输出 JSON 清单
------------------------------------------------------------
smoothed.json            原始SST + 两种平滑曲线（窗口W可调）
prediction.json          测试集真实/预测值、各海域误差、逐样本贡献分解（瀑布图）
feature_importance.json  随机森林各维度对SST预测的重要性
forecast.json            基于趋势的未来延伸预测 + 95% 置信区间
pca_points.json          每条记录的三维主成分坐标（3D星云图）
correlation_matrix.json  数值变量两两 Pearson 相关系数矩阵（耦合热力图）
pca_explained.json       三个主成分的方差解释率
region_stats.json        各海域 SST 均值/方差/极值（总览视图用）
records.json             清洗后记录明细（Query查询 / Search多维筛选 / 星云按维度着色）

六、查看可视化界面
------------------------------------------------------------
直接双击 frontend/index.html 即可（已把算法产物打包进 js/data-bundle.js，
绕过浏览器对 file:// 本地 JSON 的读取限制，无需启动任何服务）。
注：主视图3D星云图依赖 WebGL，请用 Chrome/Edge/Safari 等现代浏览器打开。
导航栏点击切换视图；地址栏 #nebula/#coupling/#forecast/#waterfall 可直达。

界面五视图：
  总览          —— 海域碳-温状态总览（概览图，导航入口）
  耦合星云      —— 主视图·3D降维耦合（本组创新图表，可旋转/框选联动）
  维度互动强度  —— 13维相关矩阵，点击格子让星云按该维度重新着色
  海温演变与展望—— 原始+平滑(W可调)+模型未来预测+置信区间
  单点预测归因  —— 逐维拆解某样本的预测温度（瀑布）
三级任务：Query=信息面板「数据点查询」；Search=顶栏「多维筛选」；Analyze=后三个视图。

七、当前进度
------------------------------------------------------------
[已完成] 目录结构、ocean-vis 虚拟环境、全部算法链路与数据处理
[已完成] frontend/ 五视图界面：导航切换/信息面板/状态栏/弹窗/多视图联动/算法说明
[预留]   小组深度学习(MindSpore)与云端 ModelArts，仅留 predict() 接口

八、预留接口（未来接昇腾 ModelArts）
------------------------------------------------------------
code/task2_predict.py::predict(features) 为统一预测入口，
当前本地 sklearn 实现，未来仅替换函数体即可接入云端，对调用方零影响。
