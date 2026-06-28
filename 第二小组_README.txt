================================================================================
          第二小组_README.txt
          全球海洋大气耦合时空可视分析系统
================================================================================

小组：第2组
项目名称：全球海洋大气耦合时空可视分析系统
课程：可视化实验四


================================================================================
一、小组信息与组员分工
================================================================================

| 姓名   | 分工内容                                                                 |
|--------|------------------------------------------------------------------------|
| 王哲   | 海洋-大气多维耦合分析（主页）。PCA降维 + 随机森林 SST 预测，五视图单屏切换 |
|        | （总览 / 3D耦合星云 / 维度相关矩阵 / 海温平滑预测 / 单点归因瀑布），      |
|        | 自包含离线系统（D3.js v7 + Plotly），数据通过预计算管线打包为 data-bundle.js |
| 刘国宁 | 海气耦合与异常检测。D3.js 三面板（Pearson 热力图 + 双变量耦合地图 +       |
|        | 信息侧栏），LOF 异常检测模型 + Autoencoder 深度学习模型，                   |
|        | 集成 sklearn / PyTorch，对接 ModelArts 云端部署                            |
| 程传哲 | 碳汇压力分析。自包含 D3.js 页面（1295行），从 CO2/SST/风速/叶绿素/盐度     |
|        | 五因子加权计算碳汇压力指数，分五级状态；KPI条+区域卡片+热力图+解释面板       |
| 许一凡 | 综合分析。单文件自包含可视化（代码_许一凡.html），提供综合分析视图           |


================================================================================
二、项目文件结构说明
================================================================================

实验四/
├── backend/                              # 统一 Flask 后端
│   ├── __init__.py                       # 包标记
│   ├── app.py                            # Flask 应用入口（端口 5000）
│   ├── data_adapter.py                   # 统一数据层（加载/派生/填充/异常检测/过滤/统计）
│   └── model_adapter.py                  # 模型适配层（动态桥接 成员-刘国宁/model.py）
│
├── data/
│   └── 第2组-全球海洋大气耦合-实验3-地理数据.json   # 共享数据集（3600条，6海域×36月）
│
├── static/                               # 共享前端资源
│   ├── css/global.css                    # CSS 变量、全局重置、通用组件样式
│   ├── css/nav.css                       # 导航栏样式（暗色渐变 sticky 顶部）
│   ├── js/config.js                      # window.CONFIG：API_BASE、页面路由、海域颜色、图表主题色
│   ├── js/nav.js                         # 自动渲染四页导航标签
│   └── lib/
│       ├── d3.v7.min.js                  # D3.js v7
│       └── world.json                    # 世界地图 GeoJSON
│
├── 成员-王哲/                             # 王哲 — 海洋-大气多维耦合分析（主页）
│   ├── code/
│   │   ├── run.py                        # 算法管线编排（顺序执行各任务）
│   │   ├── preprocess.py                 # 数据清洗（3-sigma）、月度聚合、区域统计
│   │   ├── task1_smoothing.py            # 滑动平均 + 指数平滑
│   │   ├── coupling_pca.py               # PCA 降维 + Pearson 相关矩阵
│   │   ├── task2_predict.py              # 随机森林 / 线性回归 SST 预测
│   │   └── build_bundle.py               # 将 output/*.json 打包为 data-bundle.js
│   ├── Data/ocean_atmosphere.json        # 算法管线输入数据
│   ├── Doc/
│   │   ├── 开发文档.md                   # 开发文档
│   │   └── 实验4个人报告-王哲.docx        # 个人实验报告
│   ├── frontend/                          # 前端（自包含离线系统）
│   │   ├── index.html                    # 主页面
│   │   ├── css/style.css
│   │   ├── js/app.js                     # 主应用入口
│   │   ├── js/data-adapter.js            # 前端数据适配器
│   │   ├── js/data-bundle.js             # 自动生成：所有算法输出打包
│   │   ├── js/view_overview.js           # 总览视图
│   │   ├── js/view_nebula.js             # 3D 耦合星云（PCA创新图表）
│   │   ├── js/view_heatmap.js            # 维度相关矩阵热力图
│   │   ├── js/view_forecast.js           # 海温平滑+预测视图
│   │   ├── js/view_waterfall.js          # 单点预测归因瀑布图
│   │   └── lib/                          # D3.js 和 Plotly.js 库文件
│   ├── output/                           # 算法输出（*.json，由 run.py 生成）
│   ├── ScreenShot/                       # 可视化截图
│   ├── environment.yml
│   └── README.txt
│
├── 成员-刘国宁/                           # 刘国宁 — 海气耦合与异常检测
│   ├── model.py                          # ML 模型层（ABC接口、Registry、LOF、Autoencoder）
│   ├── train.py                          # 离线预训练脚本
│   ├── deepmodel.ipynb                   # ModelArts Notebook（OBS、LOF、MindSpore AE）
│   ├── models/                           # 预训练模型文件
│   │   ├── lof_results.json              # LOF 预训练结果
│   │   ├── autoencoder_results.json      # Autoencoder 预训练结果
│   │   ├── autoencoder_weights.pt        # PyTorch 权重文件
│   │   └── autoencoder_norm.json         # 归一化参数
│   ├── 个人界面.html / .css / .js        # 个人前端页面
│   ├── 个人实验报告/                     # 个人实验报告
│   └── 刘国宁-个人材料/                   # 个人材料备份
│
├── 成员-程传哲/                           # 程传哲 — 碳汇压力分析
│   ├── index.html                        # 自包含 D3.js 页面（1295行）
│   ├── assets/                           # 前端资源（config.js, data-adapter.js, 样式, 导航）
│   ├── data/original-dataset.js          # 原始数据集JS格式
│   └── README.md
│
├── 成员-许一凡/                           # 许一凡 — 综合分析
│   └── 代码_许一凡.html                   # 单文件自包含可视化
│
├── 小组材料/                              # ModelArts 云端部署材料
│   ├── api调用.py                        # ModelArts API 调用脚本
│   ├── Autoencode模型.py                 # MindSpore Autoencoder 训练脚本
│   └── model/                            # ModelArts 模型部署包
│       ├── config.json                   # 模型配置（MindSpore, anomaly_detection）
│       ├── customize_service.py          # SingleNodeService 子类（预处理/推理/后处理）
│       ├── detector.py                   # AutoencoderDetector 推理类
│       ├── autoencoder_weights.ckpt      # MindSpore 模型权重
│       ├── autoencoder_norm.json         # 归一化参数
│       └── autoencoder_results.json      # 预计算异常检测结果
│
├── requirements.txt                      # Python 依赖
├── 启动.bat                              # Windows 一键启动脚本（GBK 编码）
└── start.sh                              # macOS/Linux 一键启动脚本


