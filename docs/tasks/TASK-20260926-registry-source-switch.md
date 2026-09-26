# TASK-20260926-registry-source-switch：Sayseed 受控切换镜像来源

- 记录日期：2026-09-26
- 模块与关键词：部署更新器、ACR、GHCR、镜像来源、恢复
- 维护归属：sayseed-dual-registry 工作分支的更新器实施会话
- 关联任务：`TASK-20260925-server-auto-update.md`

## 背景与目标

现有更新器仅从一个仓库的 `stable` 拉取。用户需要通过服务器控制入口手动选 ACR 或 GHCR，同时保留原有备份、健康检查与恢复逻辑。

## 验收标准

- [x] 切源前验证目标 `stable`；网络错误、降级、同版本不同内容、已失败版本和未完成事务不修改来源。
- [x] 同内容跨仓切换不停止应用、不备份数据；更高版本由定时器执行升级。
- [x] 修改配置前生成私有备份并原子写入；状态命令不拉取镜像。
- [x] 旧运行镜像跨仓可识别，镜像清理兼容曾用仓库且保护归属不明镜像。

## 实现结果

更新器支持 `image_repositories`、`retained_image_repositories`，新增 `--switch-channel acr|ghcr`、`--status`。使用实际容器镜像 ID、版本和提交确认相同内容，避免跨仓摘要字符串不同引发同版本替换或重复部署。配置备份写入状态目录，已部署记录与原恢复身份保持原样。公开模板和部署说明已更新。

## 验证事实与边界

2026-09-26 在独立 worktree 运行 `python3 -m unittest scripts/test_sayseed_update.py`，共 31 项，27 项通过、4 项因本机缺少 Linux 工具跳过；包含同内容不重启、网络失败、降级、失败版本、pending、锁占用、配置写入失败、旧仓运行身份识别、双仓清理边界和状态只读检查。`git diff --check` 通过。本轮未在生产实例执行真实切源，实际部署须另行验证。

同日将更新器及对应测试复制到服务器 `/var/tmp` 的独立临时目录，在该目录运行 `python3 -m unittest -v test_memos_update test_sayseed_update`：两项目共 51 项全部通过，Sayseed 31 项无跳过。测试脚本经审查不会调用生产 Docker 或路径，临时目录在测试后删除；未修改生产配置、镜像或应用。

## 未覆盖范围与后续建议

云助手命令预设、GHCR 当前 `stable` 就绪状态及生产切源演练由私有运维流程确认。单元测试不能代替实际 Registry 与 Docker 行为。
