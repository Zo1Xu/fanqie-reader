# 安全策略

## 支持版本

安全修复仅保证进入最新发布版本。请先在最新版本复现问题。

## 报告安全问题

如果仓库已启用 GitHub Private Vulnerability Reporting，请使用仓库的 **Security → Advisories → Report a vulnerability** 私下报告。若该入口尚未启用，请先创建一个不包含敏感细节的 Issue，请维护者提供私下联系渠道。

报告中请包含受影响版本、复现条件、影响范围和建议修复方向。

不要在公开 Issue、Pull Request、截图或日志中粘贴：

- 番茄小说 Cookie、Session、CSRF Token 或 Authorization 头；
- 手机号、短信验证码或密码；
- 完整 HAR、书架数据或含个人信息的响应正文；
- GitHub、Azure DevOps 或 Marketplace 凭据。

## 账号凭据泄露

如果凭据已经进入 Git 历史，仅删除当前文件并不够。请立即在相应服务中退出会话或轮换凭据，并使用 GitHub 官方的敏感数据清理流程重写历史，然后重新检查所有提交。