================================================================================
三、实验运行环境与依赖库
================================================================================

【Python 环境】
  - Python 3.8+
  - Flask >= 2.3.0（Web 框架）
  - Flask-CORS >= 4.0.0（跨域支持）
  - scikit-learn >= 1.0.0（LOF 异常检测模型）
  - PyTorch >= 2.0.0（Autoencoder 深度学习模型）

【前端库（通过 CDN / 本地文件引入，无需 npm）】
  - D3.js v7（数据驱动可视化）
  - Plotly.js（3D 散点图 / PCA 星云）

【可选：ModelArts 云端环境】
  - 华为云 ModelArts（旧版）在线推理服务
  - 华为云 OBS（对象存储，数据管理）
  - MindSpore（昇腾 AI 框架，用于 Autoencoder 训练与部署）


================================================================================
四、前端界面运行步骤
================================================================================

【方式一：一键启动】

  Windows:
    双击运行 启动.bat
    脚本将自动安装依赖、启动后端、打开浏览器访问主页

  macOS / Linux:
    ./start.sh
    脚本将自动检查 Python、安装依赖、启动后端

【方式二：手动启动】

  步骤 1：安装依赖
    pip install -r requirements.txt

  步骤 2：启动后端服务
    python backend/app.py

  步骤 3：打开浏览器访问以下地址：
    统一后端 API 基础地址：http://localhost:5000

    王哲主页（海洋-大气多维耦合分析）：http://localhost:5000/
    刘国宁页面（海气耦合与异常检测）：http://localhost:5000/members/liu/
    程传哲页面（碳汇压力分析）：    http://localhost:5000/members/cheng/
    许一凡页面（综合分析）：        http://localhost:5000/members/xu/

【自定义端口】
  如果端口 5000 被占用，可通过环境变量指定其他端口：
    PORT=5001 python backend/app.py

  或修改 启动.bat 中的端口号。


================================================================================
五、数据、模型和 AI 模型调用方法
================================================================================

