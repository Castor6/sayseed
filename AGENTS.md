# Sayseed 协作规则

## 基本约定

- 与用户交流、任务记录和用户界面使用中文；代码注释和 Git 提交说明使用英文。
- 每个提交使用 `type: description` 格式，例如 `docs: add task documentation workflow`。
- 修改前阅读相关代码和目录内的 `AGENTS.md`；保留已有工作区改动，不做无关整理。
- 项目是 pnpm 工作区：`apps/web` 为 Next.js 网页与服务端，`apps/extension` 为 WXT Chrome 扩展，`packages/shared` 为共享类型和校验。
- 修改 Next.js 代码时遵守 [Web 目录规则](apps/web/AGENTS.md)，按需读取已安装版本附带的文档。

## 文档与任务

- [文档入口](docs/README.md)提供按需导航。按主题读取需求、接口契约和验证说明，不要求每次读取全部历史。
- 实质需求、修复、重构和基础设施工作开始时，使用 [Task 模板](docs/tasks/TEMPLATE.md)创建或续接任务，先记录目标与验收标准；相关小修可以共用任务。
- 文件名为 `TASK-YYYYMMDD-short-topic.md`，标题和模块关键词便于检索。规划与实际结果分开，建议尚未采纳时明确标注。
- 工作中记录影响后续实现的决定；收尾补充日期、代码基线、实际修改、验证结果及未覆盖范围。未运行的测试不得写成通过。
- 单个任务由一个会话或工作分支负责维护，并记录归属；交接时更新归属、续写原文件。其他独立工作另建任务并互链。
- 并行修改前在当前任务中约定文件范围，按需要使用独立 worktree；历史任务的人员分工不自动成为新任务的目录权限。
- [任务检索说明](docs/tasks/INDEX.md)是固定说明，不登记逐项任务列表；按文件名、标题、模块或正文搜索，只打开相关任务。
- Task 保存带日期的工作事实，不维护“待 CI／待合并／未部署”等实时状态，也不记录逐次推送或等待流水。查询外部进展使用关联 PR、Actions、Release 或私有运维记录。
- 长期产品要求提炼到 `docs/requirements.md`，接口与行为约定提炼到 `docs/implementation-contract.md`，可复用验证方法提炼到 `docs/testing.md`；协作规则保留在本文件或模块规则中。Task 保留决定背景与关联。
- 现有验证记录保留其历史日期与边界；后续迭代结果写入各自 Task，无需回填或重写旧任务。

## 验证

- 复用项目已有命令，按改动范围运行类型检查、测试和构建；CI 接入后也使用同一套命令。
- 干净环境先 `pnpm install --frozen-lockfile`；Web 类型检查前可用 `pnpm --filter @sayseed/web exec next typegen` 生成 Next.js 类型。
- 全项目命令：`pnpm typecheck`、`pnpm test`、`pnpm build`。HTTP 联调的模拟服务与隔离实例准备见 [验证说明](docs/testing.md)。
- 构建后运行 `pnpm test:ci` 自动完成隔离生产实例联调。CI/发布工具变动需运行 `pnpm test:tooling`，工作流变动再运行 Actionlint。发布规则见 [CI 与版本发布](docs/release.md)。
- `pnpm test:smoke` 会创建供应商、模型和学习记录，只能连接专用测试实例及临时数据库。自动化检查使用虚构测试凭据，不使用生产数据或真实付费模型。
- 真实 X 页面、Chrome 扩展、iPhone Safari/PWA 和模型质量的验收边界如实记录，单元测试或桌面模拟不能替代真机结果。
- 纯文档修改检查本地链接、示例和空白；收尾运行 `git diff --check`，若本次改动已暂存，再运行 `git diff --cached --check`。未跟踪的新文档也需单独检查。

## 数据与运维

- SQLite 与持久加密密钥必须整体备份；停机或使用一致性备份方法，不遗漏 WAL。网页 JSON 导出不是完整实例备份。
- 真实部署地址、账号、密钥、运行数据、原始日志和备份留在被 Git 忽略的本地目录或私有运维目录，不写进公开任务文档。
- 发布、部署和服务器当前状态以实际配置及现场证据为准，不能由规划文档、PR 合并或历史记录推定已完成。
- 交付行为变化添加新的 `.changeset/*.md`，选择实际受影响的包并写中文说明；只由版本 PR 更新包版本和 CHANGELOG。普通 PR 合并不发布；仅扩展版本变化不触发服务端镜像发布。
