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

默认发布到 `ghcr.io/castor6/sayseed`。镜像 job 使用本次运行的 `GITHUB_TOKEN`（`packages: write`）登录 GHCR，无需配置长期 Registry 密码或服务器 SSH 私钥。脚本以小写 `GITHUB_REPOSITORY` 生成镜像路径，OCI 来源标签保留实际 GitHub 仓库身份。

GHCR 新建包默认私有，即使源码仓库公开。首次成功推送后，在 GitHub 的 `sayseed` 包设置中将可见性改为 Public，再验证服务器能够匿名拉取 Release 中的完整摘要。这个设置不会由发布脚本自动完成；完成后服务器无需 Registry 凭据。包通过 OCI `org.opencontainers.image.source` 标签关联源码仓库。参见 [GitHub 容器仓库说明](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)。

如需使用 ACR，创建 Sayseed 专用镜像仓库并同时配置以下两个 Variable；工作流随后使用对应 ACR Secrets。缺少任一 Variable 或凭据都会失败，不会静默切回 GHCR。不要把密码写入源码或 Task。

| 类型 | 名称 | 内容 |
| --- | --- | --- |
| Variable | `ACR_REGISTRY` | Registry 主机名，不含协议 |
| Variable | `ACR_IMAGE` | 完整 Registry/命名空间/仓库，不带 tag |
| Secret | `ACR_USERNAME` | 有权限推送该仓库的 Registry 用户 |
| Secret | `ACR_PASSWORD` | 对应 Registry 密码 |
| Secret，可选 | `CHANGESETS_TOKEN` | 本仓库范围的版本 PR token |

使用私有 ACR 时，服务器另配目标仓库的只读拉取权限。`ACR_REGISTRY` 与 `ACR_IMAGE` 均未配置时始终使用 GHCR；脚本独立调用时同样遵循此规则，GHCR 登录需要 `GITHUB_ACTOR` 与 `GH_TOKEN`。

切换 Registry 不会搬运原仓库中的 `stable`，升级检查以目标仓库已有的上一版为准；迁移已有生产实例前应另行验证从实际部署摘要的升级。

镜像发布先检查版本与 OCI 来源标签，构建或复用同一版本的已有候选，执行新装及从上一版升级验证，再推送不可变版本/提交标签。生成并校验版本元数据与摘要后，最后推进 `stable`。不能将不同内容覆盖到已有版本，也不能把 `stable` 降到更旧版本。整个发布工作流串行执行且不取消正在发布的运行。

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

## 镜像渠道选择

默认发布 GHCR；`IMAGE_CHANNEL=acr` 时发布 ACR，现有 ACR 凭据本身不再隐式选择渠道。平时只发布一个仓库，已发布版本需要转仓时使用 `Transfer Release Image`。详细切换顺序和服务器配置见 [部署说明](deployment.md#发布渠道与按需转仓)。
