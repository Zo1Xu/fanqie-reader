# 上传 GitHub 与发布扩展：逐步操作

本手册假设项目位于 `D:\fanqieReader`。仓库已经准备好源码、忽略规则、测试、CI、GitHub Release 工作流和 Marketplace 所需文档；以下命令需要你本人执行。

## 先理解两种“发布”

1. **GitHub Release**：公开源码，并把 `.vsix` 作为可下载附件发布。
2. **VS Code Marketplace**：用户可直接在 VS Code 扩展商店中搜索、安装和自动更新。

建议先完成 GitHub，再发布 Marketplace。两个渠道可以使用同一个 VSIX。

## 第 0 步：准备账号和工具

你需要：

- GitHub 账号；
- Git；
- Node.js 22；
- VS Code；
- 发布 Marketplace 时使用的 Microsoft 账号。

在 PowerShell 检查：

```powershell
git --version
node --version
npm --version
code --version
```

## 第 1 步：确定三个公开名称

先写下：

```text
GitHub 用户名：YOUR_GITHUB_USERNAME
GitHub 仓库名：fanqie-reader
Marketplace Publisher ID：YOUR_MARKETPLACE_PUBLISHER
```

Publisher ID 会成为扩展永久标识的一部分，例如：

```text
YOUR_MARKETPLACE_PUBLISHER.fanqie-reader
```

因此不要使用临时名称，也不要继续使用当前占位值 `local`。

## 第 2 步：创建 Marketplace Publisher

如果只想先发布 GitHub Release，可暂时跳到第 3 步；但在生成给用户安装的首个正式 VSIX 前，最好先确定 Publisher ID，避免以后扩展 ID 改变。