────────────────────────────────────────────────────────────────────────────
5.1 数据集说明
────────────────────────────────────────────────────────────────────────────
  数据文件：data/第2组-全球海洋大气耦合-实验3-地理数据.json
  数据量：3600 条记录
  海域：6 个（太平洋、大西洋、印度洋、北极海域、南极海域、赤道区域）
  时间范围：2020-01 ~ 2022-12（36 个月）
  原始字段（18个）：
    id, time, longitude, latitude, region,
    sst, salinity, wind_speed, wind_dir, pressure, precipitation,
    co2, wave_height, humidity, current_speed, chlorophyll

  派生字段（由 data_adapter.py 自动计算）：
    - sst_anomaly：SST 距平值 = sst − 该(海域,月份)气候态月均值
    - ohc：海洋热含量代理 = 1025 × 3850 × 50 × (sst − 0) / 1e9（单位：GJ/m²）
    - wind_stress：风应力 = 1.225 × 1.3e-3 × wind_speed²（单位：N/m²）

────────────────────────────────────────────────────────────────────────────
5.2 本地模型
────────────────────────────────────────────────────────────────────────────

  (1) LOF 异常检测模型（Local Outlier Factor）
      - 位置：成员-刘国宁/model.py（LofModel 类）
      - 实现：基于 sklearn.neighbors.LocalOutlierFactor 的 fit_predict 模式
      - 功能：对 10 个数值字段逐海域进行局部离群因子检测
      - 输出：归一化异常得分（0-100），阈值自动划分正常/异常标签
      - 预训练文件：models/lof_results.json
      - 调用方式：
          * 后端 API：GET/POST /api/model/lof?n_neighbors=20
          * Python 直接调用：
            from 成员-刘国宁.model import ModelInput, LofModel
            model = LofModel()
            inp = ModelInput(records=data, fields=fields, regions=regions)
            out = model.predict(inp)

  (2) Autoencoder 深度学习模型
      - 位置：成员-刘国宁/model.py（AutoencoderModel 类）
      - 实现：基于 PyTorch 的对称瓶颈自编码器
      - 网络结构：input_dim → hidden_dim → latent_dim → hidden_dim → input_dim
      - 训练：Adam 优化器 + MSELoss，Early Stopping（patience=20）
      - 输出：基于重构误差的归一化异常得分（0-100），按 contamination 分位数分正常/异常
      - 预训练文件：
          models/autoencoder_weights.pt（PyTorch 权重）
          models/autoencoder_norm.json（归一化参数）
          models/autoencoder_results.json（预计算检测结果）
      - 调用方式：
          * 后端 API：GET/POST /api/model/autoencoder?hidden_dim=16&latent_dim=4&epochs=200&lr=0.001&contamination=0.05
          * Python 直接调用：
            from 成员-刘国宁.model import ModelInput, AutoencoderModel
            model = AutoencoderModel()
            inp = ModelInput(records=data, fields=fields, regions=regions, params={"epochs": 200})
            out = model.predict(inp)

  (3) 随机森林 SST 预测模型（王哲）
      - 位置：成员-王哲/code/task2_predict.py
      - 实现：sklearn RandomForestRegressor + LinearRegression 多变量 SST 预测
      - 输出：预测值、特征重要性、预测误差指标
      - 预计算打包：frontend/js/data-bundle.js（window.OCEAN_DATA）
      - 注意：该模型运行在离线算法管线中，不在 Flask 后端运行时调用
      - 更新流程：
          1. 修改 code/ 下算法代码
          2. python code/run.py（重生成 output/*.json）
          3. python code/build_bundle.py（重打包 data-bundle.js）
      - 接口预留：predict() 函数预留了替换为昇腾 ModelArts 调用的接口

  (4) PCA 降维分析（王哲）
      - 位置：成员-王哲/code/coupling_pca.py
      - 功能：对多维海洋-大气变量进行主成分分析，生成 3D 耦合星云图数据
      - 输出：pca_points.json（降维坐标），pca_explained.json（解释方差比），
              correlation_matrix.json（Pearson 相关系数矩阵）

  (5) 时序平滑模型（王哲）
      - 位置：成员-王哲/code/task1_smoothing.py
      - 算法：滑动平均 + 指数平滑（用于 SST 时序趋势提取）
      - 输出：smoothed.json

────────────────────────────────────────────────────────────────────────────
5.3 ModelArts 云端模型部署与调用
────────────────────────────────────────────────────────────────────────────

  团队尝试使用华为云 ModelArts（旧版）进行模型部署与在线推理：

  (1) 模型训练（ModelArts Notebook）
      - Notebook：成员-刘国宁/deepmodel.ipynb
      - 功能：通过 modelarts.session.Session 从 OBS 下载数据，
              预处理后训练 LOF（sklearn）和 Autoencoder（MindSpore）
      - 数据路径：obs://data-vision-guo/data/

  (2) 模型训练（本地 MindSpore）
      - 脚本：小组材料/Autoencode模型.py
      - 功能：在 CPU 环境下使用 MindSpore 训练 Autoencoder
      - 网络结构：9→6→3→6→9
      - 输出：checkpoint + norm 参数 + 检测结果 + loss 曲线图

  (3) ModelArts 模型部署
      - 部署包：小组材料/model/
      - 配置：config.json（模型类型=MindSpore，算法=anomaly_detection）
      - 服务类：customize_service.py（继承 SingleNodeService）
      - 推理类：detector.py（AutoencoderDetector，加载 .ckpt 进行推理）

  (4) API 调用
      - 调用脚本：小组材料/api调用.py
      - 认证方式：AppCode（X-Apig-AppCode 请求头）
      - 请求格式：POST，JSON body = {"records": [...], "fields": [...]}
      - 响应格式：anomaly 列表 + 海域统计 + 阈值等

  (5) 已知问题（详见 update_chapter5.py）
      - ModelArts Notebook 中 MindSpore Autoencoder 训练报错（框架兼容性）
      - SingleNodeService 基类继承报错（接口不匹配）
      - API 调用 403 认证错误（Token vs AppCode 混淆，已通过使用旧版 API + AppCode 解决）


================================================================================
六、API 接口使用说明
================================================================================

────────────────────────────────────────────────────────────────────────────
6.1 页面路由
────────────────────────────────────────────────────────────────────────────

  GET  /                         王哲主页（海洋-大气多维耦合分析）
  GET  /members/liu/             刘国宁页面（海气耦合与异常检测）
  GET  /members/cheng/           程传哲页面（碳汇压力分析）
  GET  /members/xu/              许一凡页面（综合分析）

────────────────────────────────────────────────────────────────────────────
6.2 数据 API
────────────────────────────────────────────────────────────────────────────

  GET /api/meta
    说明：获取数据集元信息
    返回：总记录数、时间范围、月份列表、区域列表、经纬度范围、各字段值域

  GET /api/data/filter
    说明：统一数据过滤、分页、聚合
    参数：
      type     — 查询类型（可选）
      time     — 时间范围过滤，格式如 "2020-01~2022-06"（可选）
      region   — 海域名称过滤（可选）
      agg      — 聚合指标：ohc / sst / sst_anomaly / wind_stress（可选）
      page     — 页码，默认 1
      page_size— 每页条数，默认 500
    返回：过滤结果、分页信息、匹配总数、耗时，若指定 agg 则附加月度聚合序列

  GET /api/data/point?id=<记录ID>
    说明：获取单条记录详情 + 气候态对比
    参数：id — 记录 ID（整数，必填）
    返回：该记录的所有字段 + 同(海域,月份)气候态 SST 均值与偏差

  GET /api/data/raw
    说明：返回原始 JSON 数据文件全量内容（程传哲页面 fallback 使用）

  GET /api/geojson
    说明：将过滤结果转为 GeoJSON FeatureCollection
    参数：同 /api/data/filter（type / time / region）
    返回：GeoJSON 格式的地理点集合

────────────────────────────────────────────────────────────────────────────
6.3 统计分析 API
────────────────────────────────────────────────────────────────────────────

  GET /api/health
    说明：服务健康检查
    返回：状态、记录数、区域列表、字段列表、模型状态

  GET /api/stats/regional
    说明：按海域分字段统计（mean / std / min / max / count）

  GET /api/stats/outliers
    说明：IQR 异常值摘要
    返回：总剔除数、剔除比例、按海域和变量的剔除分布

  GET /api/stats/extremes
    说明：极值记录（2σ 以上，取 top 100）

  GET /api/stats/overview
    说明：数据概览（总记录数、活跃区域、时间跨度等）

────────────────────────────────────────────────────────────────────────────
6.4 ML 模型 API
────────────────────────────────────────────────────────────────────────────

  GET /api/model/status
    说明：查看所有模型的加载状态

  GET|POST /api/model/lof
    说明：LOF 局部离群因子异常检测
    参数：n_neighbors（默认 20，可选）
    返回：anomaly 标签、异常得分、各海域统计

  GET|POST /api/model/autoencoder
    说明：Autoencoder 深度学习异常检测
    参数：hidden_dim（默认 16）、latent_dim（默认 4）、epochs（默认 200）、
          lr（默认 0.001）、contamination（默认 0.05）
    返回：anomaly 标签、重构误差得分、各海域统计

  GET|POST /api/model/coupling
    说明：海气耦合分析（占位接口）
    返回：耦合分析结果

  GET|POST /api/model/forecast
    说明：时序预测
    参数：field（预测目标字段，默认 sst）、horizon（预测步数，默认 6）
    返回：预测结果

  GET|POST /api/model/cluster
    说明：聚类分析
    参数：n_clusters（聚类数，默认 3）
    返回：聚类标签与统计

────────────────────────────────────────────────────────────────────────────
6.5 通用返回格式
────────────────────────────────────────────────────────────────────────────

  数据 API：
    {"ok": true, "data": ..., "count": ..., "total_matched": ..., ...}

  模型 API：
    {"ok": true/false, "model": "模型名", "version": "版本",
     "result": {...}, "error": "错误信息（如有）"}


================================================================================
七、注意事项与常见问题
================================================================================

  1. 数据文件改名
     如果修改 data/ 下的 JSON 文件名，必须同步更新：
       - backend/data_adapter.py 的 _DATA_FILE 常量
       - backend/app.py 中 /api/data/raw 端点内的文件名

  2. 王哲算法产物更新
     修改 成员-王哲/code/ 下任一算法文件后，需依次执行：
       python 成员-王哲/code/run.py          # 重新生成 output/*.json
       python 成员-王哲/code/build_bundle.py  # 重新打包 data-bundle.js
     前端才会读取到新计算结果。

  3. 端口占用
     默认使用端口 5000。若被占用：
       - 通过 PORT 环境变量指定其他端口：PORT=5001 python backend/app.py
       - macOS/Linux：start.sh 会自动检测端口冲突并提示
       - Windows：taskkill /F /PID <进程ID> 停止占用进程

  4. 编码注意事项
       - 启动.bat 使用 GBK 编码（Windows 批处理），修改中文时需注意编码
       - Python 文件中包含中文注释，需保存为 UTF-8
       - 成员目录名含中文字符，因此 model_adapter.py 使用 importlib 动态加载

  5. 依赖安装
     如果安装 torch 遇到问题：
       - CPU 版本：pip install torch --index-url https://download.pytorch.org/whl/cpu
       - 或仅使用预训练文件跳过在线训练（将 autoencoder_weights.pt 放入 models/）

  6. ModelArts 模型加载
     若后端启动时找不到预训练文件，LOF 和 Autoencoder 会在启动时在线训练。
     首次启动可能需要较长时间（Autoencoder 训练约需数秒到数十秒）。
     可将 models/ 下的预训练文件置于正确路径以跳过在线训练。

  7. 各成员页面相对路径
     - 王哲主页（/）的相对路径 css/、js/、lib/ 由 backend/app.py 桥接映射
     - 其他成员页面通过 ../static/ 引用共享的 nav.css、global.css 等
     - 新增此类引用时需确保路径前缀正确


================================================================================
八、其他说明
================================================================================

  1. ModelArts 实验截图
     王哲截图位置：成员-王哲/ScreenShot/
     刘国宁个人材料：成员-刘国宁/刘国宁-个人材料/
     报告相关文件：各成员目录下 个人实验报告/ 或 Doc/

  2. 参考资料
     - 华为云 ModelArts 文档：https://support.huaweicloud.com/modelarts/
     - MindSpore 官方文档：https://www.mindspore.cn/docs/
     - D3.js 官方文档：https://d3js.org/
     - Plotly.js 官方文档：https://plotly.com/javascript/
     - scikit-learn LOF：https://scikit-learn.org/stable/modules/generated/sklearn.neighbors.LocalOutlierFactor.html
     - PyTorch 文档：https://pytorch.org/docs/

  3. 版本信息
     - Git 仓库：已初始化（main 分支）
     - 项目根目录：E:\课程\可视化\实验四


================================================================================
                            文档结束
================================================================================
