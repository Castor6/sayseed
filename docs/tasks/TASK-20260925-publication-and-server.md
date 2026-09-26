# TASK-20260925-publication-and-server：公开仓库与服务器配置

- 记录日期：2026-09-25
- 模块与关键词：GitHub、MIT、敏感配置、CI、部署、登录密码、HTTPS
- 维护归属：本次公开仓库与服务器配置会话
- 代码基线：`e2a6177`
- 关联任务：[CI 与版本发布实施](TASK-20260925-ci-release-implementation.md)

## 背景与目标

用户确认将 Sayseed 以 MIT 许可证公开到 GitHub，要求检查敏感配置，并协助配置服务器登录密码。线上采用现有服务器 IP 的独立 HTTPS 端口，沿用现有证书；登录密码沿用本机环境文件中的 `SAYSEED_PASSWORD`。

## 验收标准

- [x] 检查当前源码与全部 Git 历史，排除真实密码、密钥、数据库和私有运维内容。
- [x] 添加 MIT 许可证，创建公开仓库，实际运行 CI 并处理失败。
- [x] 服务器以私有配置接收既有登录密码，文件权限受限，不进入 GitHub 或对话输出。
- [x] 独立 HTTPS 入口可以访问，登录与数据持久化通过验证，现有应用正常。
- [x] 公共 Task 与私有运维记录分别记录实际结果及未完成项。

## 讨论结论

密码属于实例运行配置，与公开源码和镜像发布凭据分开。源码保留空值示例；服务器通过私有 `.env` 向 Compose 注入 `SAYSEED_PASSWORD`。仅提取用户指定的密码项，不上传完整本地环境文件、模型密钥或数据库。

主会话负责仓库设置和服务器工作；独立检查会话只读审查敏感内容。实际主机、端口配置和凭据位置写入私有运维目录，不在公开仓库记录。

## 实现结果

添加 MIT 许可证，并将本地运维入口加入 Git 忽略规则。源码和初始 Git 历史扫描未发现可用密码、API Key、私钥、真实部署地址或个人数据；环境示例为空值，测试凭据为虚构数据。

检查发现 Next.js standalone 可能包含本地数据库和环境文件的副本。增加文件追踪排除规则，并在正式 Web 构建命令末尾清理敏感产物；后者同时覆盖 Next.js 直接复制的环境文件。清理不跟随符号链接，不修改源数据。

通过 SSH 标准输入传递用户指定的登录密码，服务器私有配置和本机凭据备份权限均为 0600，所在专用目录为 0700。使用服务器实际 Docker Compose 解析配置，并与本地密码逐字比较一致；未输出密码。

