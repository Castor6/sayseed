# TASK-20260926-agentnotes-adoption：项目级采用 AgentNotes 并收敛长期文档

- 记录日期：2026-09-26（事实截至本次工作）
- 模块与关键词：AgentNotes、Task、需求沉淀、设计理由、文档归档、验证方法
- 维护归属：`docs/adopt-agentnotes` 工作分支
- 关联：[AgentNotes](https://github.com/Castor6/agentnotes)、[旧文档快照](TASK-20260926-project-documentation-snapshot.md)、[原文档体系接入](TASK-20260925-github-ci-release.md)

## 背景与目标

用户希望将讨论中确认的需求、设计理由和工作结果轻量保存在项目中，日后能回顾“为什么这样设计”。通用方法抽为 AgentNotes，通过项目级安装供 Agent 按场景选择，无需每个使用者另改 `AGENTS.md` 才能采用。Sayseed 原有三份长期文档同时承担需求、接口说明、验证方法和历次结果，持续追加容易膨胀，也容易把旧结果看成现状。

## 验收标准

- [x] 项目级安装 GitHub 上更新后的 Skill，内容与来源一致。
- [x] 清理 AGENTS 与文档导航中重复的通用 Task 提示，保留项目特有的协作、验证与数据运维约束。
- [x] 停止维护三份长期文档；可复用方法与重要约束提炼到 AGENTS，原始信息完整归档到 Task。
- [x] 沿用已有任务目录、中文模板及检索说明，不重写历史事实。
- [x] 本地链接、原文保全和空白检查通过，既有无关工作区修改保持不变。

## 讨论结论

- Skill 摘要覆盖实质开发、需求讨论、任务续接或交接及历史回顾，正文保留 Memos 的记录方法。项目导航仅提供入口，不增加强制调用包装或自动召回 hook。
- 需求与设计理由保存在 Task，当前接口细节由代码、共享类型及测试表达；避免再维护一套完整平行契约。AGENTS 只保留跨模块的重要边界和能执行的验证方法。
- 三份文档合成一份历史快照，保留出处基线、原文日期与未知边界。归档日期不等于测试日期；不重新维护快照，也不把未标注日期的旧测试当作本次结果。
- 中文模板补充选择理由、日期化的决策替代关系，后续长期规则提炼到 AGENTS 或模块规则。固定检索说明无需登记新任务。

## 实现结果

- 通过 `npx skills add Castor6/agentnotes --skill agentnotes --agent codex --copy --yes` 安装到 `.agents/skills/agentnotes/`，来源由根目录 `skills-lock.json` 记录。
- `AGENTS.md` 精简通用 Task 流程，保留并行文件范围和运维约束；补入产品重要边界、隔离模拟联调、Docker 更新演练及浏览器验收方法。
- 移除 `docs/requirements.md`、`docs/implementation-contract.md` 和 `docs/testing.md`，完整内容转入[历史快照](TASK-20260926-project-documentation-snapshot.md)。只调整原文标题层级和移动后的相对链接。
- 更新 README、文档导航和模板；原发布任务指向旧验证文档的链接改指历史快照，其余旧事实不改。`INDEX.md` 保持不变。

## 验证事实与边界

- 文档调整基于 `9d688f6` 的工作区；本次只涉及 Skill 和文档，没有改变应用代码。
- 2026-09-26：GitHub 来源安装成功，六个 Skill 文件与 AgentNotes `446322a` 的源码逐字节一致，锁文件来源正确；源 Skill 通过结构验证。
- 2026-09-26：将快照与原提交中的三份文档比对，除标题层级和移动后链接外，48、58、133 行原文完整保留。独立只读复核同样确认无内容丢失或归档日期冒充验证日期。
- 2026-09-26：变更及新增 Markdown 本地链接和行尾空白检查、`git diff --check` 通过。迁入的联调示例与已有脚本参数核对；本次未重新运行应用、模型或容器测试。
- 2026-09-26：已有无关 `apps/web/next-env.d.ts` 修改的 SHA-256 与开始时一致，未纳入本次变更。

## 未覆盖范围与后续建议

隐式 Skill 选择取决于 Agent 对请求和摘要的匹配，安装和文件一致性检查不能证明每次任务必然触发。本次不以文档调整代替应用测试、真实 X/Chrome 扩展、iPhone/PWA 或付费模型验收。
