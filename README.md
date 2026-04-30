# 樱 · 个人导航 (Sakura Nav)

一个个人浏览器起始页，主打 **毛玻璃质感 + 可切换主题粒子** 的视觉氛围。
当前要求服务端存储：
- **🐳 Docker / Node 部署**（推荐）：自带 Node + SQLite 服务端，**业务数据存在服务器**，多浏览器 / 多机器访问同一地址看到的就是同一份数据
- **🌐 纯静态打开**：仅用于查看静态资源；没有同源 `/api/data` 时应用会停止进入主界面，避免把业务数据写入浏览器

![preview](https://dummyimage.com/900x500/ffd6e6/ffffff&text=Sakura+Nav)

---

## ✨ 功能

### 视觉 & 氛围
- 🌸 **Canvas 动画背景**：樱花、星光、梧桐叶、Q 版糖果星星与无粒子模式；数量 / 速度可调，页面隐藏自动暂停，自动尊重 `prefers-reduced-motion`。
- 🧊 **玻璃材质面板**：模糊 / 透明度 / 饱和度全部可调；输入框/时钟/按钮做了柔化处理。
- 🖼 **背景图系统**：
  - **🎞 服务端上传**（图片 / GIF / MP4 / WebM，文件落到服务器 media 目录）
  - **单张图片/视频 URL**（`.mp4 / .webm / .mov / .ogv` 自动按视频循环播放）
  - **多图轮播**（自定义间隔）
  - **Bing 每日壁纸** / **随机壁纸 API**
  - 可叠加 **暗色遮罩** 和 **背景模糊** 以提升内容可读性
  - 内置"二次元 / 风景 / Bing"预设 URL
  - 切换时采用双层 fade 过渡，不会突兀
- 🎨 **完全自定义外观**：
  - **四套首页主题**：樱粉、Q 版二次元、暗夜极简、复古纸质
  - **主色调**调色板（整站强调色会同步变化）
  - **字号**（小/中/大）、**圆角**（方正/适中/圆润）、**卡片密度**（紧凑/常规/宽松/超紧凑图标墙）
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
- 🛠 **导航指令协议**：AI 可以输出 `nav-action` JSON 代码块请求添加/删除/重命名/移动 链接与分组 —— 用户点击 **"✅ 应用"** 后一次性生效，支持预览 / 忽略 / 撤销本次操作
  - 示例：上传一份书签截图，AI 读图 → 输出一组 `add_link` 指令 → 点一下"应用"就自动分类到导航页
- 💾 **会话持久化**：最近 200 条消息随服务端数据持久化，刷新不丢
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
- 💾 数据通过同源 `/api/data` 写入服务端 SQLite

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
- 💾 文件本体上传到服务端 `media/music`，刷新 / 换浏览器不丢
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
- 💾 数据通过同源 `/api/data` 写入服务端 SQLite

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
  - `Ctrl/⌘ + Shift + P` 打开命令面板，快速跳转设置、日历、AI、音乐、分组与维护动作
  - `Alt + A` 打开 / 关闭 AI 助手 · `Alt + M` 打开 / 关闭音乐播放器（面板内 `空格` 播/停）
  - 空白处 **粘贴 URL** → 直接打开"添加"弹窗

---

## ✅ 结构化优化 1-10 状态

清单 1-10 已全部完成，并已纳入测试与文档：

1. `js/app.js` 继续拆分：新增 `app-modules` 边界说明，以及 AI、媒体、命令、数据版本、懒初始化、无障碍等纯逻辑模块。
2. 媒体清理系统：服务端可扫描孤儿媒体，并在设置 → 数据管理中安全删除未引用文件。
3. 浏览器冒烟增强：`npm run smoke:browser` 覆盖 `/api/data`、关键按钮、命令面板和新增静态模块。
4. AI 操作差异与回滚：AI 指令卡展示变更预览，应用前创建快照，支持撤销本次操作。
5. 命令面板：`Ctrl/⌘ + Shift + P` 可快速执行常用导航、设置和维护动作。
6. 服务端数据版本ing：快照支持对比当前数据，并可按 `nav` / `settings` / `calendar` 等分类恢复。
7. 插件生命周期接口：功能注册表新增 `register` / `start` / `stop` / `dispose` 生命周期。
8. 性能与懒初始化：日历、天气、同步、建议、最近使用等非首屏模块通过 `lazy-init` 收敛初始化边界。
9. 可访问性与键盘改进：新增 dialog 焦点管理、按钮标签审计工具和命令面板键盘入口。
10. 文档拆分：架构、存储、部署、功能、测试拆到 `docs/`，README 保留入口与总览。

详细持续清单见 [`docs/OPTIMIZATION-BACKLOG.md`](docs/OPTIMIZATION-BACKLOG.md)。

---

## 🚀 使用

1. 下载本仓库文件夹。
2. 使用 Docker 或 Node 服务端模式启动，确保页面同源可访问 `/api/data`：
   ```bash
   npm run install:server
   npm run dev
   ```
   然后打开 `http://127.0.0.1:18080/`。纯静态文件只能查看资源，不能进入主应用。
3. **登录**（默认账号）：
   - 用户名：`xianran`
   - 密码：`lh116688257`
   - 勾选"保持登录"后 **7 天内免登录**；否则仅当前会话有效。
4. 点击右上角 **⚙ 设置** 调整粒子数量、模糊度、首页主题、卡片密度、Hero 显示模式、背景图等。
5. 点击 **导入书签** → 选择从浏览器导出的 `bookmarks.html` → 预览无误后"确认导入"。
6. 顶栏最右 **⎋** 图标可退出登录。

> 🔐 **关于登录的安全声明**：页面登录用于保护导航入口，登录态 token 只保留在当前浏览器；账号凭据哈希会随服务端业务数据进入 SQLite。
> 如果部署到公网，请同时配置 `SAKURA_API_KEY`、HTTPS 和反向代理访问控制；页面登录不等同于完整的公网账户系统。
> **修改账号/密码**：登录后打开右上角 **⚙ 设置** → **账号与安全**，输入当前凭据与新用户名、新密码并保存；保存后会退出登录，需用新账号重新登录。

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
curl http://localhost:18080      # 或浏览器打开
```

默认监听 `18080` 端口。推荐复制 `.env.example` 为 `.env` 后配置端口、数据目录和 API Key：

```bash
cp .env.example .env
```

常用变量：

```dotenv
HOST_PORT=18080
SAKURA_DATA_HOST_DIR=./data
SAKURA_DATA_DIR=/data/sakura-nav
# SAKURA_API_KEY=your-secret-key
```

- `SAKURA_DATA_HOST_DIR`：宿主机上的数据目录，默认 `./data`，已被 `.gitignore` 忽略，不会随代码上传。
- `SAKURA_DATA_DIR`：容器内应用写入目录，建议保持在 `/data` 下，例如 `/data/sakura-nav`，这样才会落到上面的宿主目录。

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
  -p 18080:80 \
  sakura-nav:latest
```

### 方式三：开发模式（挂载源码热更新）

如果你想边改代码边刷新，不想每次都重建镜像，取消 `docker-compose.yml` 里 `volumes` 注释：

```yaml
volumes:
  - .:/usr/share/nginx/html:ro
  - ./nginx.conf:/etc/nginx/conf.d/sakura-nav.conf:ro
```

然后 `docker compose up -d`，改 `js/app.js` / `css/styles.css` 等直接保存就生效。

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
├── index.html          # 页面骨架与弹窗结构
├── css/                # 样式资源
│   ├── styles.css      # 全局布局 / 玻璃材质 / 首页组件
│   ├── settings.css    # 设置弹窗 / 存储面板 / 同步配置样式
│   ├── ai.css          # AI 浮动按钮 / 聊天面板
│   ├── calendar.css    # 日历面板 / 任务视图
│   ├── music.css       # 音乐播放器 / 歌词面板
│   ├── weather.css     # 天气卡片 / 城市搜索
│   ├── cards.css       # 首页导航卡片 / 分组
│   └── themes/         # 视觉主题样式
├── js/                 # 前端脚本模块
│   ├── app.js          # 主应用粘合层
│   ├── homepage-theme.js
│   ├── homepage-layout.js
│   ├── sakura.js       # Canvas 粒子系统
│   ├── bookmarks.js    # 书签解析 / favicon 多级回退
│   ├── auth.js         # 登录鉴权 / 7 天会话 token
│   ├── ai.js           # AI 助手
│   ├── ai-actions.js   # AI 指令预览 / 回滚
│   ├── command-palette.js # 命令面板
│   ├── media-cleanup.js # 媒体引用扫描 / 孤儿清理
│   ├── data-versioning.js # 数据摘要 / 快照差异
│   ├── lazy-init.js    # 非首屏模块懒初始化
│   ├── a11y.js         # 焦点管理 / 可访问性审计
│   ├── calendar.js     # 日历 & 重复任务
│   ├── music.js        # 音乐播放器
│   ├── static-assets.js # 静态资源清单
│   ├── storage-adapter.js # 业务存储适配器
│   └── ...             # 天气 / 同步 / 博客 / 导出 / 存储等模块
├── server/             # Node + SQLite 数据 API
├── tests/              # node:test 回归测试
├── docs/               # 架构 / 存储 / 部署 / 功能 / 测试文档
├── manifest.json       # PWA 元数据（可安装为桌面应用）
├── sw.js               # Service Worker（离线缓存）
└── README.md
```

持续优化清单见 [`docs/OPTIMIZATION-BACKLOG.md`](docs/OPTIMIZATION-BACKLOG.md)。

---

## 🧭 数据存储

项目现在采用 **服务端必需** 的存储策略：业务数据必须写入同源 `/api/data` 背后的 SQLite；没有服务端 API 时，前端会阻止业务键写入浏览器并停在错误页。

### 🐳 服务端模式（推荐：Docker / Node 同源部署，**多端共享**）

只要访问的页面同源能命中 `/api/data`（见 `docker-compose.yml` + `nginx.conf.template`），前端会启用服务端模式：所有业务数据都存到服务端 SQLite，不再进浏览器 `localStorage`。这意味着不同浏览器、不同机器访问同一个部署地址，看到的是同一份数据。

- 业务数据库：容器内 `<DATA_DIR>/sakura.db`，Docker 默认对应宿主机 `./data/sakura-nav/sakura.db`
  - 表 `app_data`：整包 JSON（导航 / 设置 / 博客 / 日历 / AI 配置 / 聊天记录 / 天气 / 音乐元数据 / 同步配置）
  - 表 `media_files`：已上传媒体元数据
- 媒体文件：`<DATA_DIR>/media/bg/*`、`<DATA_DIR>/media/music/*`（背景图 / 音乐走服务端，刷新/换浏览器均可见）
- 鉴权：可选。未配置 `SAKURA_API_KEY` 时 `/api` 对同容器内 nginx 放行（容器内 Node 仅监听 `127.0.0.1`，不直接对外）；配置了 `SAKURA_API_KEY` 后 nginx 会自动注入 `Authorization: Bearer`，浏览器不携带密钥
- 浏览器遗留迁移：服务端空库首次启动时，会把旧 `sakura_*` 业务键读入内存并上传到 SQLite；上传成功后会清掉这些浏览器遗留键

**仍保留在浏览器本机的只有登录态：**
- `sakura_nav_token_v1`：登录会话 token（每台机器单独登录，不作为业务数据同步）
- `sakura_nav_auth_cred_v1` 不再作为浏览器本地数据保存；服务端模式下它会随 bundle 进入 SQLite

> 设置面板底部有 **"清空所有数据"** / **"存储一览"**：在服务端模式下会显示 SQLite 库体积与媒体目录占用。
> 服务端快照支持整包恢复、对比当前数据和按分类恢复；媒体清理会只删除当前 bundle 未引用的孤儿文件。
> Docker Compose 中 `SAKURA_DATA_HOST_DIR` 与 `SAKURA_DATA_DIR` 都可配置；不要把宿主数据目录提交到 Git。

### 🌐 无服务端 API 时

页面无 `/api/data`、鉴权失败或 API 不可达时，应用会显示"服务端存储不可用"，不会进入主应用，也不会把导航、设置、日历、博客、AI、天气、同步配置、音乐元数据写入浏览器 `localStorage`。背景/音乐文件上传也不会写入 IndexedDB。

---

## 🔒 隐私

业务数据写入你部署的服务端 SQLite 与媒体目录，不会再作为业务数据留在浏览器存储里；浏览器只保留当前设备的登录态 token。favicon 通过公开的 Google / DuckDuckGo / Yandex 图标服务获取（图片直连，无追踪参数）。

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
- [x] **服务端音乐播放器（媒体上传 + LRC 同步歌词 + 频谱可视化）**
- [x] **服务端上传背景（支持图片 / GIF / 视频，走 media 目录）**
- [x] **多主题首页：樱粉 / Q 版二次元 / 暗夜极简 / 复古纸质**
- [x] **第二轮结构化优化 1-10：模块边界、媒体清理、增强 smoke、AI 回滚、命令面板、快照分类恢复、插件生命周期、懒初始化、可访问性、文档拆分**
- [ ] 从浏览器地址栏拖拽即添加
- [ ] 智能命中排序（按 `clickCount` 自动置顶热门）
- [ ] 聚合仪表盘（天气 + 今日任务 + 一言 + 最近博客）

欢迎继续告诉我你想要的，持续迭代 🌸