已创建公开仓库 [Castor6/sayseed](https://github.com/Castor6/sayseed)，允许 Actions 创建版本 PR，工作流默认只读。主分支规则要求经 PR、严格通过 `validate` 并解决讨论，只允许 squash，禁止删除和强推，不配置绕过者。

增加默认 GHCR 镜像发布，使用运行期令牌；保留显式 ACR 配置。首次 GHCR 包可见性需另行设置，服务器应按公开 Release 摘要拉取。GitHub 默认机器人创建的版本 PR 仍可能要求工作流审批，显式 dispatch 的测试结果不能代替该审批；已根据实际行为更正文档。

用户最终选择 ACR，与参考项目一致。本次在 ACR 创建独立私有仓库，并配置 GitHub 的 ACR Variables 与 Secrets；服务器复用既有 Registry 登录，新增仅限目标仓库拉取的独立策略。发布密码由用户输入，不从其他仓库的 Secrets 提取，不保存到服务器。

首个 Web 与扩展版本均为 `0.1.1`，发布提交 `3ceda1737171fd2f247f21ffebb05a54d7b29d18`。服务器使用 Release 中的固定镜像摘要，独立 Compose 项目与数据卷，由 Nginx 提供 HTTPS 和流式代理。采用独立 HTTPS 端口以保持页面、API、静态资源及 PWA 的根路径；具体入口、证书引用和云安全组规则存入私有运维目录。

## 验证事实与边界

2026-09-25：在干净临时副本放置虚构环境值、数据库和密钥，生产构建后 standalone 全字节扫描零命中，源夹具保留完整；清理后的生产实例通过 86 项 HTTP 检查。工具测试通过 15 项 Node 和 19 项 Python 用例，包含清理路径与符号链接边界。正式构建须运行包内 `build` 命令，直接调用 `next build` 会绕过末尾清理。

服务器原应用与 HTTPS 代理现场检查正常。已完成云安全组放行、实际部署、原密码登录和重启持久化验证。

公开提交 `e6465d2` 的[首次 CI](https://github.com/Castor6/sayseed/actions/runs/36109789490)全部通过，包括 Linux 镜像新装、重启持久化与生产 HTTP 联调。随后自动生成[版本 PR #1](https://github.com/Castor6/sayseed/pull/1)；其显式 dispatch CI 与批准后的正式 PR CI 均通过。GHCR 配置分支本地验证通过 15 项 Node、23 项 Python 工具测试和 Actionlint。

[发布配置 PR #2](https://github.com/Castor6/sayseed/pull/2) 经 CI 后合并，版本 PR 自动更新。最终版本的[正式 PR CI](https://github.com/Castor6/sayseed/actions/runs/36110694788)、[主分支 CI](https://github.com/Castor6/sayseed/actions/runs/36111262027)和[自动发布](https://github.com/Castor6/sayseed/actions/runs/36111262587)全部通过。Web [v0.1.1](https://github.com/Castor6/sayseed/releases/tag/v0.1.1)及扩展 [extension-v0.1.1](https://github.com/Castor6/sayseed/releases/tag/extension-v0.1.1)已公开，附件经上传下载校验。

服务器拉取后核对镜像版本、提交、OCI 来源及 amd64 架构，验证与 Release 相符。公网页面及健康检查成功，既有 CA 校验证书通过；匿名读取及错误密码返回 401，原密码登录成功，Cookie 包含 Secure、HttpOnly、SameSite=Strict。创建一条临时笔记后重启容器，原会话、笔记及加密密钥保留；临时笔记已删除。SQLite 完整性检查通过。原应用容器 ID、镜像、启动时间和证书哈希保持不变。

停机保存首次实例完整数据与配置备份，随后恢复服务；备份包含 SQLite、实例密钥、Compose、私有环境配置及 Nginx 站点。本机副本与服务器备份的 SHA256 一致，未执行完整恢复演练。私有使用说明与当日运维记录已更新。

## 未覆盖范围与后续建议

本次完成自动版本 PR、镜像及 Release 发布和首次手动部署；尚未安装 Sayseed 服务器定时更新器或配置自动异地备份。本机笔记、模型配置和数据库未迁入新实例。未验收 iPhone 真机、实际扩展连接或真实模型效果；不由 CI 或登录成功推定完成。

## 2026-09-26：版本 PR 自动运行检查

维护归属：版本 PR 授权配置会话，文档分支 `docs/version-pr-authorization`。用户要求版本 PR 像参考项目一样自动运行 CI，省去每次批准工作流的操作。

比较确认，参考项目已配置专用 `CHANGESETS_TOKEN`，Sayseed 原先使用默认 `GITHUB_TOKEN`，导致机器人创建或更新 PR 时的正式 CI 等待批准。既有版本工作流已支持优先使用 `CHANGESETS_TOKEN`，本次补齐仓库配置，无需修改工作流代码或放宽 `validate` 合并门禁。

创建仅授权本仓库的细粒度个人访问令牌，权限为 Contents 与 Pull requests 读写，以及必需的 Metadata 只读，保存为仓库 Actions secret `CHANGESETS_TOKEN`。初始设置为 90 天；用户明确要求与参考项目一致、不设到期日后，已重新生成无到期日的令牌，并更新同名 secret，仓库范围和权限保持不变。GitHub 页面确认无到期日及 secret 更新成功。凭据只在 GitHub 配置流程中传递，未写入源码、任务文档或命令输出。

2026-09-26：GitHub 页面确认 secret 保存成功，API 元数据确认创建时间为当天 08:14:33 UTC。添加 secret 不会直接批准已经等待中的旧 CI；后续正式 PR 检查需由使用新令牌的版本 PR 创建或更新事件触发。

为验证配置，手动运行一次[版本整理工作流](https://github.com/Castor6/sayseed/actions/runs/36229213732)，结果成功；默认令牌路径的额外 dispatch 步骤被跳过。工作流将[版本 PR #9](https://github.com/Castor6/sayseed/pull/9)更新为 `77e1bd3d6c7846c09cde8e602b4c530b363c4100`，随后[正式 PR CI](https://github.com/Castor6/sayseed/actions/runs/36229244962)自动运行，未要求批准，`checks`、`container` 和 `validate` 均通过。此证据确认令牌配置及自动触发生效；不由检查通过推定 PR 已合并或新版本已发布。此次仅修改仓库授权配置和任务记录，未修改产品代码。

令牌改为无到期日并更新 secret 后，[再次运行版本整理工作流](https://github.com/Castor6/sayseed/actions/runs/36229591113)成功，确认替换后的凭据可用。
