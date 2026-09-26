# TASK-20260926-project-documentation-snapshot：长期文档历史快照

- 归档日期：2026-09-26
- 模块与关键词：产品需求、接口契约、验证方法、历史验证、AgentNotes
- 维护归属：`docs/adopt-agentnotes` 工作分支
- 来源基线：`9d688f69a74e263642649d0197dbd9d207293661`
- 关联：[AgentNotes 接入决定](TASK-20260926-agentnotes-adoption.md)

## 归档说明

本文件保存接入 AgentNotes 前三份长期文档的完整内容，供按需回顾需求、行为约定和过去的验证证据。原文件停止维护；当前项目约束与验证方法见 [AGENTS.md](../../AGENTS.md)，接口字段与行为以相关代码、共享类型和测试为准。后续工作记入对应 Task，不继续往本快照追加结果。

归档日期不是测试执行日期。下文原有日期照录；没有标明日期或代码基线的段落保持未知，不将相邻段落的日期套用到它们。原文中的“本次”“当前”“尚未执行”和测试数字均属于旧记录，可能已经被后续 Task 或代码取代；不代表 2026-09-26 重新运行或验证。

仅调整原文标题层级和因目录移动而失效的相对链接，保留原始内容及证据边界。

## 原 docs/requirements.md

### Sayseed V0.1 需求记录

#### 已确认的产品边界

个人自用，可开源，自托管，单用户登录。Chrome 扩展辅助表达；联网 iPhone PWA 管理收藏与复习。中文界面，英文表达忠于用户原意、事实边界、交流意图、确定程度和情绪强度，不强行添加赞美、俚语或营销话术。

#### X 助手

中文写在 X 原输入框；点击回复/发帖按钮右侧的助手按钮后自动获取上下文并开始翻译。独立发帖无上文；详情页和楼中楼回复均只读取直接回复对象，不追溯更早回复链；引用独立读取引用卡。成功读到对应对象即满足上下文要求，不因缺少祖先链提示不完整。输入框和回复目标分别绑定，弹窗与背景不得串稿。

浮层展示一个可编辑的英文结果，支持停止、重试、模型选择、中文继续修改和复制。采用后回填原框并保留撤销能力；原框发生新编辑时，旧结果不得覆盖。X 最终发布始终由用户完成。必要歧义可返回中文澄清，不能把澄清作为译文采用。

翻译、译文解释和网页划词解释弹窗均可拖动标题，保持在视口内。译文解释优先放在翻译窗右侧，窄屏退让；手动拖动后不被滚动、内容变化等自动定位覆盖。主帖详情的回复框收起时不注入按钮，展开后将助手放在提交按钮右侧并垂直居中；其他三种入口保持右侧位置。

翻译使用用户提供的完整提示词正文，保留语境判断、语气分寸、自然表达、事实边界与输出前检查；文件末尾空输入模板由实际内容填充。程序仅补充网页参考材料边界和必要澄清的 CLARIFY: 输出协议。用户补充意图单列，不归为抓取的网页材料。

翻译只使用文字语境，不预览、下载或发送帖子图片，也不要求模型具备图片能力。显示实际获取的文字，允许补充和移除。不要根据相邻位置推断祖先关系；必要对象缺失或文字截断须明确提示。图片标识仅可在扩展内部用于识别回复对象。

#### 划选与收藏

覆盖助手译文和普通网页中可选中的英文文字。原生选择结束后出现小「解释」按钮；点击才发起模型调用。先捕获选中文字和完整句子，再打开浮层，防止点击使选区丢失。原句可检查与修正。

模型接收表达、原句和必要邻近上下文，返回中文语境义、句子释义、搭配或语气说明。译文中的解释沿用本次模型，网页解释使用默认模型。收藏操作明确独立，保存表达、原句、解释、必要语境与来源；网页收藏不强制存在中文草稿。

