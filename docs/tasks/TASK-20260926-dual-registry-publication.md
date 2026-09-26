# TASK-20260926-dual-registry-publication：双仓独立发布

- 记录日期：2026-09-26
- 模块与关键词：Actions、ACR、GHCR、不可变镜像
- 维护归属：feat/dual-registry 发布实施会话

## 背景与目标

同一可信版本构建和验证一次，独立发布两个仓库。保留版本 PR 路由与扩展独立发布。

## 验收标准

- [x] 单路失败不取消另一条，最终汇总失败并显示渠道结果。
- [x] 可信上一版按固定摘要获取，不能因仓库缺失跳过升级测试。
- [x] 补传不重建，不覆盖不同内容，不降级 stable。
- [x] 发布工具测试和 Actionlint 通过。

## 讨论结论

范围为发布脚本、工作流、测试和发布文档；部署更新器由独立会话维护。采用 OCI archive 和 skopeo preserve-digests，保留现有 GitHub Release 资产格式。历史转存默认不移动 stable。

## 实现结果

2026-09-26：新增 `registry-publication.py` 的 prepare / publish / summarize / transfer。构建产物为 `build/release/candidate/image.tar` 与 `candidate.json`；双仓各自成功后产生 `build/release/results/<channel>.json`。汇总生成兼容旧版的四份 Release 资产，OCI archive 不上传到 GitHub Release。

工作流用可信 workflow SHA 的发布工具处理固定 release commit 的业务源码，支持历史版本 PR 重试。正式 Release 已存在时复用可信摘要；Release 尚未公开时从已发布 version/sha 标签恢复候选，禁止重新构建覆盖。转存默认不动 stable，显式推进只允许最新正式版本。

## 验证事实与边界

本地运行 `pnpm test:tooling`：15 项 JavaScript 通过；Python 共运行 63 项，59 项通过、4 项 Docker 集成测试按环境跳过（包含同工作区部署会话新增用例）；新增 11 项发布测试覆盖部分失败、两仓失败、可信摘要回退、旧版缺失、标签冲突、版本倒退、补传不动 stable、重试复用及资产矛盾。Actionlint 1.7.7、Python 编译与 `git diff --check` 通过。

未在本机执行真实镜像上传和 Linux Docker 升级演练；实际 Actions 与 Registry 验收由主实施会话完成。此记录不声明生产已使用双仓。

## 审查修复：永久候选收据

2026-09-26：审查发现一仓未知、另一仓缺失时仅检查标签不足以识别先前部分发布。候选 artifact 上传之后、任何 publish job 开始前，新增 `sayseed/registry-candidate` commit status 收据，持久记录版本、摘要和 artifact 地址。写收据失败即禁止发布；后续整轮重试必须恢复收据指向的原 OCI，校验 artifact 所属仓库、工作流、成功的版本 PR source job 及内容摘要。产物过期或不可读取时中止，不允许重建。无既有收据的首次发布仍允许 ACR 网络故障、GHCR 可用。

新增五项回归测试覆盖收据恢复、过期拒绝重建、读取错误不能视作首次及 prepare 不访问未知仓库重新构建。发布测试共 16 项通过，Actionlint 与差异检查通过。

收据恢复分页读取全部运行 attempts 的 source 结果，支持只重跑失败 job。渠道结果和扩展产物成功上传时允许覆盖同名 artifact，避免整次重跑冲突；主候选保留独立 attempt 名称，不覆盖收据引用。最终工具验证：15 项 JavaScript 通过；Python 70 项运行、66 项通过、4 项在本机按环境跳过；两个更新器另在 Linux 临时目录完成 51 项测试，全部通过。
