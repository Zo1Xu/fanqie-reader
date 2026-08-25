# 贡献指南

感谢你改进 fanqieReader。

提交贡献即表示你同意将该贡献按本项目的 `AGPL-3.0-only` 许可证提供，并确认你有权这样做。

## 开发流程

1. Fork 仓库并从 `main` 创建功能分支。
2. 在 `vscode-fanqie-reader` 中运行 `npm ci`。
3. 完成修改并补充或更新测试。
4. 运行 `npm run verify`。
5. 运行 `npm run package`，并在 Extension Development Host 或临时 VS Code 配置中安装生成的 VSIX 验证。
6. 提交 Pull Request，说明问题、实现、验证方式和界面变化。

## 代码与范围

- 保持 CommonJS 和当前无构建步骤的结构，除非变更确有必要。
- 登录必须使用番茄官方页面或官方接口，不实现验证码绕过、风控破解或权限绕过。
- 不加入批量抓取、内容导出、付费章节绕过或小说正文再分发能力。
- 涉及 UI 的修改需同时检查深色与浅色主题。
- 用户可见行为变化需更新 README 和 CHANGELOG。

## 隐私要求

提交前运行：

```powershell
git status --short
git diff --cached --name-only
```

确认没有提交 `fanqie-api-capture/output/`、`.env`、Cookie、手机号、Token、HAR、真实书架响应或包含个人项目内容的截图。测试夹具必须使用虚构数据。
