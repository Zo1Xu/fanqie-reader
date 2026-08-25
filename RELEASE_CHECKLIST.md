# Release Checklist

## 元数据

- [ ] `publisher` 已替换为真实且长期使用的 Marketplace Publisher ID。
- [ ] `repository`、`homepage`、`bugs` URL 指向真实公开仓库。
- [ ] `package.json` 与 `package-lock.json` 版本一致。
- [ ] `CHANGELOG.md` 包含当前版本和日期。
- [ ] README 中的功能、命令、设置和限制与当前实现一致。
- [ ] PNG 商店图标、AGPL-3.0-only License、隐私说明和安全策略显示正常。

## 安全与隐私

- [ ] `fanqie-api-capture/output/` 中只有 README 会进入 Git。
- [ ] 未提交 HAR、Cookie、Session、CSRF Token、手机号、验证码或个人书架响应。
- [ ] 未提交 `.env`、PAT、私钥或 GitHub/Marketplace 凭据。
- [ ] 截图不包含私人代码、用户名、手机号或项目路径。
- [ ] 登录 Cookie 仍只写入 VS Code `SecretStorage`。

## 自动验证

- [ ] `npm ci` 成功。
- [ ] `npm run verify` 成功。
- [ ] `npm run release:check` 成功。
- [ ] `npm run package:release -- --out fanqie-reader-vX.Y.Z.vsix` 成功。

## 人工回归

- [ ] Extension Development Host 能正常启动。
- [ ] 活动栏显示番茄图标。
- [ ] 未登录时可打开公开书籍或章节。
- [ ] 扫码登录成功并载入读者书架。
- [ ] 验证码登录和必要的官方风控窗口工作正常。
- [ ] 登录后不显示重复登录入口，退出登录按钮可用。
- [ ] 选择章节后底部 `fanqieReader` Panel 自动打开。
- [ ] 固定的四行终端状态区、滚动正文、目录和上下章均正常。
- [ ] `Alt+PageUp` / `Alt+PageDown` 正常。
- [ ] 深色与浅色主题可读。
- [ ] 用临时 VS Code 配置安装最终 VSIX 后再次通过核心流程。

## 发布后

- [ ] GitHub Release 的标签、标题、VSIX 名称和版本一致。
- [ ] 从 GitHub Release 下载的 VSIX 可以安装。
- [ ] Marketplace Publisher 与扩展 ID 正确。
- [ ] Marketplace README、图标、License、Repository 和 Issues 链接正确。
- [ ] 从 Marketplace 全新安装后通过核心流程。
