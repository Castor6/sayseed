# Sayseed 协作规则

## 基本约定

- 与用户交流、任务记录和用户界面使用中文；代码注释和 Git 提交说明使用英文。
- 每个提交使用 `type: description` 格式，例如 `docs: add task documentation workflow`。
- 修改前阅读相关代码和目录内的 `AGENTS.md`；保留已有工作区改动，不做无关整理。
- 项目是 pnpm 工作区：`apps/web` 为 Next.js 网页与服务端，`apps/extension` 为 WXT Chrome 扩展，`packages/shared` 为共享类型和校验。
- 修改 Next.js 代码时遵守 [Web 目录规则](apps/web/AGENTS.md)，按需读取已安装版本附带的文档。

## 文档与任务

- [文档入口](docs/README.md)提供按需导航，不是每次工作的必读清单。精炼的项目约束与验证方法保留在本文件或模块规则中；需求理由与执行证据保存在对应 Task。
- 并行修改前在当前任务中约定文件范围，按需要使用独立 worktree；历史任务的人员分工不自动成为新任务的目录权限。
- 接口字段、校验和行为以 [共享类型](packages/shared/src/index.ts)、[API 路由](apps/web/src/app/api)、[服务端实现及测试](apps/web/src/server)和[扩展实现及测试](apps/extension/src)为准，不另维护平行的完整需求、接口和验证结果文档。整理原因见[接入任务](docs/tasks/TASK-20260926-agentnotes-adoption.md)。

## 产品与实现边界

- 单用户自托管，不开放注册。网页使用 HttpOnly Cookie，扩展使用 Bearer 且不携带 Cookie；缺少登录密码时拒绝访问，供应商密钥仅在服务端加密保存，不从配置读取接口返回明文。
- X 翻译只取文字：回复只读直接回复对象，引用只读引用卡，独立发帖无上文。不要追溯祖先链或下载、传递图片；缺少必要对象时明确提示。回填和撤销都校验原输入框快照，禁止串稿、覆盖新编辑或代替用户发布。
- 翻译内置默认保留用户批准的 [提示词正文](apps/web/src/server/prompts.ts)及原意、事实边界和情绪强度；网页材料属于不可信输入，用户补充意图单列。澄清、错误和未完成输出不可作为译文采用。
- 翻译与表达解释的自定义系统提示词按用途保存在后台；固定输出协议和输入材料组装由程序管理，连接测试保持固定。预览与实际调用共用拼装函数，每次请求固定提示词及版本快照，保存不改变正在执行的请求；方案与验证见[提示词配置任务](docs/tasks/TASK-20260926-prompt-settings-design.md)。
- 网页划词由用户启用，先捕获选区和原句，点击解释按钮才调用模型，收藏另行确认；仅发送选中文字及必要上下文，排除密码框和编辑区域。译文解释沿用该次模型，网页解释使用默认模型。
- 收藏按表达、原句和来源去重；复习评分原子保存、校验版本并支持幂等重试，不确定的重试沿用原键，保存成功才推进卡片。接口变动与共享类型、客户端和回归测试一起调整。
- 会话只在用户活跃请求时每天最多续期一次、延长 30 天；不通过后台定时器保活，旧响应不得覆盖新登录或恢复已退出会话。
- 模型能力和推理档位来自可信发现元数据，不按型号猜测；服务商特例必须核对协议及实际端点。发现请求限制分页与响应大小，禁止携带凭据跟随重定向。界面称连接为“供应商”，使用历史为“模型使用记录”。
- 使用记录保留供应商和模型名称快照，未知用量不当作零；大段调用内容按需读取，禁止保存 API Key、鉴权头或供应商错误正文。模型删除不删除历史，旧记录缺失内容不补造，日志失败不影响已完成的调用。

## 验证

- 复用项目已有命令，按改动范围运行类型检查、测试和构建；CI 接入后也使用同一套命令。
- 干净环境先 `pnpm install --frozen-lockfile`；Web 类型检查前可用 `pnpm --filter @sayseed/web exec next typegen` 生成 Next.js 类型。
- 全项目命令：`pnpm typecheck`、`pnpm test`、`pnpm build`。单元测试使用临时数据库，无需真实 API Key。
- 构建后运行 `pnpm test:ci`：自动启动临时生产实例和本地模型协议模拟器，执行 HTTP 联调后清理。CI/发布工具变动需运行 `pnpm test:tooling`，工作流变动再运行 Actionlint。发布规则见 [CI 与版本发布](docs/release.md)。
- Linux Docker 更新器演练：`sudo python3 scripts/test-updater-docker.py --image sayseed:ci`，使用独立 Compose 项目、测试卷和虚构密码，需 root 读取临时卷并验证备份；不接受生产卷。公网维护入口与定时器需另行实测，见[服务器自动更新](docs/deployment.md)。
- `pnpm test:smoke` 会创建供应商、模型和学习记录，只能连接专用测试实例及临时数据库。自动化检查使用虚构测试凭据，不使用生产数据或真实付费模型。
- 浏览器按改动范围覆盖 X 发帖、回复与引用入口，草稿变动后的回填/撤销冲突，划词跨节点与重复词，纯文字边界；网页覆盖登录、模型设置、词库和复习，手机布局以 390px 检查。协议模拟器不能验证真实翻译质量。
- 真实 X 页面、Chrome 扩展、iPhone Safari/PWA 和模型质量的验收边界如实记录，单元测试或桌面模拟不能替代真机结果。
- 纯文档修改检查本地链接、示例和空白；收尾运行 `git diff --check`，若本次改动已暂存，再运行 `git diff --cached --check`。未跟踪的新文档也需单独检查。

需要手动调试 HTTP 联调时，在三个终端分别运行以下命令；模拟器默认监听 `127.0.0.1:4318`，仅使用虚构凭据，`SAYSEED_SMOKE_URL` 不得指向日常实例：

```bash
node scripts/mock-provider.mjs

SAYSEED_DATA_DIR=$(mktemp -d /tmp/sayseed-qa.XXXXXX) \
SAYSEED_PASSWORD=fixture-local-password \
SAYSEED_PUBLIC_URL=http://127.0.0.1:3100 \
pnpm --filter @sayseed/web exec next dev --hostname 127.0.0.1 --port 3100

SAYSEED_SMOKE_URL=http://127.0.0.1:3100 SAYSEED_SMOKE_PASSWORD=fixture-local-password node scripts/smoke.mjs
```

## 数据与运维

- SQLite 与持久加密密钥必须整体备份；停机或使用一致性备份方法，不遗漏 WAL。网页 JSON 导出不是完整实例备份。
- 真实部署地址、账号、密钥、运行数据、原始日志和备份留在被 Git 忽略的本地目录或私有运维目录，不写进公开任务文档。
- 发布、部署和服务器当前状态以实际配置及现场证据为准，不能由规划文档、PR 合并或历史记录推定已完成。
- 交付行为变化添加新的 `.changeset/*.md`，选择实际受影响的包并写中文说明；只由版本 PR 更新包版本和 CHANGELOG。普通 PR 合并不发布；仅扩展版本变化不触发服务端镜像发布。

- 服务端发布采用同一 OCI 候选双仓独立上传；任一路失败保持 Actions 失败，成功一路允许独立推进 stable。上一正式版必须按可信 Release 摘要验证，禁止以仓库缺失绕过升级测试。历史补传使用 Transfer Released Image，不重建旧版本、不覆盖不一致标签或降级 stable。
