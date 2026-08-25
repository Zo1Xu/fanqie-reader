# fanqieReader

一个非官方的 VS Code 番茄小说阅读扩展：在侧边栏浏览书架，在底部 Panel 中以终端风格阅读章节。

> 本项目与北京时光荏苒科技有限公司、番茄小说及其关联公司无隶属、授权或背书关系。“番茄小说”等名称和标识归其权利人所有。

## 主要功能

- 支持书籍 ID、详情页链接和章节链接。
- 支持番茄官网扫码、短信验证码及官方窗口登录。
- 在底部 `fanqieReader` Panel 阅读，不占用编辑器标签页。
- 终端风格正文、固定状态区、章节目录和上下章快捷键。
- Cookie 使用 VS Code `SecretStorage` 保存；手机号、验证码和密码不写入项目文件。
- 不绕过付费、锁定章节或账号权限。

扩展的完整使用说明见 [vscode-fanqie-reader/README.md](vscode-fanqie-reader/README.md)。

## 仓库结构

```text
fanqieReader/
├─ vscode-fanqie-reader/   # VS Code 扩展源码、测试和打包配置
├─ fanqie-api-capture/     # 本地接口研究工具
└─ PUBLISHING.md           # GitHub 与 Marketplace 发布手册
```

`fanqie-api-capture/output/` 中的 HAR、请求记录和响应样本可能包含有效 Cookie、Session、CSRF Token、用户 ID 与阅读数据，因此已被根目录 `.gitignore` 排除，绝不能提交到公开仓库。公开源码不依赖这些本地输出文件运行。

## 本地开发

```powershell
cd vscode-fanqie-reader
npm ci
npm run verify
```

在 VS Code 中打开 `vscode-fanqie-reader`，按 `F5` 启动 Extension Development Host。

生成本地安装包：

```powershell
npm run package
```

## 发布

本仓库已经包含：

- GitHub Actions 持续集成与标签发布工作流；
- GitHub Issue / Pull Request 模板；
- 发布前元数据检查脚本；
- AGPL-3.0-only 许可证、隐私说明、安全策略、贡献指南和变更记录；
- GitHub Release 与 VS Code Marketplace 的逐步发布说明。

请先阅读 [PUBLISHING.md](PUBLISHING.md)，替换仓库所有者和 Marketplace Publisher ID 后再首次发布。

## 隐私与安全

- [隐私说明](PRIVACY.md)
- [安全策略](SECURITY.md)
- [贡献指南](CONTRIBUTING.md)

请不要在 Issue、日志或截图中提交 Cookie、手机号、验证码、Token、完整 HAR 或个人书架内容。

## 许可证

源码按 [GNU Affero General Public License v3.0 only](LICENSE) 发布。分发修改版本时必须遵守 AGPL-3.0 的源码提供与同许可证要求；如果修改版本支持用户通过计算机网络远程交互，还需遵守第 13 条的对应源码提供义务。小说正文、番茄小说网站内容、商标和第三方资源不属于本许可证授权范围。