1. 登录 [Visual Studio Marketplace Publisher 管理页](https://marketplace.visualstudio.com/manage/publishers/)。
2. 选择 **Create publisher**。
3. 填写唯一且长期使用的 Publisher ID 与显示名称。
4. 记录 Publisher ID，后面写入 `package.json`。

## 第 3 步：替换项目中的占位符

打开 `vscode-fanqie-reader/package.json`，修改：

```json
"publisher": "你的 Marketplace Publisher ID"
```

将文件中的三处 `YOUR_GITHUB_USERNAME` 全部替换为你的 GitHub 用户名。仓库名若不是 `fanqie-reader`，同时替换 URL 中的仓库名。

然后确认没有遗漏：

```powershell
cd D:\fanqieReader
rg -n 'YOUR_GITHUB_USERNAME|YOUR_MARKETPLACE_PUBLISHER|"publisher": "local"' . -g '!**/node_modules/**' -g '!PUBLISHING.md'
```

正确结果应当没有输出。

## 第 4 步：本地验证正式包

```powershell
cd D:\fanqieReader\vscode-fanqie-reader
npm ci
npm run verify
npm run release:check
npm run package:release -- --out fanqie-reader-v0.5.4.vsix
```

用一个临时 VS Code 配置安装并验证：

```powershell
code --user-data-dir "$env:TEMP\fanqie-reader-release-test" --extensions-dir "$env:TEMP\fanqie-reader-release-test-ext" --install-extension .\fanqie-reader-v0.5.4.vsix
code --user-data-dir "$env:TEMP\fanqie-reader-release-test" --extensions-dir "$env:TEMP\fanqie-reader-release-test-ext"
```

按 [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) 完成人工检查。测试结束后可关闭临时 VS Code；不要把 VSIX 提交到 Git。

## 第 5 步：在 GitHub 创建空仓库

1. 打开 GitHub，右上角选择 **New repository**。
2. Repository name 填 `fanqie-reader`（或你在第 1 步确定的名称）。
3. 建议先选择 **Public**；如果还要检查，可先 Private，准备好后再改 Public。
4. **不要勾选**初始化 README、`.gitignore` 或 License，因为本地已经存在。
5. 点击 **Create repository**。

## 第 6 步：初始化 Git 并确认敏感文件不会上传

```powershell
cd D:\fanqieReader
git init
git branch -M main
git add .
git status --short
git check-ignore -v fanqie-api-capture/output/fanqie.har
git check-ignore -v fanqie-api-capture/output/fanqie-api-records.json
git check-ignore -v vscode-fanqie-reader/node_modules
```

三个 `git check-ignore` 命令都必须显示命中的忽略规则。`git status --short` 中不得出现：

- `fanqie-api-capture/output/fanqie.har`；
- `fanqie-api-capture/output/fanqie-api-records.json`；
- `node_modules`；
- `.idea`；
- `.vsix`；
- `.env` 或任何真实凭据文件。

再检查待提交文件：

```powershell
git diff --cached --stat
git diff --cached --name-only
```

如果敏感文件意外进入暂存区，先用 `git restore --staged -- <文件>` 移出，再修正 `.gitignore`。不要用 `git add -f` 强制加入抓包输出。

## 第 7 步：创建首次提交并推送

将 URL 中的用户名和仓库名改成你的：

```powershell
git commit -m "chore: prepare initial public release"
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/fanqie-reader.git
git remote -v
git push -u origin main
```

如果你使用 SSH，remote 可以改为：

```powershell
git remote add origin git@github.com:YOUR_GITHUB_USERNAME/fanqie-reader.git
```

## 第 8 步：检查 GitHub 仓库设置

推送后在 GitHub：

1. 打开 **Actions**，确认 `CI` 工作流通过。
2. 在 **Settings → Security → Code security and analysis** 中启用 Private vulnerability reporting。
3. 在 **Settings → General** 中确认默认分支是 `main`。
4. 可选：为 `main` 添加分支保护，要求 Pull Request 和 CI 通过后才能合并。
5. 如果标签发布工作流提示权限不足，到 **Settings → Actions → General → Workflow permissions** 检查工作流写入权限。

## 第 9 步：创建 GitHub Release

当前扩展版本为 `0.5.4`。确认 `package.json`、`package-lock.json` 和 `CHANGELOG.md` 的版本一致后执行：

```powershell
cd D:\fanqieReader
git status --short
git tag -a v0.5.4 -m "fanqieReader v0.5.4"
git push origin v0.5.4
```

`.github/workflows/release.yml` 会自动：

1. 安装依赖；
2. 运行语法检查与测试；
3. 校验 Publisher、仓库 URL、版本和 PNG 图标；
4. 生成 `fanqie-reader-v0.5.4.vsix`；
5. 创建 GitHub Release，并附加 VSIX。

在 GitHub 的 **Actions** 和 **Releases** 页面确认成功。下载 Release 中的 VSIX，再安装一次，确认附件确实可用。

如果不想使用自动工作流，也可在 GitHub 的 **Releases → Draft a new release** 中选择标签、填写标题与说明，并手动上传第 4 步生成的 VSIX。

## 第 10 步：发布到 VS Code Marketplace

推荐首次采用网页上传，不需要把 Marketplace Token 存入 GitHub：

1. 在本地重新执行第 4 步，确保 VSIX 来自最终 `main` 和最终版本。
2. 打开 [Publisher 管理页](https://marketplace.visualstudio.com/manage/publishers/)。
3. 进入你的 Publisher。
4. 选择 **New extension → Visual Studio Code**。
5. 上传 `fanqie-reader-v0.5.4.vsix`。
6. 检查商店预览中的名称、番茄 PNG 图标、README、License、仓库、Issues 和隐私链接。
7. 确认发布，并等待 Marketplace 处理和安全扫描。
8. 上架后在全新的 VS Code 配置中从 Marketplace 搜索安装，确认 Publisher ID 正确、登录和阅读正常。

不要上传以 `publisher: local` 打出的 VSIX。扩展唯一标识由 `publisher.name` 组成，更换 Publisher 会被 VS Code 视为另一个扩展。

商店的 License 应显示为 `AGPL-3.0-only`。不要把项目 LICENSE 改回宽松许可证；小说正文、番茄网站内容、商标和第三方依赖仍分别受各自权利与许可证约束。

## 后续版本发布

以补丁版本为例：

```powershell
cd D:\fanqieReader\vscode-fanqie-reader
npm version patch --no-git-tag-version
```

然后：

1. 把 `CHANGELOG.md` 的 `[Unreleased]` 内容移入新版本标题，并填写日期。
2. 运行 `npm run verify`、`npm run release:check` 和 `npm run package:release`。
3. 安装 VSIX 做回归测试。
4. 回到仓库根目录提交版本变更。
5. 创建与 `package.json` 完全一致的 `vX.Y.Z` 标签并推送。
6. 等待 GitHub Release 工作流成功。
7. 将同版本 VSIX 上传 Marketplace。

## 发布失败时先检查

- `npm run release:check` 是否通过；
- 标签是否严格等于 `v` + `package.json` 版本；
- `publisher` 是否与 Marketplace Publisher ID 完全相同；
- `name` 与 `displayName` 是否已被其他 Marketplace 扩展占用；
- `resources/icon.png` 是否至少 128×128 且不是 SVG；
- GitHub Actions 是否具有 `contents: write`；
- VSIX 中是否意外包含测试、旧 VSIX、抓包或凭据。

## 官方参考

- [GitHub：将本地代码添加到 GitHub](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github)
- [GitHub：管理 Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)
- [VS Code：Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [VS Code：Extension Manifest](https://code.visualstudio.com/api/references/extension-manifest)
