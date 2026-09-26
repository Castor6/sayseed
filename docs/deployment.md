# 服务器自动更新

更新器参考 Memos 的拉取式部署流程，由服务器主动检查已经通过发布验证的镜像 `stable` 标签。GitHub 不需要服务器 SSH 私钥；私有 Registry 只需给服务器目标仓库的拉取权限。

## 更新过程

[`sayseed-update.timer`](../scripts/deploy/sayseed-update.timer) 在开机约两分钟后开始检查，之后每次检查结束约五分钟再次运行，并增加少量随机延迟。没有新版本时保留当前容器，不重启应用。

1. 下载候选镜像，校验 OCI 来源、版本、提交、Linux amd64 架构和不可变摘要；拒绝降级或同版本替换。
2. 创建维护标记，确认公网返回带标识的 503，然后停止 Sayseed。已开始的请求随正常停止收尾。
3. 备份完整应用配置及具名数据卷，包含 SQLite、WAL 和 `.secret`，核验归档与 SHA256。
4. 使用摘要固定候选镜像并启动，核对容器身份、HTTP 健康、登录页面、匿名访问保护、数据库完整性及既有记录和密钥保留。
5. 成功后解除维护并记录部署结果；失败时保存候选实例的数据，恢复备份与原镜像。恢复失败则保持维护标记及中断记录，等待维护者处理。

旧实例的数据库和密钥必须配套恢复。不能仅把镜像降回旧版，也不能将新空数据卷当成原实例。Docker 具名卷独立于容器生命周期，删除容器不会迁移或删除其数据，参见 [Docker 官方卷说明](https://docs.docker.com/engine/storage/volumes/)。

## 安装

此更新器管理已经部署的单实例，要求 Linux、Python 3、Docker Compose v2、Nginx 和可用的只读 Registry 登录。首次部署仍按[发布说明](release.md#生产部署入口)完成。主机需要足够磁盘保存备份和失败实例。

将 [`config.example.json`](../scripts/deploy/config.example.json) 复制为私有 `/etc/sayseed-update/config.json`，按真实部署填写镜像仓库、具名卷、内部健康入口、公网 HTTPS 入口及已有 CA 文件路径。配置不包含网页登录密码；密码继续由应用私有 `.env` 保存。确认应用目录、状态目录及备份目录独立，具名卷与当前容器 `/app/data` 的挂载一致。

```sh
sudo install -d -m 0700 /etc/sayseed-update /opt/backups/sayseed-update
sudo install -d -m 0755 /usr/local/lib/sayseed-update /var/lib/sayseed-update
sudo install -m 0755 scripts/deploy/sayseed-update.py /usr/local/lib/sayseed-update/sayseed-update.py
sudo install -m 0644 scripts/deploy/LICENSE-MEMOS /usr/local/lib/sayseed-update/LICENSE-MEMOS
sudo install -m 0644 scripts/deploy/sayseed-update.service scripts/deploy/sayseed-update.timer /etc/systemd/system/
```

配置文件权限设为 0600。状态目录需允许 Nginx 检查维护标记；其他状态文件保持私有。先备份现有配置，将 [`maintenance.nginx.conf`](../scripts/deploy/maintenance.nginx.conf) 中的规则加入 Sayseed 自己的 HTTPS server，按配置对齐标记路径；运行 `nginx -t` 通过后再 reload。不要把该规则加入其他应用的 server。

先执行 `--dry-run`，再手动启动一次 service，检查结果和公网访问，最后启用 timer：

```sh
sudo python3 /usr/local/lib/sayseed-update/sayseed-update.py --dry-run
sudo systemctl daemon-reload
sudo systemctl start sayseed-update.service
sudo systemctl enable --now sayseed-update.timer
sudo systemctl list-timers sayseed-update.timer
```

`--dry-run` 会下载并校验候选镜像，可能占用镜像磁盘空间，但不停止应用或部署候选版本。安装配置、维护入口、升级和回滚应先在隔离实例验证。公开模板不代表任何具体服务器已经启用，实际安装事实保存在对应 Task 和私有运维记录。

## 日常操作与恢复

```sh
sudo systemctl status sayseed-update.timer
sudo journalctl -u sayseed-update.service --since today
sudo cat /var/lib/sayseed-update/deployed.json
sudo python3 /usr/local/lib/sayseed-update/sayseed-update.py --cleanup-dry-run
```

`deployed.json` 记录当前镜像、版本和提交。日志、配置及备份只留私有环境，不整体上传公开仓库。更新器使用应用目录内的 `deployment-image.json` 覆盖镜像；手动维护时也必须带上这个文件，避免启动 `.env` 中旧的初始镜像：

```sh
cd /opt/sayseed
docker compose -f compose.production.yaml -f deployment-image.json ps
```

暂停自动更新使用 `systemctl stop sayseed-update.timer`；持久停用使用 `systemctl disable --now sayseed-update.timer`。这不会中断已经运行的 service，应先查看其状态，避免在更新事务中直接杀进程。

升级失败但回滚成功后，原版本继续服务，该失败摘要不会反复自动重试。先查日志并修复原因，再使用 `--retry` 明确重试。存在 `pending.json` 或维护标记时普通更新会拒绝继续，维护者应检查备份和中断阶段，再运行 `--recover` 恢复事务；不要直接删除标记、跳过校验或覆盖数据。

## 保留与验证边界

仅成功更新后执行清理。保留最近 3 次或最近 30 天的备份，任一条件满足就保留；当前恢复点、失败或未完成升级、异常元数据继续受保护。镜像清理仅处理本更新器备份关联、来源及仓库摘要均匹配的 Sayseed 镜像，同时保护所有容器引用的镜像，不执行全局 Docker prune。丢失仓库摘要、无法确认归属的旧镜像会保守保留。

备份保存在本机服务器，仍需单独规划异地备份。自动检查不调用真实模型，也不能替代浏览器、iPhone 或扩展功能验收。更新器自身为宿主机程序，修改后需要经过验证再安装，不随应用镜像自动替换。
