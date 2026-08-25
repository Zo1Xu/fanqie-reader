# fanqieReader

一个VS Code 番茄小说阅读插件：在侧边栏浏览书架，在底部 Panel 中以终端风格阅读章节。

## 主要功能

- 支持书籍 ID、详情页链接和章节链接。
- 支持番茄官网扫码、短信验证码及官方窗口登录。
- 在底部 `fanqieReader` Panel 阅读，不占用编辑器标签页。
- 终端风格正文、固定状态区、章节目录和上下章快捷键。
- Cookie 使用 VS Code `SecretStorage` 保存；手机号、验证码和密码不写入项目文件。
- 不绕过付费、锁定章节或账号权限。

扩展的完整使用说明见 [vscode-fanqie-reader/README.md](vscode-fanqie-reader/README.md)。

## 隐私与安全

- [隐私说明](PRIVACY.md)
- [安全策略](SECURITY.md)
- [贡献指南](CONTRIBUTING.md)

请不要在 Issue、日志或截图中提交 Cookie、手机号、验证码、Token、完整 HAR 或个人书架内容。

## 许可证

源码按 [GNU Affero General Public License v3.0 only](LICENSE) 发布。分发修改版本时必须遵守 AGPL-3.0 的源码提供与同许可证要求；如果修改版本支持用户通过计算机网络远程交互，还需遵守第 13 条的对应源码提供义务。小说正文、番茄小说网站内容、商标和第三方资源不属于本许可证授权范围。
