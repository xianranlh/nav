# 樱 · 个人导航 (Sakura Nav)

一个纯前端的个人浏览器起始页，主打 **毛玻璃质感 + 碎樱花飘舞** 的视觉氛围。
无需构建、无需后端，双击 `index.html` 即可使用。所有数据保存在浏览器 `localStorage`。

![preview](https://dummyimage.com/900x500/ffd6e6/ffffff&text=Sakura+Nav)

---

## ✨ 功能

### 视觉 & 氛围
- 🌸 **碎樱花 Canvas 动画背景**：数量 / 速度可调，页面隐藏自动暂停，自动尊重 `prefers-reduced-motion`。
- 🧊 **玻璃材质面板**：模糊 / 透明度 / 饱和度全部可调；输入框/时钟/按钮做了柔化处理。
- 🖼 **背景图系统**：
  - **🎞 本地上传**（图片 / GIF / MP4 / WebM，走 IndexedDB，刷新后不丢）
  - **单张图片/视频 URL**（`.mp4 / .webm / .mov / .ogv` 自动按视频循环播放）
  - **多图轮播**（自定义间隔）
  - **Bing 每日壁纸** / **随机壁纸 API**
  - 可叠加 **暗色遮罩** 和 **背景模糊** 以提升内容可读性
  - 内置"二次元 / 风景 / Bing"预设 URL
  - 切换时采用双层 fade 过渡，不会突兀
- 🎨 **完全自定义外观**：
  - **主色调**调色板（整站强调色会同步变化）
  - **字号**（小/中/大）、**圆角**（方正/适中/圆润）、**卡片密度**（紧凑/常规/宽松）
  - 亮色 / 暗色 / 跟随系统

### 组件 & 交互
- 🔎 **多引擎搜索栏**：百度 / Bing / Google / DuckDuckGo / 知乎 / GitHub / MDN。
- 🔍 **卡片快速过滤框**：实时按名称/URL 筛选已添加网址，找站神器。
- 💬 **一言 API**：12 种分类（诗词 / 动漫 / 哲学...），点击刷新，可关闭。
- ⏰ **智能时钟问候**：根据时间段（早/午/晚/深夜）切换问候语。
- 🧩 **分组 + 卡片**：
  - 添加 / 编辑 / 删除 / **跨组拖拽排序**
  - **整组拖拽重排**（从分组头部拖动）
  - **分组折叠**（点击 ▾ 按钮）
  - 双击卡片编辑、右键快速菜单
- 🔐 **登录保护**：7 天免登录，token 带防篡改指纹。

### 🤖 AI 助手（新！）
- 🔌 **多供应商管理**：兼容任意 **OpenAI Chat Completions** 协议的服务
  - 内置预设：**OpenAI / DeepSeek / Kimi / Ollama（本地）**
  - 一键 **自动拉取可用模型列表**，随时在聊天面板下拉切换
  - 每个供应商独立保存 API Key / Base URL / 默认模型
- 🎭 **角色/人设系统**：内置"导航管家 / 技术导师 / 自由聊天"，支持无限添加自定义 System Prompt
- 🪪 **个人签名**：可在 AI 设置里填你的身份 / TG 链接 / 联系方式，自动附加到每次对话
- 💬 **流式输出**：逐字打印，随时 ■ 中止
- 🖼 **Vision 图片输入**：上传 / 粘贴 / 拖拽图片给 AI 分析（自动转 base64）
- 📄 **文本文件附件**：`.txt / .json / .md / .html / .csv` 自动随消息上传（含书签 HTML 让 AI 帮你分类）
- 📐 **Markdown 渲染** + **内联预览**：AI 回复中的 `https://xxx.png/.mp4` 等链接自动渲染为可点击放大的图片 / 视频播放器 / 音频播放器
- 🛠 **导航指令协议**：AI 可以输出 `nav-action` JSON 代码块请求添加/删除/重命名/移动 链接与分组 —— 用户点击 **"✅ 应用"** 后一次性生效，支持预览 & 忽略
  - 示例：上传一份书签截图，AI 读图 → 输出一组 `add_link` 指令 → 点一下"应用"就自动分类到导航页
- 💾 **会话持久化**：最近 200 条消息本地保存，刷新不丢
- 🌈 **建议气泡**：面板空态下一键发送常用指令

### 📅 日历 & 任务（新！）
- 🗓 **月视图** + **列表视图**（未来 3 个月按天分组）+ 当日任务侧栏
- 🔁 **可编辑重复任务**：
  - 不重复 / 每天 / 每周（可勾选星期几）/ 每月 / 每年
  - 自定义 **间隔**（每 2 周、每 3 个月…）
  - 可设 **结束日期**
- ⏰ **实时倒计时**：`还有 3 天 12 小时`、`还有 15 分 32 秒`，逐秒刷新；过期显示红色
- 🌸 **首页卡"即将到来"**：展示最近 5 个任务 + 实时倒计时，一眼掌握节奏
- 🔔 **桌面通知提醒**：支持提前 5/15/30 分钟 / 1 小时 / 1 天（需授权）
- ✅ **完成 / ↶ 还原 / ⊘ 跳过本次**：重复任务每次发生都可独立处理，不影响其他次
- 🎨 任务六色标签，与玻璃面板主题一致
- 🔢 头部 **📅 按钮** 显示今天未完成任务数徽章（红点角标）
- 💾 数据存储在 `localStorage["sakura_nav_calendar_v1"]`

### ⚡ 快捷区（新！）
- 🔎 **搜索下拉联想**：输入关键字自动弹出
  - **本地书签匹配**（按名称 / URL / 描述命中）
  - **远端建议**：DuckDuckGo AC（CORS 友好）+ 百度 JSONP 备用
  - ↑↓ Enter 键盘操作，本地结果点击直接打开，远端结果自动填入搜索框
- ⚡ **最近使用卡**：首页自动列出最近点击的 10 个链接，按时间降序
- ⭐ **置顶星标**：卡片悬停显示 ☆，一键置顶到组首，`★` 高亮标识
- 📊 **点击统计**：每次点击自动打点 `clickCount` / `lastClickAt`（可用于未来智能排序）

### 🎵 音乐播放器（新！）
- 📥 **导入本地音频**：mp3 / m4a / flac / wav / ogg / aac / opus，支持多选与**拖拽**导入
- 💾 文件本体存 **IndexedDB**（不占 localStorage），刷新/重启不丢
- 🎤 **LRC 歌词**：为任意曲目附加 `.lrc` 文件；或将同名 `.lrc` 与音频一起拖入自动匹配；逐行高亮 + 居中滚动
- 📊 **频谱可视化**：Web Audio `AnalyserNode` → canvas 柔和光带，跟随节奏起伏
- 🔁 播放/暂停 / 上一首/下一首 / 随机 / 单曲循环 / 列表循环
- 🎚 音量滑杆 + 进度条（可拖动）
- ⌨️ 快捷键：`Alt + M` 打开面板，面板内按 `空格` 播停，`Esc` 关闭
- 📌 浮动按钮在左下，与 AI（右下）左右呼应；播放时按钮显示动态波纹

### 🔊 AI 语音能力（新！）
- 🎙 **语音输入**：AI 输入框 / 任务标题都带麦克风按钮（v1.4.0 已有）
- 🔊 **语音朗读**：AI 的每条回复右下角 🔊 按钮，一键朗读；自动检测中英文挑声音；播放中波动动画

### 📡 博客 RSS + 静态站导出（新！）
- 📡 **RSS 2.0** XML：一键导出 `sakura-blog.rss.xml`，可被 Feedly / Inoreader / 任何 RSS 阅读器订阅
- 💾 **静态博客站**：一键导出 **.zip 压缩包**，包含：
  - `index.html`（博客首页，列出所有文章）
  - 每篇文章一个独立 HTML 文件（带樱花主题样式 / 深色模式适配）
  - `style.css` 共享样式
  - `rss.xml`
- 🛠 **零依赖 ZIP**：自己实现 STORE（无压缩）格式 + CRC32，不依赖任何库即可生成合法 zip
- 🌐 **开箱部署**：解压 zip 后扔到 GitHub Pages / Netlify / Vercel / Nginx 静态目录，就是一个博客网站

### 🌦 天气 × 任务联动（新！）
- 📅 任务行末自动显示 **当天天气胶囊**：🌧 32° · **记得带伞**（雨/雪）、🔥 注意防晒（≥32°）、🧣 注意保暖（≤0°）
- 🔔 **桌面通知文案自动注入天气**：
  > 🌸 户外跑步  
  > 📅 明天 14:00  
  > 🌧 中雨 18~24°，记得带伞 ☂

### ☁ 天气卡 · 多城市 + 日程联动
- 🌤 **首页天气卡片**：当前温度 / 体感 / 湿度 / 天气描述 + **未来 7 天预报**
- 🏙 **多城市天气**（新！）：在设置里搜索中国城市（支持中文 / 拼音 / 英文），一键添加；卡片顶部显示各城市小 tab，点击切换查看，**双击设为主城市**（日历/通知联动用）
- 🗺 **自动定位**（IP）/ **浏览器精确定位** 二选一，同时存在
- ⚡ 所有城市 **并行拉取**，首次加载有 loading 骨架态
- 🔄 1 小时缓存，点 ↻ 强制刷新全部
- 📆 **日历月视图显示当天天气图标**（雨雪一目了然，不用点进去）
- 🔓 零 API Key：使用 [Open-Meteo](https://open-meteo.com/) 免费服务（含 Geocoding 城市搜索）

### 🔁 多端同步（新！）
- 🌐 **WebDAV**：兼容坚果云 / Nextcloud / InfiniCloud / 自建 webdav
- 🐙 **GitHub Gist**：填个 Token 就能同步（首次自动创建 Gist，记下 ID 后续沿用）
- 💾 **本地 JSON 备份 / 还原**：一键导出全量数据（导航 + 设置 + 博客 + 日历 + AI 配置）
- 🪄 **自动同步**：开启后，任何数据变更 30 秒防抖后自动上传
- 🔐 **AI Key 保护**：默认不上传 API Key，勾选后才包含（仅建议私有后端）

### 🗓 iCal (.ics) 导入导出（新！）
- ⇩ 一键导出 **标准 iCalendar** 文件（含 **VEVENT / RRULE / VALARM**）
- ⇧ 支持从 **Apple 日历 / Google 日历 / Outlook** 导出的 `.ics` 直接导入
- 🔁 RRULE 支持 `DAILY` / `WEEKLY` + `BYDAY` / `MONTHLY` / `YEARLY` + `INTERVAL` + `UNTIL` + `COUNT`

### 📊 完成度统计（新！）
- 日历面板 **"统计"Tab** 一览：
  - 本周 / 本月 **完成率**（饼状百分比）
  - 🔥 **连续打卡** 天数（任务全部完成计作一天）
  - 任务总数 + 累计完成次数
  - **近 30 天完成度趋势柱状图**（SVG 绘制，无任何依赖）

### 🎙 语音输入（新！）
- 任务标题 / AI 输入框旁带 🎙 按钮
- 基于浏览器 **Web Speech API**，中文识别，实时转写
- Chrome / Edge 支持最好；不支持的浏览器按钮会灰置

### 🤖 AI × 日历联动（新！）
- AI 现在可以直接读到 **今天的日程 / 即将到来的任务 / 当前时间**
- 指令协议新增 `add_task` / `delete_task` / `update_task` / `complete_task`
  - 说"帮我每周一三五早上 7 点晨跑" → AI 输出一条 `nav-action` → 一键应用
  - 说"把今天的会议改到明天下午 3 点" → AI 返回 `update_task`

### 📝 博客系统（新！）
- 📰 **本地博客**：写文章、打标签、上封面、发布 / 草稿
- 🔎 **标签筛选 + 全文搜索**
- 🧾 **Markdown 渲染**：与 AI 共用渲染器，支持代码块 / 图片 / 链接 / 引用 / 列表
- 👁 **编辑器实时预览**
- 🔑 **后台管理模式**：切换后显示"写文章"/"删除"/"草稿"，普通模式只显示已发布内容
- 🤝 **AI 帮你写**：编辑器一键让 AI 帮写草稿
- 💾 数据存储在 `localStorage["sakura_nav_blog_v1"]`

### 数据 & 兼容
- 📚 **批量导入浏览器书签**（`bookmarks.html` Netscape 格式，Chrome / Edge / Firefox 通用）
  - 可选 **保留文件夹为分组** / **自动获取图标** / **URL 去重合并**
- 📤 **导出**：
  - **JSON 备份**（含所有设置）
  - **浏览器书签 HTML**（反向兼容，可在 Chrome/Edge 里重新导入）
- 🖼 **自动获取 favicon**：多级回退（站点 → Google → DuckDuckGo → Yandex）+ 彩色字母占位。
- 📴 **PWA 离线可用**：已注册 Service Worker，核心资源 SWR 缓存，可"添加到桌面"。
- ⌨️ **键盘快捷键**：
  - `/` 聚焦搜索 · `Ctrl/⌘ + K` 新建链接 · `E` 编辑模式 · `Esc` 关闭菜单
  - `Alt + A` 打开 / 关闭 AI 助手 · `Alt + M` 打开 / 关闭音乐播放器（面板内 `空格` 播/停）
  - 空白处 **粘贴 URL** → 直接打开"添加"弹窗

---

## 🚀 使用

1. 下载本仓库文件夹。
2. 双击 `index.html` 在浏览器中打开，或通过本地服务器托管（如 `python -m http.server`）。
3. **登录**（默认账号）：
   - 用户名：`xianran`
   - 密码：`lh116688257`
   - 勾选"保持登录"后 **7 天内免登录**；否则仅当前会话有效。
4. 点击右上角 **⚙ 设置** 调整樱花数量、模糊度、主题、卡片密度、背景图等。
5. 点击 **导入书签** → 选择从浏览器导出的 `bookmarks.html` → 预览无误后"确认导入"。
6. 顶栏最右 **⎋** 图标可退出登录。

> 🔐 **关于登录的安全声明**：本项目纯前端，鉴权靠 `SHA-256(用户名::密码)` 哈希比对 + 本地 token；
> 由于代码在浏览器可读，**这种登录只能阻止路人随手打开**，不等同于服务器鉴权。
> **修改账号/密码**：登录后打开右上角 **⚙ 设置** → **账号与安全**，输入当前凭据与新用户名、新密码并保存；保存后会退出登录，需用新账号重新登录。凭据的 `SHA-256(用户名::密码)` 存在本机 `localStorage`（`sakura_nav_auth_cred_v1`），未自定义时仍使用内置默认账号。

### 从浏览器导出书签

- **Chrome / Edge**：`⋮` → `书签` → `书签管理器` → `⋮` → `导出书签`
- **Firefox**：`书签` → `管理书签` → `导入和备份` → `导出书签为 HTML`

---

## 🐳 Docker 部署

项目自带 `Dockerfile` + `docker-compose.yml` + `nginx.conf`，**镜像仅 ~20 MB**，一条命令即可启动。

### 方式一：docker compose（推荐）

```bash
# 克隆项目（或自行放到服务器任意目录）
git clone <your-repo-url> sakura-nav
cd sakura-nav

# 一键启动（后台运行）
docker compose up -d

# 访问
curl http://localhost:8080      # 或浏览器打开
```

默认监听 `8080` 端口，要改端口只需编辑 `docker-compose.yml` 里的 `"8080:80"`。

常用指令：

```bash
docker compose logs -f sakura-nav     # 查看日志
docker compose down                   # 停止并移除容器
docker compose up -d --build          # 代码更新后重新构建
docker compose restart sakura-nav     # 只重启
```

### 方式二：纯 docker 命令

```bash
docker build -t sakura-nav:latest .
docker run -d \
  --name sakura-nav \
  --restart unless-stopped \
  -p 8080:80 \
  sakura-nav:latest
```

### 方式三：开发模式（挂载源码热更新）

如果你想边改代码边刷新，不想每次都重建镜像，取消 `docker-compose.yml` 里 `volumes` 注释：

```yaml
volumes:
  - .:/usr/share/nginx/html:ro
  - ./nginx.conf:/etc/nginx/conf.d/sakura-nav.conf:ro
```

然后 `docker compose up -d`，改 `app.js` / `styles.css` 等直接保存就生效。

### 方式四：自动 HTTPS（有域名时）

项目附带 `Caddyfile`，Caddy 会自动申请 Let's Encrypt 证书：

1. 把你的域名（例如 `nav.example.com`）DNS A 记录指向服务器公网 IP
2. 确保服务器 `80` / `443` 端口对公网开放
3. 编辑 `docker-compose.yml`：
   - 取消 `caddy` 服务段的注释
   - 把 `sakura-nav` 服务的 `ports` 改成只监听内部（例如删掉 `ports` 部分，让 Caddy 反代即可）
   - 设置 `DOMAIN=nav.example.com` 和 `EMAIL=you@example.com`
4. `docker compose up -d`

几分钟后你的域名就能直接 HTTPS 访问，零配置。

### ⚠ 为什么建议用 HTTPS？

浏览器要求 **HTTPS**（或 localhost）才能启用这些能力：

| 能力 | 依赖 |
|------|------|
| PWA 安装 / 离线缓存 | ✅ Service Worker 需 HTTPS |
| 📅 桌面通知 | ✅ `Notification` 需 HTTPS |
| 🎙 语音输入 | ✅ `SpeechRecognition` 需 HTTPS |
| 🗺 浏览器精确定位（天气） | ✅ `Geolocation` 需 HTTPS |
| 📋 剪贴板 API（复制 URL） | ⚠ 需 HTTPS（否则走兼容模式） |

内网 / 本机用 HTTP 也能跑，但 IP 定位 / DuckDuckGo 联想这些外部 API 在混合内容策略下可能失败。**上线请用 HTTPS**。

### 🔐 部署后的第一件事

**务必改掉默认账号密码。** 登录后进入 **设置 → 账号与安全**，将用户名与密码改为自己的；保存后需重新登录。

---

## 📂 项目结构

```text
nav/
├── index.html      # 页面骨架
├── styles.css      # 玻璃 / 樱花 / 背景层 / 布局
├── sakura.js       # 樱花 Canvas 粒子系统
├── bookmarks.js    # 书签解析 / favicon 多级回退
├── auth.js         # 登录鉴权 / 7 天会话 token
├── ai.js           # AI 助手（供应商 / 流式 / 指令解析 / Markdown 渲染）
├── blog.js         # 博客系统（数据模型 + CRUD）
├── calendar.js     # 日历 & 重复任务（规则引擎 / 倒计时 / 通知 / iCal / 统计）
├── sync.js         # 多端同步（WebDAV + GitHub Gist + 本地备份）
├── weather.js      # 天气（Open-Meteo + IP/浏览器定位）
├── suggest.js      # 搜索下拉联想（本地 + DuckDuckGo + 百度 JSONP）
├── exporter.js     # 博客 RSS + 静态站 + 无依赖 ZIP 打包器
├── idb.js          # 统一 IndexedDB 助手（背景 / 音乐 store 的读写）
├── music.js        # 音乐播放器（IndexedDB + LRC + Web Audio 频谱）
├── app.js          # 主应用（数据、渲染、设置、背景、一言、过滤、拖拽、AI/Blog/Cal/Weather/Sync/Music/Voice/Suggest/Recent UI 粘合）
├── manifest.json   # PWA 元数据（可安装为桌面应用）
├── sw.js           # Service Worker（离线缓存）
└── README.md
```

---

## 🧭 数据存储

- 导航数据：`localStorage["sakura_nav_v1"]`
- 用户设置：`localStorage["sakura_nav_settings_v1"]`
- AI 配置 / 会话：`localStorage["sakura_nav_ai_v1"]` / `["sakura_nav_chat_v1"]`
- 博客文章：`localStorage["sakura_nav_blog_v1"]`
- 日历任务：`localStorage["sakura_nav_calendar_v1"]`
- 同步配置：`localStorage["sakura_nav_sync_v1"]`
- 天气缓存：`localStorage["sakura_nav_weather_v1"]`

> 设置面板底部有 **"清空所有数据"** 按钮，可一键重置导航数据。AI / 博客数据目前在 AI 设置与博客后台中独立管理。

---

## 🔒 隐私

所有数据仅存在你本地浏览器，不会上传任何服务器。favicon 通过公开的 Google / DuckDuckGo / Yandex 图标服务获取（图片直连，无追踪参数）。

---

## 🛣 后续可迭代方向

- [x] 一言 API（hitokoto）
- [x] 分组折叠 + 整组拖拽
- [x] 背景图轮播 / Bing / 随机壁纸
- [x] 导出为浏览器书签 HTML
- [x] PWA 可安装、离线可用
- [x] 完全自定义样式（主色、字号、圆角、玻璃参数）
- [x] **AI 助手：多供应商 / 模型切换 / Vision / 文件上传 / 指令式修改导航**
- [x] **本地博客系统：Markdown、标签、后台管理、AI 辅助写作**
- [x] **日历 & 重复任务：月视图 / 倒计时 / 桌面通知**
- [x] **天气卡片（Open-Meteo 免费 API）+ 日历月视图天气图标**
- [x] **多设备同步：WebDAV + GitHub Gist + 本地 JSON 备份**
- [x] **iCal (.ics) 双向导入导出（支持 RRULE）**
- [x] **完成度统计（本周 / 本月 / 30 天趋势 / 连续打卡）**
- [x] **AI × 日历联动（add_task / update_task / delete_task）**
- [x] **语音输入（Web Speech API）**
- [x] **搜索建议下拉联想（本地 + DuckDuckGo + 百度）**
- [x] **收藏置顶 + 最近使用卡**
- [x] **博客 RSS 订阅 + 静态站导出（无依赖 ZIP）**
- [x] **AI TTS 朗读回复（speechSynthesis 中英自动选音）**
- [x] **天气 × 任务智能联动（雨雪/高温/低温提示 + 通知文案注入）**
- [x] **多城市天气（中国城市搜索 + 主城市切换 + 并行拉取）**
- [x] **本地音乐播放器（IndexedDB + LRC 同步歌词 + 频谱可视化）**
- [x] **本地上传背景（支持图片 / GIF / 视频，走 IndexedDB）**
- [ ] 从浏览器地址栏拖拽即添加
- [ ] 智能命中排序（按 `clickCount` 自动置顶热门）
- [ ] 多主题皮肤（非粉色可选）
- [ ] 聚合仪表盘（天气 + 今日任务 + 一言 + 最近博客）

欢迎继续告诉我你想要的，持续迭代 🌸
