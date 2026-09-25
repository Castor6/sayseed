# 版本说明

功能或修复准备交付时，从根目录运行 `pnpm changeset`，选择实际变化的包，并填写中文用户说明：

- `@sayseed/web`：网页、PWA、服务端与镜像。
- `@sayseed/extension`：Chrome 扩展。
- `@sayseed/shared`：共享接口与校验；依赖它的两端按版本规则联动。

纯文档或不影响交付行为的修改可以不添加 changeset。只提交新的 changeset，不手动改包版本或 CHANGELOG；这些文件由版本 PR 生成。

普通 PR 合并后先运行 CI，成功后更新同一个 `Version Packages` PR。合并版本 PR 才发布对应组件。详细设置与首次启用见 [CI 与版本发布](../docs/release.md)。
