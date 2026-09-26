# CI 与版本发布

## CI 复用项目测试

工作流位于 [.github/workflows/ci.yml](../.github/workflows/ci.yml)，在 PR、`main` 推送和手动触发时运行。Node 版本由 [`.node-version`](../.node-version)固定，pnpm 版本由根 `package.json` 固定，安装使用 `pnpm install --frozen-lockfile`。

- `checks`：校验版本规则，执行 `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm test:ci`，并打包扩展候选产物。
- `container`：在 Linux 构建 Docker 镜像，验证新装、登录、数据与加密密钥的重启持久化，以及现有 HTTP 联调。
- `validate`：汇总前两项，任何失败、取消或跳过均不能通过。主分支规则应把它设置为必需检查。

`pnpm test` 包含应用测试和发布工具测试；新增业务用例继续放在原测试集合中。`pnpm test:ci` 复制生产 standalone 产物到临时目录，自动启动本地模拟模型服务及隔离实例，结束后清理进程和数据，不使用真实模型密钥。运行前先 `pnpm build`。

本地 Docker 验证需要 Linux host 网络：

```bash
docker build -t sayseed:ci .
node scripts/docker-smoke.mjs --image sayseed:ci
```

可以通过 `--previous-image <完整镜像摘要>` 在一次性新卷中先启动上一版、写入夹具数据，再升级候选版本。脚本不接收生产数据卷参数。该模式用于升级检查；发布流程另外执行候选版本的空卷新装检查。

## 从功能 PR 到版本 PR

1. 每次实质迭代创建或续接 Task，记录目标、决定与实际验证。
2. 交付行为变化运行 `pnpm changeset`，选择变化的包并填写中文说明。纯文档可以省略。
3. 普通 PR 合并后只运行 CI。当前 `main` 的 CI 成功后，[版本工作流](../.github/workflows/version-packages.yml)创建或更新 `changeset-release/main` 上的 `Version Packages` PR。
4. 审阅更新说明和版本，待 `validate` 通过后合并版本 PR，才会触发[发布工作流](../.github/workflows/release.yml)。

普通 PR 不能手改包版本、CHANGELOG 或已有 changeset；版本 PR 必须与基线执行 Changesets 后生成的完整文件树一致，不能夹带功能代码。应用和扩展各自维护版本与日志：

| 包 | 制品 | 标签 |
| --- | --- | --- |
| `@sayseed/web` | Linux amd64 容器镜像、版本元数据与摘要 | GitHub `vX.Y.Z`；镜像 `vX.Y.Z`、`sha-完整提交`、`stable` |
| `@sayseed/extension` | Chrome MV3 ZIP、版本说明与校验文件 | GitHub `extension-vX.Y.Z` |
| `@sayseed/shared` | 内部源码，不发布 npm 包 | 变化按 Changesets 规则传播到依赖的两端 |

只改扩展不会发布服务端镜像。共享接口变动仍须考虑旧扩展与新服务的兼容性，两种制品不会同时安装到所有设备。ZIP 供解压加载，不能让开发者模式扩展自动更新。

两端 `0.1.0` 是尚未发布的本地开发基线；初始 changeset 将生成 `0.1.1` 的首个版本 PR。实际版本以生成的版本 PR 为准。

## GitHub 仓库设置

源码中的发布工作流只为 `Castor6/sayseed` 启用；复制到其他仓库时先调整仓库身份条件。

- 启用 Actions，允许 GitHub Actions 创建 PR；工作流默认只读，仅版本 PR job、镜像发布 job 和 GitHub Release job 获得对应写权限。
- `main` 要求经 PR 合并、严格通过 `validate`、解决讨论；只允许 squash 合并，禁止删除主分支和强推。
- 建议使用默认 `GITHUB_TOKEN` 创建版本 PR；工作流会显式 dispatch CI，先提供版本分支的自动测试结果；这不能替代 PR 工作流审批。若机器人 PR 的工作流要求批准，维护者仍需在 Actions 页面批准，或使用具有相应权限的身份调用 `POST /repos/{owner}/{repo}/actions/runs/{run_id}/approve`，待正式 PR 的 `validate` 通过后再合并。也支持可选的仓库级 `CHANGESETS_TOKEN`，权限限制为本仓库的内容和 PR 读写，以避免默认机器人令牌产生的这一审批提示。
- 普通功能 PR 不拥有 ACR 凭据。发布 job 只接受同仓已合并的版本 PR，并重新核验其生成内容。

GitHub 对 `GITHUB_TOKEN` 触发后续工作流的规则见[官方说明](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)。版本 PR 只在当前主分支 CI 成功后自动推进，过期 CI 结果不用于生成新版本。

## 镜像仓库与发布顺序

每次服务端版本发布同时上传 ACR 和 `ghcr.io/castor6/sayseed`。构建、空卷新装和上一正式版升级测试仅运行一次；候选镜像导出为 OCI archive，两个独立 matrix job 使用 `skopeo --preserve-digests` 上传同一摘要。`fail-fast: false` 保证某一路失败不取消另一条；任何一路失败都会使整次 Actions 标红，Release 汇总显示各渠道结果，成功通道独立更新 `stable`。

