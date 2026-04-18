## 背景与目标

当前导航页的音乐模块已支持：

- 本地文件播放（IndexedDB）
- 在线 URL 播放
- LX 音源脚本在线导入（仅作“标签/脚本导出”，不在浏览器执行）
- 通过 nginx 反代实现的酷我搜索与直链解析（初版）

用户期望实现“如洛雪（LX）桌面端风格”的 **搜索弹窗**，并选择 **方案 B：多平台真实搜索**。为解决浏览器端 CORS、平台风控、签名/UA/Cookie 等限制，选择 **新增后端服务（Node.js）** 统一对外提供同源 API。

**目标**：实现一个可用的网页版多平台“搜索 → 加入播放列表/立即播放 →（可选）歌词”的闭环，UI/交互参考用户截图。

**非目标（本期不承诺）**：

- 完整复刻 LX 桌面端的所有榜单、歌单树、账号登录、VIP/无损音质、收藏同步等
- 直接在浏览器执行 LX 音源脚本（它依赖 `globalThis.lx` 与桌面端运行时）

## 用户体验（UX）规格

### 入口

- 音乐面板右上角新增 `🔍` 按钮：打开搜索弹窗
- 快捷键（后续可加）：Alt+F 或 Ctrl+K（避免与全局导航搜索冲突需再评估）

### 弹窗结构（参考图）

- 顶栏：`LX` 标识 + 大搜索框 + 搜索按钮 + 关闭
- 音源 Tab 行：kw/kg/wy/tx/mg/聚合（可用平台高亮，暂未接入置灰但可见）
- 类型 Tab：`歌曲` / `歌单`
- 主体：左侧窄图标栏（装饰/占位，非必须交互）+ 右侧结果区
- 空态：居中提示“搜我所想~~”，说明网页版能力边界

### 结果表（歌曲）

列：`# / 歌曲名 / 艺术家 / 专辑名 / 时长 / 操作`

交互：

- Enter：搜索
- 单击行：选中（可选）
- 双击行：解析直链 → 加入播放列表 → 立即播放
- 操作按钮：
  - `加入`：只加入播放列表不播放
  - `播放`（可选）：等价于双击
  - `歌词`（可选）：拉取歌词并绑定到该曲目

### 类型：歌单

第一期策略：

- UI 可切换到“歌单”
- 若后端未实现歌单：显示占位说明（不报错）
- 第二期再实现歌单搜索、歌单详情（展开/批量入列）

## 技术架构

### 为什么需要后端服务

直接在浏览器请求各平台/第三方聚合接口常遇到：

- CORS 限制（无 `Access-Control-Allow-Origin`）
- 反爬（需要特定 UA / Referer / Cookie / Token / 签名）
- 频控与封禁（需缓存、退避、统一出口）

因此采用：前端同源调用 `GET /api/music/`* → nginx 反代到 Node 服务 → Node 服务请求上游并规整返回。

### 组件划分

#### 1) 前端（现有：`index.html`/`music.js`/`styles.css`）

- 维护搜索弹窗 UI 状态（当前平台、类型、分页、loading/错误、结果列表）
- 将后端返回的“统一曲目结构”渲染到表格
- 将结果转换为播放器曲目：
  - `Music.addUrl({ url, name, source })`
  - `source` 打标签：优先用当前选中的 LX 源标签，否则 `url`

#### 2) Node 后端服务（新：建议目录 `server/`）

职责：

- 提供统一 REST API（同源）
- 请求上游接口并做字段标准化
- 做基础缓存与限流（按平台 + 关键词 + 页）
- 对“解析直链”进行集中处理（必要时加 Header/签名）

#### 3) nginx（现有：`nginx.conf`）

- `/` 静态站
- `/api/music/*` 反代到 Node 服务（同一 docker compose 网络）

## API 设计（前端只依赖这些）

### 统一数据结构

#### TrackHit（搜索命中）

- `platform`: `"kw" | "kg" | "wy" | "tx" | "mg" | "mix"`
- `id`: string（平台唯一 id）
- `name`: string
- `artists`: string（展示用，多个用 `/`）
- `album`: string
- `durationMs`: number | null
- `qualityHint`: string | null（可选：如 `128k/320k/flac`）
- `extra`: object（可选：后端调试或二次请求字段）

#### UrlResolveResult

- `url`: string（可直接给 `<audio>` 播放的直链）
- `mime`: string | null
- `expiresAt`: number | null（可选：若是短链）

#### LyricResult

- `lrc`: string（标准 LRC 文本；无则空字符串）

### 接口列表

1. 搜索歌曲

- `GET /api/music/search?platform=kw&q=xxx&page=1&pageSize=25`
- 返回：
  - `items: TrackHit[]`
  - `page: number`
  - `pageSize: number`
  - `total: number | null`
  - `isEnd: boolean`

1. 解析播放直链

- `GET /api/music/url?platform=kw&id=xxx&quality=128k`
- 返回：`UrlResolveResult`

1. 歌词

- `GET /api/music/lyric?platform=kw&id=xxx`
- 返回：`LyricResult`

1. 歌单（第二期）

- `GET /api/music/playlist/search?...`
- `GET /api/music/playlist/detail?...`

## 平台接入策略（分批）

### 第一批（先跑通闭环）

- **kw（酷我）**
  - search：可用公开 `search.kuwo.cn/r.s`
  - url：可用 `antiserver.kuwo.cn/anti.s?type=convert_url...`
  - lyric：视可用性决定（可先不做）

### 第二批（逐个平台接入）

优先顺序建议：`kg` → `wy` → `tx` → `mg`

每个平台最少需要：

- 可稳定的搜索上游接口（可能是平台自身或可信聚合服务）
- 可解析得到可播放直链（或短期可播放的媒体 URL）
- 若上游变动频繁：后端增加“多路 fallback”

### 聚合（mix）

策略：

- 后端并发请求多个平台（或聚合服务），合并去重排序
- 对外仍返回统一 `TrackHit[]`，并保留 `platform` 字段

## 安全与合规（必要说明）

- 该功能用于个人学习/技术探索；第三方音乐内容可能受版权保护。
- 直链/接口可用性受上游策略影响，可能随时失效，需要可维护的 fallback 与开关。
- 默认不做账户登录与会员内容解析，避免引入敏感凭据管理。

## 失败模式与降级

- 上游不可达 / 被风控：
  - 后端返回结构化错误 `code` + `message`
  - 前端弹窗展示错误与建议（换平台/稍后再试）
- 解析得到 URL 但播放失败（403/跨域/短链过期）：
  - 前端 toast + 标记该条为失败（可选）
- 只接入一个平台时：
  - 其它 Tab 显示但置灰（或点击提示“未接入”）

## 验收标准（Done）

### UI

- 弹窗布局与参考图“结构相似”：顶栏搜索、平台 tab、类型 tab、表格结果
- 空态/加载态/错误态可读

### 功能（至少 kw）

- 在弹窗输入关键词 → 搜索有结果
- 点击“加入” → 播放列表新增一首在线曲目
- 双击结果行 → 自动加入并播放
- 音源标签：加入的曲目 `source` 按当前选择逻辑正确打标签

### 工程

- Node 服务可由 docker compose 一键启动
- nginx `/api/music/`* 反代工作正常
- Service Worker 不缓存 `/api/*` 的动态请求

## 实施计划（下一步会单独写）

在该设计确认后，进入 implementation plan：

- 新增 `server/`（Node）+ `docker-compose.yml` 增加 service
- 前端：将弹窗 UI 与数据流完全切换到新 API
- 平台逐个接入与测试（kw 先，其他后）

