# 开发与迭代文档

## 按需导航

| 需要了解什么 | 入口 |
| --- | --- |
| 功能、安装和自托管 | [项目说明](../README.md) |
| 项目约束、本地检查、隔离联调和人工验收 | [AGENTS.md](../AGENTS.md) |
| 当前接口、数据校验与行为 | [共享类型](../packages/shared/src/index.ts)、[API 路由](../apps/web/src/app/api)、[服务端实现与测试](../apps/web/src/server)、[扩展实现与测试](../apps/extension/src) |
| CI、版本 PR、镜像和扩展发布 | [CI 与版本发布](release.md) |
| 服务器定时更新、完整备份和失败恢复 | [服务器自动更新](deployment.md) |
| 记录需求、设计理由或工作结果 | [AgentNotes](../.agents/skills/agentnotes/SKILL.md)、[Task 模板](tasks/TEMPLATE.md) |
| 查找历史决定和验证事实 | [任务检索](tasks/INDEX.md) |

## Task 记录与历史资料

项目级安装的 AgentNotes 提供通用记录与回顾方法，继续使用现有 `docs/tasks/`、中文模板和固定检索说明。精炼的项目约束与验证方法放入 `AGENTS.md` 或模块规则；后续需求讨论、设计原因与实际验证进入对应 Task。

原 `requirements.md`、`implementation-contract.md` 和 `testing.md` 已停止作为长期文档维护，内容保存在[历史快照](tasks/TASK-20260926-project-documentation-snapshot.md)，仅供按需回顾。归档原因和本次验证见[接入任务](tasks/TASK-20260926-agentnotes-adoption.md)。快照中的测试数字和未覆盖范围属于原记录，不能证明当前代码的状态。

真实部署地址、凭据、数据库、模型调用内容和备份继续留在私有运维资料中。
