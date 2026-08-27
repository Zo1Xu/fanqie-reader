# Changelog

## [Unreleased]

## [0.7.0] - 2026-08-27

- 新增 macOS Safari 登录支持，使用系统自带 `safaridriver` 创建隔离会话。
- Safari 短信登录触发滑块时保留会话、自动显示 900×800 验证窗口，并等待用户手动完成。

## [0.6.0] - 2026-08-25

- 修复 macOS 无法发现 `~/Applications` 中的浏览器，以及配置 `.app` 路径后无法登录的问题。
- 准备首次 GitHub 与 VS Code Marketplace 公开发布。
- 将扩展许可证统一为 `AGPL-3.0-only`。

## [0.5.4] - 2026-08-25

### Added

- 在 VS Code 底部 Panel 中提供终端风格阅读器。
- 阅读器顶部提示符与三行状态信息在滚动时保持固定。
- 侧边栏扫码、短信验证码和官方窗口登录。
- 个人书架、目录、阅读进度和上下章快捷键。
- 登录状态下始终可见的退出登录入口。

### Security

- 登录 Cookie 使用 VS Code `SecretStorage` 保存。
- 手机号、验证码和密码不写入项目文件。
