# 番茄阅读（fanqieReader）

在 VS Code 侧边栏浏览番茄小说书架，在底部 `fanqieReader` Panel 内以终端风格阅读章节。

> 非官方项目。本扩展与北京时光荏苒科技有限公司、番茄小说及其关联公司无隶属、授权或背书关系。“番茄小说”等名称和标识归其权利人所有。

## 功能

- 通过书籍 ID、详情页链接或章节链接直接打开公开内容。
- 章节显示在 Problems、Output、Terminal 同一区域的 `fanqieReader` Tab，不占用编辑器标签页。
- 阅读区模拟终端输出，顶部提示符和三行 `[INFO]` 状态在滚动时固定。
- 页面默认隐藏操作区；鼠标移到顶部或底部时显示章节控制。
- `Alt+PageUp` / `Alt+PageDown` 切换上一章 / 下一章。
- 支持番茄官网扫码、短信验证码和官方小窗口登录。
- 登录后载入个人书架，支持按卷浏览目录和继续阅读。
- 自动适配 VS Code 深色/浅色主题，可调整字号、行高和正文宽度。
- 不绕过付费、锁定章节或账号权限。

## 安装

### 从 VS Code Marketplace

发布后，在 VS Code 扩展视图中搜索“番茄阅读”，选择发布者与仓库信息匹配的版本安装。

### 从 GitHub Release 的 VSIX

1. 从项目 Releases 页面下载 `fanqie-reader-vX.Y.Z.vsix`。
2. 在 VS Code 中运行 **Extensions: Install from VSIX...**。
3. 选择下载的 VSIX，安装后按提示重新加载窗口。

也可使用命令行：

```powershell
code --install-extension .\fanqie-reader-v0.5.4.vsix
```

## 使用

1. 在活动栏打开番茄图标。
2. 未登录时可粘贴书籍 ID、详情页链接或章节链接直接阅读公开内容。
3. 需要个人书架时，选择扫码登录或验证码登录。
4. 选择书籍和章节后，底部 `fanqieReader` Panel 会自动打开。
5. 使用目录、悬浮控制区或快捷键切换章节。

扫码和侧边栏登录需要本机安装 Chrome、Edge 或 Chromium。若浏览器位于自定义路径，请设置 `fanqieReader.browserPath`。

## 登录与数据

- 二维码和验证码使用后台创建的番茄官方登录会话。
- 仅在番茄触发交互式风控时打开受控的官方验证窗口；扩展不会破解或绕过验证。
- 手机号和短信验证码只存在于当前登录会话内，不写入设置、工作区文件或日志。
- 密码只在番茄官方页面中输入，扩展不读取或保存密码。
- 登录 Cookie 保存到 VS Code `SecretStorage`。
- 阅读进度保存在 VS Code 本地，不同步回番茄账号。
- 执行“番茄阅读：退出登录”会清除登录 Cookie，但保留本地阅读进度。

详细内容见 [PRIVACY.md](PRIVACY.md) 和 [SECURITY.md](SECURITY.md)。

## 设置

| 设置 | 默认值 | 说明 |
| --- | ---: | --- |
| `fanqieReader.fontSize` | `14` | 阅读区字号（像素） |
| `fanqieReader.lineHeight` | `1.6` | 阅读区行高 |
| `fanqieReader.contentWidth` | `760` | 正文最大宽度（像素） |
| `fanqieReader.browserPath` | 空 | Chrome、Edge 或 Chromium 可执行文件路径 |

## 常用命令

- 番茄阅读：打开书籍或章节
- 番茄阅读：显示底部阅读区
- 番茄阅读：上一章 / 下一章
- 番茄阅读：侧边栏登录（扫码 / 验证码）
- 番茄阅读：在官方小窗口中登录
- 番茄阅读：手动导入 Cookie（高级）
- 番茄阅读：退出登录
- 番茄阅读：刷新书架

## 已知限制

- 本扩展依赖番茄网页和非公开接口；网页结构或接口变化可能导致功能失效。
- 密码输入和交互式风控必须在番茄官方窗口中完成。
- 首个公开版本不把进度同步回番茄账号。
- 请遵守番茄小说服务条款和内容版权要求，不要用于批量抓取或内容再分发。

## 本地开发

```powershell
npm ci
npm run verify
```

在 VS Code 中打开本目录，按 `F5` 启动 Extension Development Host。生成 VSIX：

```powershell
npm run package
```

## 许可证

扩展源码按 [GNU Affero General Public License v3.0 only](LICENSE) 发布。分发修改版本时必须遵守 AGPL-3.0 的源码提供与同许可证要求；如果修改版本支持用户通过计算机网络远程交互，还需遵守第 13 条。小说正文、网站内容、商标及第三方资源不属于本许可证授权范围。