重复打开当前解释无需再请求；复习使用保存结果。同一表达、原句和来源重复收藏不建新卡，同词不同语境可分别学习。

#### 学习与管理

原句理解卡：正面原句高亮目标，背面语境义与用法，自评四档。使用 ts-fsrs 默认调度，到期卡优先于新卡。评分与记录原子保存，并防止重复提交和旧版本覆盖。只在保存成功后推进页面。

词库支持搜索、查看、修改、暂停、删除和导出。模型设置支持多个供应商和多个模型、默认选择、图片能力标记和连接测试；密钥服务端加密存储，读取配置不得返回明文。

模型列表明确返回具体推理强度档位时提供配置，默认跟随服务商，不维护猜测的型号档位表。官方 DeepSeek HTTPS 接口在列表已确认推理能力时按官方协议补充「关闭」（none），其他兼容服务需列表明确返回 none；选择应用到翻译、解释及测试。安装/升级时声明扩展 HTTP/HTTPS 访问权限，连接服务器和划词开关不再运行时申请权限。扩展登录直接在图标小弹窗内完成，服务器地址和密码表单不另开标签页；登录由后台持久化。网页与扩展活跃使用时每天最多续期一次，每次延长为 30 天；后台空转不续期，过期重新登录。

后台提供模型使用记录，保存调用时间、用途、模型和供应商名称快照、成功/失败/取消、耗时、推理设置及服务返回的输入、输出、总计、推理和缓存 token。支持用途、状态、模型筛选和分页，汇总当前筛选范围。缺失用量显示未知。每条记录可展开完整调用上下文：系统提示词、输入消息、请求选项、原始输出和供应商实际返回的思考内容（若有）。失败或取消保留已收到的部分输出。只在详情接口返回大段内容，列表保持轻量。历史记录中已保存的图片仍可查看；旧记录未保存的内容不回补；模型或供应商删除后历史仍可查看。不记录 API 密钥、鉴权请求头或供应商错误正文。

#### 验收

- 四个真实 X 入口的按钮、目标、上下文、流式生成、回填与撤销。
- 输入框变化、弹窗切换、重复挂载和不确定回复链不会导致错误覆盖或串语境。
- 网页跨文本节点划词、重复词定位、原句纠正及来源保存。
- 至少两种模型协议的文本调用，确认旧客户端附带的图片也不会下载或传给模型，异常与取消可恢复。
- 词条去重、不同语境分卡、手机同步、四档评分、幂等重试与陈旧版本冲突。
- 使用至少10条真实内容人工检查自然度、忠实度及同中文不同语境的合理变化。

#### 延后

自动发布、博主风格提炼、完整回复链抓取、图片/视频/GIF理解、外链全文抓取、图片内选词、PDF划词、离线评分、推送提醒、主动表达卡、公开注册和计费。

## 原 docs/implementation-contract.md

### Shared implementation contract

All user-facing UI is Simplified Chinese. Code comments and commit messages are English. This is a single-user self-hosted app, with no public signup. Shared types and schemas live in `@sayseed/shared`; coordinate changes with the root agent.

#### HTTP conventions

JSON responses, success payloads described below; errors are `{ error: string }` with appropriate status. Authentication uses HttpOnly cookie for same-origin web and bearer token for extension. Extension requests include Authorization, never cookies. Backend supports extension CORS preflight. Node runtime, SQLite persisted under SAYSEED_DATA_DIR (default ./data). SAYSEED_PASSWORD is the single-user login password; fail closed if missing. Keys stay server-side and are encrypted with a persistent secret.

