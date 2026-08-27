# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的结构，并使用语义化版本号。

## [Unreleased]

## [0.7.0] - 2026-08-27

### Added

- macOS 登录支持系统自带 Safari，通过 `safaridriver` 创建隔离会话并安全回收登录 Cookie。

### Changed

- Safari 短信登录触发滑块时结束不可交互的自动化会话，并明确提示改用扫码或 Chromium 浏览器。
- 二维码按原始像素显示并扩大白色静区；Safari 同时显示官方二维码窗口作为扫描回退。

## [0.6.0] - 2026-08-25

### Fixed

- 修复 macOS 无法发现 `~/Applications` 中的浏览器，以及配置 `.app` 路径后无法登录的问题。

### Added

- GitHub 发布准备、隐私与安全文档、CI 和发布前检查。

### Changed

- 项目许可证统一为 `AGPL-3.0-only`。

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
