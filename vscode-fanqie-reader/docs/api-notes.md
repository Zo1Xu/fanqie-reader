# 抓包接口分析

本扩展的接口设计依据 `../../fanqie-api-capture/output/fanqie-api-records.json` 与
`fanqie-api-summary.json` 中的请求/响应样本。抓包时间为 2026-08-24。

## 阅读链路

| 用途 | 抓包接口 | 关键字段 | 当前实现 |
| --- | --- | --- | --- |
| 当前用户 | `GET /api/user/info/v2` | `data.id`、`data.name` | 用于验证 Cookie |
| 书架 | `GET /reading/bookapi/bookshelf/info/v:version/` | `data.book_shelf_info[].book_id` | 用于载入账号书架 |
| 书籍元数据 | `POST /api/book/simple/info` | `book_name`、`thumb_url` | 不调用；该请求依赖动态签名 |
| 书架详情 | `POST /api/bookshelf/multidetail` | 当前章节、简介、更新状态 | 不调用；该请求依赖动态签名 |
| 目录 | `GET /api/reader/directory/detail?bookId=…` | `chapterListWithVolume` | 页面解析失败时可作为后续回退点 |
| 正文 | `GET /api/reader/full?itemId=…` | `data.chapterData` | 不直接调用；无签名时可能返回空响应 |
| 阅读进度 | `GET /api/reader/book/progress` | `book_id`、`item_id`、`index` | 首版使用 VS Code 本地进度 |
| 更新进度 | `POST /api/reader/book/update_progress` | `book_id`、`item_id`、`index` | 不调用；避免伪造动态签名和意外改动账号数据 |

## 登录链路

完整 HAR 中记录到官方登录页调用手机验证码、二维码获取/轮询以及验证码风控接口。这些请求
包含动态签名、设备指纹和交互验证码，因此扩展不重放底层登录请求，也不自行制作账号密码
协议。扩展通过本机 Chrome、Edge 或 Chromium 创建隔离的番茄官方登录上下文：

1. 默认在无界面的官方页面中切换到“扫码登录”，读取其 data URI 二维码并显示到侧边栏。
2. 官方页面继续自行轮询扫码状态；扩展仅观察该上下文中的登录 Cookie。
3. 手机号和短信验证码在侧边栏临时输入，再由扩展填入最小化的官方页面，由网页自己的 JS
   负责短信请求、动态签名、设备风控和 Session 建立；扩展不直接调用短信登录接口。
4. 只有官方页面触发滑块时，才恢复 520×820 的验证窗口供用户手动操作；不自动破解验证码。
5. 密码登录保留在官方小窗口内，扩展不接收、读取或保存密码。
6. 检测到登录会话后，先用 `/api/user/info/v2` 验证，再保存到 VS Code SecretStorage。
7. 无论成功、取消或超时，独立浏览器上下文都会关闭，其临时浏览数据由浏览器自动清理。

番茄登录页的 `frame-ancestors` 策略不允许把整个站点直接放进 VS Code Webview，因此这里只把
二维码作为图片传入侧边栏；手机号表单也是扩展自己的本地 UI。官方脚本只在隔离的浏览器
上下文中运行，Webview 不读取跨站 Cookie。

## 为什么解析网页状态

`/page/{bookId}` 和 `/reader/{itemId}` 的服务端渲染页面包含
`window.__INITIAL_STATE__`：前者给出书名、作者、卷和章节列表，后者给出章节正文、
上一章与下一章。正文汉字使用章节页面声明的专用网页字体，因此扩展只下载当前章节的
WOFF2 字体并以内联 data URI 方式交给 Webview。字体只放在内存中，不写磁盘。

这种方式保留了抓包中已经确认的数据模型，同时避开 `a_bogus` 与 `msToken` 的动态生成。
扩展不会内置抓包里的 Cookie、Token 或账号标识。

## 边界

- 只在用户打开章节时请求当前正文，不提供批量下载或整本导出。
- 付费或锁定章节只显示锁定提示，不绕过权限校验。
- Cookie 存入 VS Code SecretStorage；项目文件和用户设置中均不保存 Cookie。
- 番茄小说没有为本扩展提供稳定的公开 API，网页结构变化后解析器可能需要更新。