- GET /api/session -> `{ authenticated: boolean, configured: boolean }`
- POST /api/auth/login `{ password }` -> `{ token: string }`, also sets cookie.
- POST /api/auth/logout -> `{ ok: true }`, clears cookie.
- GET /api/health -> `{ ok: true }`
- GET /api/connections -> `{ connections: Connection[] }`
- POST /api/connections (connectionInputSchema) -> `{ connection: Connection }`
- PATCH /api/connections/:id (partial input; omitted/empty apiKey preserves old secret) -> `{ connection }`
- DELETE /api/connections/:id -> `{ ok: true }`, also removes its models.
- GET /api/models -> `{ models: Model[] }`
- POST /api/models (modelInputSchema) -> `{ model: Model }`
- PATCH /api/models/:id (partial input) -> `{ model }`
- DELETE /api/models/:id -> `{ ok: true }`
- POST /api/models/:id/test -> `{ ok: true, message: string }`; actually make a minimal text request, timeout bounded.
- POST /api/translate (TranslateInput) -> SSE records `data: <TranslationEvent JSON>\n\n`. No named SSE events. Done kind distinguishes translation vs necessary Chinese clarification. Client must not adopt partial/error/clarification output. Model changes apply to next explicit request.
- POST /api/explain (ExplainInput) -> `{ explanation: Explanation }`
- GET /api/usage?limit=30&offset=0&purpose=translate|explain|test&status=success|error|cancelled&modelId=<saved-model-id> -> `UsageResult`: authenticated lightweight history, historical model filters, and summaries across all matching rows; limit 1–100. Unknown token counts remain null. List queries omit the large context column.
- GET /api/usage/:id -> `UsageDetail={record: UsageRecord, context: UsageContext|null}`; authenticated, 404 if absent. Null context means the old record did not capture it.
- GET /api/notes?q=... -> `{ notes: Note[] }`
- POST /api/notes (NoteInput) -> `{ note: Note, duplicate: boolean }`; same expression+sentence+source dedup, one FSRS card per note.
- PATCH /api/notes/:id (partial NoteInput + suspended?: boolean) -> `{ note }`
- DELETE /api/notes/:id -> `{ ok: true }` including its card/logs.
- GET /api/review -> `{ items: ReviewItem[], dueCount: number, newCount: number }`. Only due cards, non-new first, then new. Every item's four interval previews are ISO dates from FSRS. Reveal before choosing rating.
- POST /api/review (reviewInputSchema) -> `{ ok: true, due: string }`; atomic, idempotent by key, conflict 409 on stale revision. Client retains same key when retrying an uncertain submission. Refresh queue after success; don't lose the currently displayed card on failure.
- GET /api/export -> `{ version: 1, exportedAt: string, notes, cards, reviews }`; no credentials. UI may download as JSON backup; document DB backup restore as authoritative backup.

Sessions last 30 days and renew on successful authenticated activity at most once per 24 hours. Visible web requests and user-triggered extension requests send `X-Sayseed-Activity: 1`; no keepalive timer runs. Web clients receive an HttpOnly Set-Cookie; bearer clients receive the CORS-exposed `X-Sayseed-Session` header. Login/logout/health, inactive and expired sessions never renew. Logout and replacement web login persistently revoke the old nonce. Extension session writes are serialized and compare server, identity and expiry so stale responses cannot replace newer credentials or undo local logout.

Model discovery: `GET /api/connections/:id/available-models` requires authentication and returns `{ models: Array<{ id, name, description?, capabilities? }>, truncated: boolean }`. Optional capabilities are `supportsImages`, `contextWindow`, `maxInputTokens`, `maxOutputTokens`, `reasoningEffortLevels`, and `defaultReasoningEffort`. DeepSeek `effort.supported_levels` / `default_level` and Anthropic per-level `capabilities.effort` declarations provide effort choices; a thinking boolean alone does not. `Model.reasoningEffort` is nullable (follow provider), validated against server-cached discovery and used for translation, explanation and model testing. No model-name guessing. For the exact official DeepSeek HTTPS origin and /models or /v1/models endpoint, discovered effort-capable models additionally support `none` per the documented API; the list only enumerates enabled-thinking levels. Other compatible endpoints must explicitly return `none`. Anthropic and Google do not infer off from a thinking flag or a low effort level. Only explicit valid provider metadata is mapped; missing values remain unknown. DeepSeek-compatible `input_modalities`/`context_window`/`max_output_tokens` work through both OpenAI connection protocols. Anthropic maps `capabilities.image_input.supported`/`max_input_tokens`/`max_tokens`; Google maps `inputTokenLimit`/`outputTokenLimit`. Input limits are not relabeled as total context windows. OpenAI's standard list fields do not declare these capabilities.

