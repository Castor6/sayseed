# 任务检索

任务以独立 Markdown 文件保存。本页只提供固定检索说明，不逐项列出任务；新增或续接任务无需修改本页。

从仓库根目录运行：

```bash
rg --files docs/tasks -g 'TASK-*.md'
rg --files docs/tasks -g '*github-ci-release*'
rg -l 'CI|发布|扩展' docs/tasks -g 'TASK-*.md'
rg -n '验收|未覆盖' docs/tasks/TASK-20260925-github-ci-release.md
```

先按文件名、任务编号、标题、模块或正文关键词筛选，再打开相关详情，无需读取全部历史。

新增记录使用 [Task 模板](TEMPLATE.md)，文件名为 `TASK-YYYYMMDD-short-topic.md`。同一天可有多个不同主题的任务；继续同一任务时保留文件名，补充日期和新事实。每个文件注明维护归属，独立工作通过相对链接关联。

如需总目录，可按需生成本地结果，不提交生成文件。记录约定见[开发与迭代文档](../README.md)。