GHCR 使用本次运行的 `GITHUB_TOKEN`（`packages: write`），不需要长期 Registry 密码或服务器 SSH 私钥。新包默认私有；首次推送后需在包设置中设为 Public 并验证匿名拉取，脚本不会自动改变可见性。OCI 来源标签保留实际 GitHub 仓库身份。

ACR 继续使用以下配置；发布目标固定为两仓，缺失配置会明确失败，不静默改为单仓：

| 类型 | 名称 | 内容 |
| --- | --- | --- |
| Variable | `ACR_REGISTRY` | Registry 主机名，不含协议 |
| Variable | `ACR_IMAGE` | 完整 Registry/命名空间/仓库，不带 tag |
| Secret | `ACR_USERNAME` | 有权限推送该仓库的 Registry 用户 |
| Secret | `ACR_PASSWORD` | 对应 Registry 密码 |
| Secret，可选 | `CHANGESETS_TOKEN` | 本仓库范围的版本 PR token |

上一版由版本 PR 父提交的 Web 包版本确定，再读取对应正式 GitHub Release 的元数据与校验和，并校验标签提交。优先从 GHCR、其次 ACR 获取同一固定摘要，核对版本、来源、提交和 linux/amd64 平台。网络、鉴权或镜像缺失均不能绕过升级测试。仅已确认没有任何正式 Web Release 的初始 `0.1.0 → 0.1.1` 开发基线可执行首版发布。

每个通道先检查不可变版本/提交标签，再推进 `stable`；不同内容不得覆盖相同版本，`stable` 不得降级。单次网络命令超时五分钟，复制最多三次、间隔五秒；每路发布步骤总上限十五分钟。整个发布与转存流程共用并发锁。

Release 至少有一个已验证成功的渠道才会公开；元数据保留兼容的单一 `image` 完整摘要字段。已有正式 Release 不因备用仓库修复而改写附件。另一通道失败不影响成功仓库供服务器拉取，但本次 Actions 仍失败以提醒补齐。

历史版本或失败渠道使用 `Transfer Released Image`：填写正式版本号（不带 v）和目标仓库。它按可信 Release 摘要复制镜像，不重新构建、不覆盖不一致标签，默认不改变 `stable`；显式勾选 `advance_stable` 时，只允许当前最新正式版本推进，并再次校验目标 stable 不降级。若原仓库和另一份副本都不可访问则失败，不能凭标签重建同一版本。常规发布失败可重跑失败的 matrix job，继续使用保留三十天的候选 artifact。候选上传后先写入精确提交的永久 commit status 收据，再允许任何仓库发布；整轮重试优先按收据恢复并校验原产物。已记录产物过期或无法取回时拒绝重建，避免某仓不可访问时制造同版本不同摘要；只有没有既有收据或正式版本的首次构建才允许某一路仓库不可访问。

GitHub Release 在独立 job 中获得写权限：先固定标签的提交，再创建草稿、上传附件、逐个下载校验，最后公开。已有附件内容不同会失败，不静默覆盖。扩展 ZIP 的文件排序和时间戳固定，并检查 manifest 版本及不应交付的内容。

若仅 GitHub Release 上传失败，优先重跑失败的 Release job。手动运行 `Publish Release` 可以输入已合并版本 PR 编号重试整条流程，但若 `stable` 已升级到更高版本，旧版本的镜像步骤会主动拒绝降级。镜像发布成功和 GitHub Release 公开是两件独立事实。

## 生产部署入口

[compose.production.yaml](../compose.production.yaml)单独使用，不与本地构建 Compose 叠加。把模板复制到服务器的独立部署目录，配置私有 `.env`：

```dotenv
SAYSEED_IMAGE=ghcr.io/castor6/sayseed@sha256:REPLACE_WITH_RELEASE_DIGEST
SAYSEED_PASSWORD=REPLACE_WITH_A_STRONG_PASSWORD
SAYSEED_PUBLIC_URL=https://sayseed.example.com
SAYSEED_PORT=3000
SAYSEED_VOLUME=sayseed-data
```

镜像值取 Release 的 `image-digest.txt`。固定数据卷名，迁移现有实例时将 `SAYSEED_VOLUME` 设为原卷的准确名称，不能把新空卷当作已迁移的数据。为避免覆盖已有数据或部署错误版本，先确认首次部署、升级及完整备份方案，再执行 pull/up。

```bash
docker compose -f compose.production.yaml pull
docker compose -f compose.production.yaml up -d
```

容器只监听主机 loopback，由 HTTPS 反向代理提供外部访问，并关闭流式响应缓冲。完整备份必须保存数据卷中的 SQLite、WAL 和 `.secret`，以及私有部署配置；回滚恢复匹配的数据和镜像。

需要自动跟随已验证版本时，安装[服务器自动更新器](deployment.md)。它在服务器定时拉取 `stable`，校验后停机备份，并固定摘要启动；失败时恢复配套数据和旧镜像。扩展 ZIP 的发布不触发服务器更新。

此文档描述配置接口，不表示生产已部署。具体服务器的安装与验收以部署任务和私有运维记录为准。源码中的健康检查仍是基础 HTTP 存活检查，更新器会另行核对容器身份、数据库和密钥；真实 HTTPS/iPhone/扩展联调仍需实际验收。
