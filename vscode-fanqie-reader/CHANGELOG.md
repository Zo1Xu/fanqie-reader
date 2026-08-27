# Changelog

## [Unreleased]

- 书架条目现在会以 3 个并发请求逐步补全书名和作者，并把元数据缓存到 VS Code 本地存储。
- 将“打开书籍或章节”重命名为“通过 ID 或链接打开”，明确该入口是用来打开书架以外的内容。

- 修复扫码登录过早保存不完整会话，以及后续请求硬编码 Windows User-Agent 导致书架为空的问题。
- 书架请求现在保持扫码浏览器的实际 User-Agent，并按官网请求使用 JSON Accept 与书架 Referer。
- 区分底部阅读区与书架刷新的产品图标，避免 Cursor/VS Code 标题栏中出现视觉重复。
- CI 改为在 Linux、Windows 和 macOS 三平台并行执行检查与测试。

## [0.7.0] - 2026-08-27

- 新增 macOS Safari 登录支持，使用系统自带 `safaridriver` 创建隔离会话。
- Safari 短信登录触发滑块时结束不可交互的自动化会话，并明确提示改用扫码或 Chromium 浏览器。
- 二维码按原始像素显示并扩大白色静区；Safari 同时显示官方二维码窗口作为扫描回退。

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
