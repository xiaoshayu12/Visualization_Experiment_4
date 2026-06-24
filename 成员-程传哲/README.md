# 成员4碳汇压力可视化独立版

直接双击 `index.html` 即可打开页面。该目录只包含成员4自己的高级图表、原始数据和必要运行依赖，不依赖原项目中的其他组员页面。

目录说明：

- `index.html`：成员4个人题目页面。
- `data/组号-全球海洋大气耦合-实验2-选题扩展数据集.json`：实验2原始数据。
- `data/original-dataset.js`：为支持双击打开而生成的本地数据加载文件，内容来源于同一份原始 JSON。
- `assets/d3.v7.min.js`：本地 D3 运行库。
- `assets/data-adapter.js`：独立版数据适配器。

如浏览器安全策略限制本地脚本，可在该目录打开终端执行：

```bash
python -m http.server 8899
```

然后访问 `http://localhost:8899/index.html`。