Discovery reads saved credentials on the server, follows provider pagination with request/response bounds, never follows redirects with credentials, and records server-trusted reasoning metadata. A refreshed list updates saved reasoning capabilities and clears choices no longer supported. Upstream auth errors are gateway errors rather than local session errors. The UI permits manual IDs on empty, unsupported or failed discovery and invalidates results when the connection or model-edit session changes. Current-ID matches and selected results fill the form, while explicit manual image overrides remain possible; saving persists the metadata. PATCH omitted capabilities preserves them; `{}` clears client-managed capability values, while reasoning choices always follow the server-trusted discovery cache. Identity changes clear old metadata; endpoint, protocol or key changes clear metadata and image support. An additive nullable SQLite column preserves legacy installations. AI SDK calls do not require a context-window setting; the declared maximum output is not automatically used as a request budget.

Provider references: [DeepSeek](https://api-docs.deepseek.com/api/list-models/), [Anthropic](https://platform.claude.com/docs/en/api/models/list), [Google](https://ai.google.dev/api/models), [OpenAI](https://platform.openai.com/docs/api-reference/models/object).

#### Ownership

For parallel work, agree on file boundaries in the active task and record who maintains its Task document. A useful split is backend APIs and server code, web UI excluding APIs, and the extension; coordinate shared types, workspace configuration, dependencies and lockfiles with the integrating agent. Assignments from an earlier task do not establish permanent ownership. Do not modify another active agent's assigned files without coordination. See [collaboration rules](../../AGENTS.md) and the [Task template](TEMPLATE.md).

User-facing model connection entities are called “供应商”; internal connections URLs, identifiers and database tables are unchanged. Model usage navigation is “模型使用记录”.

#### Product behavior

Chrome MV3 extension, WXT React. X editor toolbar assistant; capture exact editor draft and click target before reply/quote dialog opens. Original post, inline reply, modal reply, quote must be distinguished. Reply context contains only the directly replied-to post; quote context contains the quoted card; standalone posts have no context. Do not capture ancestors or warn just because a chain is absent. Show a concrete notice only when the required target cannot be read. Image identifiers may be used internally to match source posts, but translation previews and outbound context include text only. Capture source post URL even when current URL is /compose/post. Floating UI in isolated Shadow DOM. Anchor Sayseed to the right of the matching submit button, vertically centered. When X wraps the submit in a flex-column container within a flex-row parent, insert beside that wrapper. Main-post inline replies omit the assistant while their toolbar is collapsed and inject it after expansion. All panels have draggable headers, remain within the viewport, and preserve manual placement. Translation explanations prefer the right side, with left-side or overlay fallback on narrow screens. Chinese is written in X, translated English in float. Adoption and undo require unchanged editor snapshot; otherwise offer copy. Never publish. Keep original Chinese separately for follow-up revision.

All normal webpages: native selection -> small Explain button -> popover; model call only on button click. Capture sentence and selection BEFORE focus is lost; allow sentence correction; keep native copy behavior. Popup shows sentence, contextual meaning, usage, save. Exclude password/input/textarea/contenteditable (except own translation result) and extension UI. Only explicit selection and limited surrounding text sent. Cache within current popup, retry errors. Required HTTP/HTTPS host permissions are declared at install/update; connection and webpage-selection toggles make no runtime permission requests. Login runs inside the extension icon popup using the shared connection form; successful tokens are persisted by the background so closing the popup does not undo login. Unrelated storage changes must not replace an unsaved server address. Selection remains opt-in; x.com translation is default. Chrome internal pages not supported. Explain selected generated translation with same model, general webpages with default model.

The user-approved full translation prompt lives in server/prompts.ts, without the blank per-request input template. Only the application material boundary and CLARIFY output contract are appended. User-supplied intent is separated from captured web references. Captured context text is untrusted data in model prompts. Preserve user meaning, stance, confidence, emotional strength. No marketing, added praise/facts, forced slang. One natural English result; Chinese clarification only for meaning-changing ambiguity. Translation is text-only. The extension clears images before sending context. The backend ignores legacy image fields, never downloads images, omits image metadata from the prompt, and makes no image capability checks. Model capability metadata remains available independently.

PWA: review, vocabulary, settings, model usage history, single-user login. Usage logs snapshot model/provider names and store terminal status, latency, selected reasoning and provider token metadata. New records also preserve the complete SDK system prompt, text input messages, non-sensitive request options, original text output and provider-returned reasoning. Historical image-bearing usage records remain readable. Failed/cancelled calls retain received partial output. Never capture API keys, authorization headers or upstream error bodies. Context is fetched on demand, rendered as plain text, and unavailable for legacy records. Each model call has at most one terminal record; logging failures do not fail completed calls. Queries aggregate the current filter, preserve unknown token counts and retain history after model deletion. No offline reviews, quizzes beyond contextual recognition, reminders, public signup, autonomous posting or full-chain scraping. FSRS default scheduling. Durable logs. Users can suspend/edit/delete notes. Keys write-only in settings. Clear loading, empty, offline/error and retry states.

For Responses providers, also extract explicit `reasoning_text` from raw response events and JSON bodies when the SDK does not expose it as reasoning text. Prefer returned full reasoning text over a summary, deduplicate streamed deltas against done/final snapshots, and preserve received reasoning on cancellation or failure. Raw response objects and headers are transient and must not be persisted. Empty reasoning means not recorded, not proof that the provider performed no reasoning or returned none. Earlier missing reasoning cannot be reconstructed.

## 原 docs/testing.md

### 验证说明

#### 自动检查

在项目根目录运行：

```bash
pnpm typecheck
pnpm test
pnpm build
```

单元测试覆盖上下文识别、输入框回填保护、划词原句提取、流式解析，以及服务端鉴权、数据保存和复习调度。测试使用临时数据库，不需要真实 API Key。

完成构建后可运行 `pnpm test:ci`，自动创建临时生产实例、启动协议模拟器并运行 HTTP 联调，结束后清理。`pnpm test` 也包含版本策略、扩展打包和发布工具测试；单独检查这些脚本可运行 `pnpm test:tooling`。GitHub CI、Linux 容器验证及版本发布见 [发布说明](../release.md)。

服务器更新器的状态机、备份恢复和保留规则测试同样包含在 `pnpm test:tooling` 中。Linux Docker 环境可对已构建镜像运行隔离演练：

```bash
sudo python3 scripts/test-updater-docker.py --image sayseed:ci
```

该演练创建独立 Compose 项目、具名卷和本地候选镜像，使用虚构密码检查升级、回滚、重复执行和中断恢复，结束后精确清理测试资源。它不会发布测试版本，也不接受生产数据卷作为参数；需要 root 权限读写临时 Docker 卷以验证真实备份路径。CI 的 `container` job 会运行同一脚本。公网维护入口与定时器安装需另行实测，流程见[服务器自动更新](../deployment.md)。

#### 本地协议与业务联调

以下流程只用于独立的本地测试实例。不要把 `SAYSEED_SMOKE_URL` 指向自己的日常数据库；测试会创建连接、模型、收藏和评分记录。

终端一启动模型协议模拟器：

```bash
node scripts/mock-provider.mjs
```

终端二用临时数据目录启动网站：

```bash
SAYSEED_DATA_DIR=$(mktemp -d /tmp/sayseed-qa.XXXXXX) \
SAYSEED_PASSWORD=fixture-local-password \
SAYSEED_PUBLIC_URL=http://127.0.0.1:3100 \
pnpm --filter @sayseed/web exec next dev --hostname 127.0.0.1 --port 3100
```

终端三运行检查：

```bash
SAYSEED_SMOKE_PASSWORD=fixture-local-password node scripts/smoke.mjs
```

模拟器只监听 `127.0.0.1:4318`，只接受固定的虚构测试密钥。测试验证 OpenAI Chat Completions 与 Anthropic 请求/流式响应、旧图片输入不下载或传递、澄清结果、供应商失败、收藏去重、评分幂等、过期 revision 和导出。它不能验证真实模型的翻译自然度。

#### 浏览器验收

- 网站：登录、配置模型并测试连接、词库搜索/编辑/暂停、翻面和四档评分、导出。
- 手机布局：在 390px 宽度检查表单、长原句、评分和底部导航；iPhone Safari 主屏幕安装需要 HTTPS 环境及真机验收。
- X：加载构建好的 Chrome 扩展，分别检查首页发帖、独立发帖弹窗、详情回复、楼中楼回复弹窗、引用转帖。
- 回填保护：打开助手后改动中文、关闭原回复弹窗、切换另一条回复、生成期间重试/停止，确认旧结果不能覆盖其他草稿。采用后编辑 X 输入框，撤销应提示冲突。
- 划词：测试跨行短语、同段重复单词、带链接或强调的原句；修改句子后重新解释再收藏。检查关闭/重开、网络失败和重复收藏。
- 纯文字翻译：图片帖和图文帖仍绑定正确对象，上下文不展示图片；文字模型正常翻译，新请求与使用记录不包含图片。图片、视频、GIF 理解及 PDF、图片内划词不在首版范围。

扩展只读取当前直接回复对象或被引用帖子，不追溯祖先链。X 改版导致对应对象读取失败时，应提示具体原因并允许补充；正常读取目标时不提示上下文不完整。

#### 本次实现的验证记录

2026-09-25，在 macOS / Node.js 22 环境完成：

- 34 项单元测试、全项目类型检查、网页和 Chrome 扩展生产构建。
- 独立生产服务的 39 项 HTTP 联调检查，使用本地协议模拟器，不使用真实模型凭据。
- 浏览器验证登录、手机宽度下翻面和评分、词库编辑保存、模型配置与连接测试。
- 真实 X 页面的入口和 DOM 结构核对，包括 `aria-describedby` 提示节点、嵌套弹窗、引用卡片、图片短链接和回复对象标记。

尚未执行：在 Chrome 安装本扩展后的完整端到端测试、真实模型质量与图片理解、iPhone Safari 真机安装和 Docker 容器运行。本机未安装 Docker；已验证容器使用的 Next.js standalone 产物能够单独启动并处理数据库与模型请求。

#### 模型列表获取回归

模型列表接口按 [OpenAI](https://developers.openai.com/api/reference/resources/models/methods/list)、[Anthropic](https://platform.claude.com/docs/en/api/models/list) 和 [Google](https://ai.google.dev/api/models) 的官方协议实现。OpenAI Responses 和 Chat Completions 连接共用模型列表协议。

- 新增 10 项服务端回归测试，覆盖各服务认证、默认和自定义地址、分页、Google 生成模型筛选、空列表、错误格式、重定向、响应大小和访问控制。
- 全项目 48 项测试及 53 项 HTTP 联调通过；HTTP 联调运行于独立生产实例、临时数据库和本地模拟器。
- 浏览器验证搜索、选中填入、自定义名称保留、切换连接清理旧列表、同一连接修改地址后清理列表、空列表及查询失败后的手动保存；390px 手机宽度无横向溢出。
- 未使用真实供应商密钥查询，具体第三方服务是否实现标准列表接口仍以实际查询结果为准。

#### 模型能力自动同步回归

- 全项目 61 项测试、类型检查、网页生产构建及隔离实例的 55 项 HTTP 检查通过。覆盖各供应商的能力映射、未知与明确不支持的区分、无效可选字段、旧 SQLite 数据升级、能力保存与清除，以及 PATCH 不误用创建默认值。
- 使用已配置的 DeepSeek 官方连接实际读取 `/models`，并通过项目的发现函数验证：`deepseek-flash` 声明图片输入，`deepseek-v4-pro` 声明仅文本；两者返回上下文 1,048,576、最大输出 393,216。未调用收费生成接口或打印密钥。
- 浏览器在临时数据库实例中验证已有模型自动匹配、图片勾选、保存刷新后保留、切换到纯文本模型自动关闭图片、手动覆盖不被重新获取覆盖、切换 Google 后清除旧能力且只显示输入/输出上限。能力摘要可正常展示，控制台无错误。
- Anthropic、Google 和 OpenAI 元数据按官方文档及本地协议模拟器验证，本轮没有使用这些服务商的真实凭据。


#### 上下文、浮窗、权限与登录续期迭代

- 全项目 95 项测试（服务端 40、扩展 55）、类型检查和网页/Chrome 扩展生产构建通过。
- 上下文回归覆盖四类入口、图片短链接换行、回复对象内嵌引用卡、纯图片引用、旧点击捕获不串帖；回复不再自动追溯祖先链。
- 浏览器使用真实组件和本地模拟响应验证收起回复框按钮锚点、解释窗优先右侧、翻译与解释分别拖动、滚动后保持位置、窄窗口夹紧及关闭解释后恢复翻译窗、普通网页解释窗拖动。未重新加载用户扩展或改动 X 草稿；真实 X 改版适配仍需加载本次构建后验收。
- 会话回归覆盖 24 小时续签门槛、未活跃不续期、旧 token 兼容、过期拒绝、Cookie/Bearer 分离、并发旧响应保护、退出及新登录撤销旧 nonce、撤销重启后仍生效。独立生产 HTTP 实例再次验证续期、闲置、过期和退出撤销。
- 本地实际 AI SDK 请求验证 OpenAI Responses、OpenAI-compatible Chat 和 Anthropic 的推理参数及默认省略；未知模型的 OpenAI 显式档位设置启用 SDK forceReasoning，并关闭自动附加的 reasoning summary。没有调用真实收费生成接口。
- 构建产物 manifest 已包含必需 HTTP/HTTPS host_permissions；连接与划词流程不再调用 chrome.permissions.request。浏览器安装/升级时仍可能确认权限。

- 独立生产实例的 78 项 HTTP 回归通过，包含 DeepSeek/Anthropic 档位发现、保存、默认不传参数、翻译/解释/测试实际参数、刷新撤销不再支持的档位；使用临时数据及固定虚构密钥。
- 浏览器设置页验证列表声明的低/高/最高档位、服务商默认值、从低改为高并保存、刷新后仍保留。

#### 按钮、关闭思考、使用记录与弹窗登录迭代

- 全项目 108 项测试（服务端 48、扩展 60）、类型检查及网页/Chrome 扩展生产构建通过。
- 在用户当前 X 页只读核对 DOM，发现提交按钮位于 flex-column 包装中；生产注入逻辑改为包装右侧。独立浏览器 fixture 验证收起不注入、展开后右侧显示且中心线相差 0px。未改动用户草稿、发布内容或重新加载用户 X 页面。
- 官方 DeepSeek 已声明 effort 的模型补充 `none`；针对性测试覆盖 HTTPS origin/路径边界、未知模型不补充、兼容服务明确声明、可信保存，以及实际 SDK Responses 和 Chat Completions 请求携带关闭参数。未调用真实收费模型。
- 使用日志覆盖成功、失败、取消、截断输出保留用量、未知用量、单侧缺失总量不误报、鉴权、筛选分页、删除模型保留历史及写日志失败不影响主请求。
- 独立生产实例的 83 项 HTTP 检查通过，新增使用日志鉴权、筛选、分页范围及 token 语义验证，使用临时数据库和本地协议模拟器。
- 浏览器验证使用记录成功/失败展示、缺失用量显示未知、筛选、第二页（31–36 条）与全筛选范围统计、390px 手机布局；测试视口随后恢复。
- 扩展真实 React 登录组件通过独立浏览器 fixture 验证表单内登录、退出、无新标签页以及切换划词不覆盖未保存地址。自动测试覆盖密码错误重试、重新打开恢复状态、请求交给后台后关闭 popup 仍持久化。真实 Chrome 扩展需重新加载本次构建后体验；现有用户登录数据保持原样。

#### 完整模型调用内容与提示词迭代

- 全项目 110 项测试（服务端 50、扩展 60）、类型检查和生产构建通过；独立生产实例 86 项 HTTP 检查通过。
- 对照用户提供的《翻译模型提示词.txt》逐字确认：输入模板前的 1407 字符完整正文已保留，应用只追加网页参考材料边界与 CLARIFY 输出协议。用户补充意图与网页材料分开。
- 使用记录详情测试覆盖实际 SDK 提示词、输入文字、原始图片字节及 MIME、原始回复和返回的思考内容、失败/取消部分输出、详情鉴权和 404、旧表增量迁移。列表不读取或返回大体积上下文，记录不包含供应商密钥或鉴权头。
- 浏览器在临时数据库实例中验证“模型使用记录”名称、上下文按需展开、完整系统提示词、输入、请求选项及输出显示，以及手机宽度下长文本和导航无横向溢出；随后恢复视口。设置页的供应商、新增供应商、保存供应商等文案已核对。
- 本轮使用本地协议模拟器，未调用真实收费模型、未修改用户数据库或 X 草稿。翻译自然度仍由真实语境测试判断；这里只确认提示词和调用链正确接入。

#### 翻译改为纯文字

- 全项目 112 项测试（服务端 50、扩展 62）、类型检查、网页和扩展生产构建，以及隔离生产实例的 86 项 HTTP 检查通过。
- 扩展发送前清空目标帖、祖先帖和引用帖的图片，保留原对象供内部身份识别；翻译上下文移除图片预览和图片模型标记。
- 旧客户端携带图片 URL 或 data URL 时，文本模型仍可翻译；断言没有图片下载、模型请求或新日志图片内容。完整批准提示词的 1407 字符正文保持原样。
- 独立代码审查未发现实质问题。本轮使用临时数据库和本地协议模拟器，没有调用真实模型，也未重新执行浏览器验收或修改用户浏览器状态。

#### Responses 思考正文记录修复

- 只读核对本地使用记录：DeepSeek Responses 的 low 调用存在 122 个推理 token，但思考文本为空。安装的 OpenAI SDK Responses 适配器只提取 summary，未转出 DeepSeek 的 reasoning_text 正文。
- 使用已安装的真实 SDK 和本地 HTTP fixture 验证流式正文、delta/done/最终快照去重、取消后部分输出、非流式解释与模型测试，以及标准 summary 回退。原有兼容接口思考记录测试保持通过。
- 后端 53 项测试、类型检查和网页生产构建通过；补充标准 summary 场景后的定向 10 项测试及类型检查通过。没有调用真实付费模型或写入用户数据库。
- 独立审查未发现阻断问题。尚未验证实际 DeepSeek 请求；缺少 output_index 后又补回索引的非标准事件仍可能重复，不属于当前官方事件格式。仅有思考而无译文时取消的路径经过代码审查，未增加依赖计时的集成断言。
