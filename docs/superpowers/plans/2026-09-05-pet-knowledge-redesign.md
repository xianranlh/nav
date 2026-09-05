# 闲然导航：宠物与 Obsidian 知识库功能重规划

**日期**：2026-09-05
**状态**：实施中；Wave 1–3 已完成，待 Wave 4–5
**目标版本**：v1.25.x–v1.27.x
**实施原则**：宠物继续做“状态伴侣与快捷助手”；Obsidian Vault 是知识内容的唯一事实源；闲然导航只负责安全索引、检索、阅读、最近访问与可选的 Inbox 快速收集。

---

## 1. 结论

本轮不把宠物改造成签到、金币、饱食度驱动的养成游戏，也不在闲然导航内重写 Obsidian 编辑器或 Obsidian Sync。

建议形成两个清晰产品：

1. **星轨伙伴（宠物 v3）**：可换形象、可移动，能准确反馈 AI、同步、网络与知识索引状态，并提供可配置的快捷动作。
2. **星穹知识舱（Obsidian 接入）**：首页可以搜索 Vault、继续最近笔记、按标签浏览、安全阅读 Markdown，并在启用写入后快速收集到固定 Inbox。

二者只通过事件和动作联动，例如“让宠物搜索 Vault”“继续最近笔记”“索引完成后给出一次状态反馈”。宠物模块不保存或上传笔记正文。

> 本文中的 “OBS” 统一解释为 **Obsidian**。如果用户实际指 OBS Studio，需要另行重做范围定义。

---

## 2. 当前基线

### 2.1 宠物

- `pet.html` 是独立设置页，支持改名、上传形象、站岗 / 巡逻、三档尺寸、首页显示与位置重置。
- `js/pet-engine.js` 同时承担配置、动画、对白和状态总线，职责过多。
- `js/pet-widget.js` 运行时注入大量 CSS 和 DOM，并通过观察 `#ai-panel` 的 class 推断 AI 工作状态，耦合且容易失效。
- `sakura_pet_v2` 已进入服务端 bundle，但自定义图片保存为 Data URL；每次配置更新都会跟随 `/api/data` 整包上传。
- 当前状态只覆盖 AI、同步和网络，尚未形成稳定的跨模块事件协议。

### 2.2 知识库

- 导航顶部“知识库”目前只跳到同域 `/blog`，并允许用 `sakura_nav_blog_url` 临时覆盖。
- 当前仓库没有 Obsidian Vault 扫描器、Markdown 索引、Wiki 链接解析、附件代理或知识检索接口。
- 浏览器和 PWA 不能稳定、跨平台地直接读取用户任意本地目录；File System Access API 不适合作为服务器共享和多设备访问的主方案。
- Electron 当前只安全放行 `http:` / `https:`，尚不能受控打开 `obsidian://open` 深链接。
- 服务器已有登录用户、SQLite、用户隔离 bundle 和媒体接口，可复用其认证、数据库与备份流程。

原 `/blog` 可以继续作为独立博客入口，但不再承担本计划中的“知识库”职责，也不再要求 Petrichor SSO、代理搜索或跨仓库改造。

---

## 3. 产品边界

### 3.1 本轮必须实现

- 首页提供可用的 Obsidian 知识中枢，而不只是一个跳转按钮。
- 服务器从受控挂载目录扫描 Markdown，建立按用户隔离的检索索引。
- Vault 文件仍为唯一事实源；SQLite 只保存可重建索引、最近访问与界面偏好。
- 知识读取默认只读；未明确启用写入时，导航不能修改 Vault。
- 宠物配置 v3 不再把自定义图片塞进 JSON bundle。
- 宠物状态改为显式事件驱动，不再观察 UI class 猜状态。
- Web、手机、PWA、Windows EXE、macOS DMG 都能搜索和阅读；安装了 Obsidian 的桌面设备可从用户点击打开原笔记。
- 所有最近访问、固定项和显示配置继续按导航用户隔离并由服务端持久化。

### 3.2 明确不做

- 不实现或逆向 Obsidian Sync 私有协议。
- 不把整个 Vault 正文复制进用户 bundle，也不把笔记正文上传到宠物配置。
- 不允许前端提交任意服务器绝对路径、`file://` URL 或扫描根目录。
- 不执行 Dataview、Templater、JS、Shell、Canvas 脚本或社区插件代码。
- 不在 MVP 中做向量数据库、自动 AI 摘要、RAG 问答和多人协同编辑。
- 不在浏览器中复刻完整 Obsidian 编辑器；编辑仍在 Obsidian 中完成。
- 不做宠物金币、抽卡、饱食度、连续签到或付费皮肤。
- 不默认打包未经授权的商业游戏角色素材；允许用户上传自有图片，内置素材采用原创星轨角色。

### 3.3 Vault 到服务器的同步边界

导航只消费服务器上已存在的 Vault 目录，不负责把个人电脑文件传到服务器。部署者可任选 Syncthing、Git、rclone、Obsidian Sync 的受支持导出方式或 NAS 同步，把 Vault 同步到宿主机；导航容器只挂载最终目录。

默认部署为只读：

```yaml
services:
  nav:
    environment:
      OBSIDIAN_ENABLED: "true"
      OBSIDIAN_VAULT_ROOT: /vaults
      OBSIDIAN_WRITE_ENABLED: "false"
    volumes:
      - ${OBSIDIAN_VAULT_HOST_PATH}:/vaults:ro
```

不把 Obsidian Local REST API 插件作为服务器主方案，因为它通常运行在用户本机，云端服务器无法可靠、安全地回连每一台设备。它可以在后续作为“纯本机模式”的独立适配器评估。

---

## 4. 目标架构

```text
Obsidian 桌面 / 手机
        │
        │ 用户自选同步工具（本项目范围外）
        ▼
服务器宿主机 Vault 目录
        │ Docker 只读挂载
        ▼
闲然导航 Node API
├─ Vault 扫描器：Markdown / Frontmatter / Wiki 链接
├─ SQLite FTS5 可重建索引
├─ 安全 Markdown 阅读与附件代理
├─ 用户配置 / 最近访问 / 固定项
├─ 可选固定 Inbox 写入器
└─ 宠物媒体 / 状态事件
        │
        ▼
闲然导航 Web / PWA / Electron
├─ 星穹知识舱：搜索 / 最近 / 标签 / 阅读
├─ “在 Obsidian 中打开”显式操作
└─ 星轨伙伴（宠物）
```

### 4.1 数据归属

| 数据 | 唯一事实源 | SQLite / bundle 保存什么 |
|---|---|---|
| Markdown、Frontmatter、附件 | Obsidian Vault | 不进入用户 bundle |
| 可搜索正文、标签、链接关系 | Vault | SQLite 中保存可删除、可重建的派生索引 |
| 最近打开、固定笔记、首页显示偏好 | 闲然导航 | `noteId`、标题快照、时间戳、显示配置；不保存正文 |
| Vault 根目录与用户映射 | 服务端部署配置 | 只保存根目录下的安全相对目录名，不接受前端路径 |
| 快速收集草稿 | Obsidian 固定 Inbox | 成功写入后不在导航 bundle 保留正文 |
| 宠物名称、行为、尺寸、位置、快捷动作 | 闲然导航用户 bundle | `PetConfigV3` |
| 自定义宠物图片 | 闲然导航 `media/pet` | bundle 只保存 URL 与元数据 |

### 4.2 用户与 Vault 映射

默认采用每用户独立子目录：

```text
/vaults/
├─ user-1/
├─ user-2/
└─ user-3/
```

- `user-<id>` 由服务端根据已认证用户 ID 计算，客户端不能覆盖。
- 单人部署可通过 `OBSIDIAN_SINGLE_USER_ID=1` 只启用一个 Vault。
- 如果用户目录不存在，接口返回 `configured:false`，不回显宿主机路径。
- 多用户共享同一 Vault 不是默认能力；如以后需要，必须增加显式 ACL，而不是复用同一目录。

---

## 5. 数据与接口契约

### 5.1 `PetConfigV3`

```js
{
  schemaVersion: 3,
  name: "小樱",
  skin: {
    kind: "builtin",                 // builtin | custom
    id: "astral-xiaoying",
    url: "assets/pet/xiaoying-sheet.png",
    mediaFilename: null
  },
  homeWidget: true,
  activityMode: "guard",             // guard | patrol
  homeScale: "md",                   // sm | md | lg
  anchor: { xRatio: 0.88, yRatio: 0.08 },
  speechFrequency: "normal",         // quiet | normal | lively
  showStatusBadge: true,
  quickActions: ["todo", "calendar", "knowledge", "settings"],
  updatedAt: 0
}
```

迁移规则：

- 首次读取 `sakura_pet_v2` 时生成 v3。
- `homeX/homeY` 转换为 0–1 的相对坐标，跨分辨率保持位置。
- 旧 `custom.img` 先上传 `/api/media/pet`，上传成功后写 `mediaFilename/url`；失败时保留 v2，不能清除原图。
- v3 bundle 内禁止出现 `data:image/`。

### 5.2 `ObsidianKnowledgeConfigV1`

```js
{
  schemaVersion: 1,
  enabled: true,
  homeMode: "recent",                 // recent | pinned | hidden
  recent: [
    { noteId: "n_7f0...", title: "部署手册", openedAt: 0 }
  ],
  pinnedNoteIds: [],
  lastQuery: "",
  openPreference: "reader",           // reader | obsidian
  updatedAt: 0
}
```

- 最近记录最多 20 条，按 `noteId` 去重并按 `openedAt` 降序。
- `noteId` 是服务端根据用户和规范化相对路径生成的稳定不透明 ID；前端不接触绝对路径。
- 笔记移动后由内容哈希与索引迁移尽力保留最近记录；无法确认时将旧记录标记为 unavailable，不误连到另一篇笔记。
- 标题快照只用于离线占位，索引恢复后以 Vault 当前标题为准。

### 5.3 SQLite 派生索引

建议新增：

```sql
CREATE TABLE obsidian_notes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  note_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  frontmatter_json TEXT NOT NULL DEFAULT '{}',
  content_text TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL,
  mtime_ms INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL,
  UNIQUE(user_id, note_id),
  UNIQUE(user_id, relative_path)
);

CREATE TABLE obsidian_links (
  user_id INTEGER NOT NULL,
  source_note_id TEXT NOT NULL,
  target_ref TEXT NOT NULL,
  target_note_id TEXT,
  kind TEXT NOT NULL,
  PRIMARY KEY(user_id, source_note_id, target_ref, kind)
);

CREATE TABLE obsidian_assets (
  user_id INTEGER NOT NULL,
  asset_id TEXT NOT NULL,
  owner_note_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  PRIMARY KEY(user_id, asset_id),
  UNIQUE(user_id, owner_note_id, relative_path)
);
```

同时建立 `obsidian_notes_fts` FTS5 虚拟表，索引 `title`、`content_text`、`tags`。启动时检测 FTS5 能力；不可用时明确记录降级并使用受限 `LIKE` 搜索，不能导致服务启动失败。

该索引可随时按用户清空并从 Vault 重建，不进入 `/api/export` 的业务数据包；导出只包含 Obsidian 知识配置，不包含笔记正文。

### 5.4 闲然导航知识 API

| 接口 | 行为 | 验收响应 |
|---|---|---|
| `GET /api/knowledge/status` | 返回当前用户 Vault 与索引状态 | `{ enabled, configured, writable, indexing, noteCount, lastIndexedAt, errorCode }` |
| `GET /api/knowledge/search?q=...&limit=12` | 搜索标题、正文、标签 | 查询 1–120 字，默认 12、最多 20 条；只返回摘要和命中片段 |
| `GET /api/knowledge/recent?limit=6` | 读取当前用户最近笔记 | 默认 6、最多 20 条；失效记录有 `available:false` |
| `GET /api/knowledge/tags?limit=30` | 返回标签及数量 | 数量按当前用户索引计算，不跨用户聚合 |
| `GET /api/knowledge/notes/:noteId` | 读取单篇规范化笔记 | 返回 Markdown AST 或已消毒 HTML、元数据、出链与反链 |
| `GET /api/knowledge/attachments/:assetId` | 读取受支持附件 | 校验所属笔记、类型、大小和最终真实路径 |
| `POST /api/knowledge/opened` | 保存最近打开 | `{ ok:true }`；去重后最多 20 条 |
| `POST /api/knowledge/reindex` | 触发当前用户增量重建 | 管理员或本人限频；返回任务 ID，不阻塞请求 |
| `POST /api/knowledge/capture` | 可选写入固定 Inbox | 未启用写入返回 403；成功返回 `{ noteId, title, createdAt }` |

统一错误码使用 `OBS_DISABLED`、`VAULT_NOT_CONFIGURED`、`INDEX_BUILDING`、`NOTE_NOT_FOUND`、`UNSAFE_PATH`、`WRITE_DISABLED`、`CAPTURE_CONFLICT`。前端显示对应中文状态，不直接展示 `Failed to fetch` 或服务器路径。

### 5.5 扫描与渲染规则

- 仅扫描 `.md`；忽略 `.obsidian/`、`.trash/`、点目录、临时文件和部署配置中的 ignore glob。
- 扫描根路径先 `realpath`，每个文件再次校验最终路径仍位于当前用户 Vault 内；默认不跟随符号链接。
- 单篇 Markdown 默认最大 2 MiB，单个附件默认最大 20 MiB，限制总文件数与索引并发。
- Frontmatter 只读取 JSON 可序列化的安全标量 / 数组；原型键和异常 YAML 被忽略并记录结构化错误。
- Wiki 链接 `[[note]]`、`[[note|alias]]`、Markdown 相对链接在服务端解析；无法解析时保留纯文本，不拼接任意文件路径。
- Markdown 不允许原始脚本、事件属性、`javascript:`、远程 iframe 或任意 HTML 执行；渲染结果必须经过允许列表消毒。
- 外部图片默认不由服务器代抓，防止 SSRF；Vault 内附件通过不透明 `assetId` 访问。
- 文件监听只做增量提示；启动、错过事件或监听器失败时仍能通过周期校验 / 手动重建恢复一致性。

### 5.6 可选 Inbox 写入契约

写入功能默认关闭。启用时必须同时设置：

```env
OBSIDIAN_WRITE_ENABLED=true
OBSIDIAN_INBOX_DIR=00-Inbox
OBSIDIAN_CAPTURE_MAX_BYTES=262144
```

- 客户端只能提交 `title`、`content`、`sourceUrl`、`tags`，不能提交目录或文件名。
- 服务端生成安全文件名，并确认目标始终位于 `<vault>/00-Inbox/`。
- 使用同目录临时文件 + 原子 rename；发生重名时添加时间戳 / 短随机后缀，不覆盖已有笔记。
- 写入失败不更新最近记录，临时文件会被清理。
- Docker 部署应保持 Vault 根目录只读，仅将 Inbox 作为单独可写挂载；做不到最小写权限时不要开启该功能。

---

## 6. 宠物功能重规划

### P0：引擎拆分与 v3 存储（必须先做）

**文件范围**：`js/pet-engine.js`、新建 `js/pet-config.js`、新建 `js/pet-events.js`、`js/pet-widget.js`、`js/pet.js`、`server/index.js`、`server/database.js`、`js/sync.js`、测试。

- 将配置迁移、状态调度、动画角色拆成三个模块；`pet-engine.js` 只保留渲染与动作。
- 增加 `pet` 媒体类别，补齐上传、读取、删除、inventory、export/import 和用户归属校验。
- 定义事件协议：
  - `nav:ai:start|done|error`
  - `nav:sync:start|done|error`
  - `nav:knowledge:index-start|index-done|search|open|capture|error`
  - `nav:network:offline|online`
- 状态优先级固定为 `offline > error > working > syncing > done > idle`，每个瞬时状态带 TTL；低优先级事件不能覆盖高优先级状态。
- 删除对 `#ai-panel.is-sending` 的 `MutationObserver`，由 AI、同步和知识模块显式派发事件。

**验收**：

- v2→v3 迁移测试覆盖默认形象、自定义图片、非法尺寸、越界坐标和上传失败回滚。
- `sakura_pet_v3` 中不存在 `data:image/`，连续改名不会重复上传图片。
- 任一用户不能读取或删除另一用户的宠物媒体。
- AI 请求开始 / 成功 / 失败分别稳定映射到 working / done / error，不依赖 DOM class。

### P1：星轨伙伴中心

**文件范围**：`pet.html`、`styles/pet.css`、`js/pet.js`、原创宠物素材。

- 页面从“预览场地 + 零散按钮”调整为三块：角色预览、行为与显示、快捷动作。
- 角色选择分为“内置原创角色”和“我的图片”；每张皮肤有站立预览、适配提示和删除入口。
- 首页位置使用小型安全区地图选择，而不是依赖拖拽后猜位置；仍保留首页直接拖动。
- 快捷动作最多 4 个，可选待办、日历、AI、搜索知识、继续笔记、设置。
- `quiet / normal / lively` 控制对白频率，提供“静音但保留状态徽章”。
- 手机端默认 `guard + sm`；巡逻只能在宽度 ≥ 720px 时启用，窄屏自动降级但不改用户原配置。

**验收**：

- 360×800、768×1024、1440×900 下无横向溢出，所有操作可通过触摸和键盘完成。
- 宠物不会覆盖 AI / 音乐浮钮、Toast、底部安全区或系统滚动条。
- `prefers-reduced-motion` 下使用静态帧；页面隐藏后 1 秒内停止动画 RAF。
- 默认空闲状态不产生网络请求。

### P2：有用的轻互动

- 单击：根据当前状态回应，不跳页。
- 双击：打开快捷动作圆盘，替代容易误触的双击跳转。
- 长按 / 右键：显示站岗、巡逻、静音、暂时隐藏与设置。
- “暂时隐藏”只对当前会话生效；“首页关闭”是持久设置，两者文案分离。
- 完成待办、AI 完成、同步恢复、知识索引完成或收集完成时只出现一次短反馈，禁止连续弹话气泡。

**验收**：

- 单击、双击、拖拽互斥；拖拽结束不会触发问候或跳页。
- 同一事件 3 秒内重复到达只反馈一次。
- 快捷动作失败时保留当前页面，并给出可读错误状态。

---

## 7. Obsidian 知识库功能重规划

### K0：Vault 连接、索引与安全底座（必须先做）

**文件范围**：新建 `server/knowledge/paths.js`、`server/knowledge/scanner.js`、`server/knowledge/indexer.js`、`server/knowledge/routes.js`，修改 `server/index.js`、`server/database.js`、`docker-compose.yml`、`.env.example`、部署文档与测试。

- 实现第 5 节的数据表、只读 API、按用户 Vault 映射和统一错误码。
- 新增部署变量：
  - `OBSIDIAN_ENABLED=false`
  - `OBSIDIAN_VAULT_ROOT=/vaults`
  - `OBSIDIAN_SINGLE_USER_ID=`
  - `OBSIDIAN_WRITE_ENABLED=false`
  - `OBSIDIAN_INBOX_DIR=00-Inbox`
  - `OBSIDIAN_MAX_NOTE_BYTES=2097152`
  - `OBSIDIAN_MAX_ATTACHMENT_BYTES=20971520`
  - `OBSIDIAN_RESCAN_INTERVAL_MS=300000`
- 首次扫描以后台任务运行；API 在索引期间返回已有快照和 `indexing:true`，没有快照时返回 `INDEX_BUILDING`，不能阻塞服务器启动。
- 只按 `mtime + size` 选择候选，再用 SHA-256 内容哈希确认变更；删除文件同步清理索引和失效链接。
- `noteId` 由服务端密钥、用户 ID 和规范化相对路径生成 HMAC；数据库中允许保存相对路径，但 API 不返回绝对路径。
- `/api/knowledge/reindex` 增加用户级互斥和限频，同一用户不能并发启动多个重建任务。

**验收**：

- 正常 Vault、空 Vault、目录不存在、权限不足、畸形 Frontmatter、超大文件、符号链接和扫描中断均有自动化测试。
- 路径穿越、双重 URL 编码、大小写变体和跨用户 `noteId` 都不能读取其他文件。
- 1,000 篇普通 Markdown 的增量无变更扫描不重写全部索引；服务器在 Vault 不可用时仍能启动导航主体。
- 删除当前用户索引后可从 Vault 完整重建，业务 bundle 不受影响。

### K1：首页星穹知识舱（MVP）

**文件范围**：`index.html`、新建 `js/knowledge.js`、新建 `js/ui/knowledge.ui.js`、`styles.css`、`styles/astral-ui.css`、`js/sync.js`、测试。

- 顶部“知识库”点击后打开轻量面板，不再直接跳 `/blog`。
- 面板首屏固定包含：搜索框、最近打开、固定笔记、常用标签、索引状态与重新索引入口。
- 搜索 250ms 防抖，少于 2 个字符不请求；每次展示 12 条，最多继续加载到 20 条。
- 点击结果先写入最近记录，再进入导航内置阅读器；用户设置为 `obsidian` 时仍先打开阅读器，由明确按钮唤起 Obsidian。
- 空状态分为“未启用”“Vault 未配置”“正在索引”“没有笔记”“知识服务不可用”，不能统一显示 `Failed to fetch`。
- 首页可选放置紧凑知识卡，只显示最近 3 条；默认开启，可在设置关闭。

**验收**：

- 刷新、跨设备登录后最近打开保持一致，最多 20 条且按 `openedAt` 降序。
- 右侧宽度充足时结果自适应填满面板，不留下无意义固定空列；360–1920px 均无横向溢出。
- 标题、标签、摘要、命中片段不能注入 HTML；搜索乱序响应不会覆盖更新的查询。
- 面板关闭后焦点回到“知识库”按钮，Esc、键盘焦点圈和移动端返回键行为一致。

### K2：安全阅读器、Wiki 链接与附件

**依赖**：K0、K1。

- 阅读器显示标题、Frontmatter 摘要、正文、标签、出链和反链；不暴露绝对路径。
- Markdown、Wiki 链接和标题锚点由服务端解析，站内链接转为 `noteId` 路由；未解析链接显示为不可点击文本。
- 支持 Vault 内 PNG、JPEG、WebP、GIF、SVG（经消毒）和 PDF 下载 / 浏览；其他类型默认仅下载或拒绝。
- 远程 URL 由客户端直接打开，不经过服务器代理；所有外链统一标识并使用安全新窗口策略。
- 桌面端提供“在 Obsidian 中打开”，Web / PWA 若协议不可用仍保留导航阅读器。

**验收**：

- Markdown XSS、恶意 SVG、`javascript:`、HTML iframe、危险 data URL、目录逃逸附件均有安全测试。
- `[[笔记]]`、别名、同名文件、相对路径、标题锚点、失效链接和反链有固定夹具测试。
- 读一篇不存在或刚被移动的笔记返回 404 / unavailable，不落入服务器文件异常页面。
- 大笔记与 PDF 使用大小限制和流式响应，不把整个附件读入 Node 进程内存。

### K3：可选快速收集与桌面深链接

**依赖**：K0–K2；写入功能可独立关闭。

- 增加快速收集弹窗：标题、来源 URL、正文 / 备注、标签；目标固定为服务端配置的 Inbox。
- 保存成功后触发该用户的单文件增量索引，再返回新 `noteId`；失败不产生最近记录或半成品。
- Electron 主进程仅在用户明确点击后放行规范化的 `obsidian://open?vault=...&file=...`，并交给系统 `shell.openExternal`。
- `obsidian:` 白名单只接受 `open` 动作和受控的 `vault` / `file` 参数；继续拒绝其他协议、空 host、控制字符、重复危险参数。
- EXE / DMG 没安装 Obsidian 或系统拒绝协议时显示可恢复提示，导航阅读器仍保持打开。
- PWA / 普通 Web 不自动探测本机应用，也不在页面加载时唤起协议。

**验收**：

- 写入关闭、Inbox 不存在、重名、非法标题、超长内容、磁盘只读和原子 rename 失败都有测试。
- 任意客户端目录字段都被忽略或拒绝；只能写入当前用户固定 Inbox。
- Electron 对 `file:`、`javascript:`、自定义非 Obsidian 协议与畸形 `obsidian:` URL 均拒绝。
- Windows 与 macOS 分别验证中文 Vault 名、空格路径、未安装 Obsidian 和成功打开四种路径。

---

## 8. 宠物 × Obsidian 联动

在 P0、P1、K1 完成后再做，避免提前耦合。

1. 快捷动作“搜知识”：打开知识面板并聚焦搜索框。
2. 快捷动作“继续笔记”：打开最近一篇仍可访问的笔记。
3. 索引中：宠物显示 `syncing / 正在整理星穹知识`；搜索中显示 `working`；完成或失败只短暂反馈一次。
4. 快速收集成功：宠物提示“已放进 Inbox”，点击提示可打开新笔记。
5. 不把搜索词、笔记标题或正文放进宠物持久配置；状态 detail 最多保留于内存 30 秒。

**验收**：

- 关闭首页宠物不会影响知识搜索、阅读和收集。
- 关闭 Obsidian 集成后宠物菜单不显示知识动作，已有其他快捷动作顺序不乱。
- 私有笔记标题不会出现在锁屏通知、浏览器 title、服务器普通访问日志或宠物持久配置中。
- 重建索引的大量进度事件被节流，宠物不会连续弹话气泡或频繁重绘。

---

## 9. 实施波次与依赖

| 波次 | 工作包 | 依赖 | 预期结果 |
|---|---|---|---|
| Wave 1 | P0 宠物引擎 / 存储；K0 Vault 连接 / 索引 | 无，可并行 | 两条功能线都有稳定、安全底座 |
| Wave 2 | P1 伙伴中心；K1 首页知识舱 | 各自依赖 Wave 1 | 用户能配置宠物并在首页检索 Obsidian |
| Wave 3 | P2 轻互动；K2 阅读器 / 链接 / 附件 | Wave 2 | 知识阅读闭环，宠物交互可用 |
| Wave 4 | 宠物 × 知识联动；K3 Inbox / 深链接 | P1、P2、K1、K2 | Web / PWA / EXE / DMG 体验闭环 |
| Wave 5 | 性能、安全、迁移、灰度与发布 | 全部 | 可安全推送、部署与回滚 |

建议先交付 **Wave 1 + Wave 2** 作为 v1.25 MVP；Wave 3 进入 v1.26；K3 和跨平台加固作为 v1.27 发布门槛。写入 Inbox 不阻塞只读 MVP。

---

## 10. 测试与发布门槛

### 10.1 自动化

- 配置迁移：宠物 v2→v3、知识配置默认值、失败回滚、跨设备恢复、旧字段容错。
- 宠物状态机：优先级、TTL、去重、乱序事件、离线恢复、索引事件节流。
- 宠物媒体权限：类型、大小、路径穿越、跨用户读取 / 删除。
- Vault 扫描：新增、修改、删除、重命名、监听丢事件、全量重建、畸形 Frontmatter、超大文件。
- 搜索与隔离：FTS5 / 降级 LIKE、查询边界、摘要转义、跨用户数据、过期最近记录。
- Markdown 安全：脚本、危险 HTML、Wiki 链接、SVG、附件类型、路径逃逸、SSRF 防线。
- Inbox：只读默认、原子写入、重名、失败清理、输入限制、固定目录。
- Electron：Obsidian 协议白名单、显式点击、参数编码、未安装回退和外部链接分流。

### 10.2 页面验收

- 视口：360×800、390×844、768×1024、1366×768、1440×900、1920×1080。
- 输入：鼠标、触摸、键盘；Esc、Tab、Shift+Tab、Enter、Space。
- 主题：亮色、暗色、四套视觉主题、`prefers-reduced-motion`。
- 异常：Vault 未挂载、索引中断、导航 API 停机、慢网、会话过期、宠物图片上传中断。
- 桌面：Windows EXE 和 macOS DMG 中阅读、打开 Obsidian、未安装 Obsidian、离线恢复。

### 10.3 性能预算

- 导航首页启动不等待 Vault 全量扫描。
- 已有索引下 `GET /api/knowledge/search` 的 p95 目标小于 300ms（1,000 篇普通笔记、本机 SQLite）。
- 搜索响应最多 20 条，单条摘要最多 240 字，正文仅在打开笔记时获取。
- 文件监听抖动窗口不低于 500ms，同一文件短时间多次变化合并处理。
- 页面隐藏后宠物动画在 1 秒内停止 RAF，知识面板关闭后取消未完成搜索请求。

### 10.4 灰度开关

```js
{
  petV3Enabled: false,
  obsidianKnowledgeEnabled: false,
  obsidianReaderEnabled: false,
  obsidianWriteEnabled: false,
  obsidianDeepLinkEnabled: false,
  petKnowledgeActionsEnabled: false
}
```

按上表顺序开启。关闭开关必须保留新数据并回退到普通导航状态；旧 `/blog` 如保留，应以“博客”独立入口存在，而不是作为知识库回退。

---

## 11. 安全威胁模型

| 威胁 | 严重度 | 处理与发布门槛 |
|---|---|---|
| 路径穿越 / 符号链接逃逸读取服务器文件 | 高 | `realpath` 根路径约束、禁跟随 symlink、不透明 ID；安全测试未通过不得发布 |
| 跨用户读取笔记或附件 | 高 | 所有查询先绑定会话 `user_id`，不能只按 `noteId` 查；跨用户测试未通过不得发布 |
| Markdown / SVG XSS | 高 | 服务端解析、允许列表消毒、CSP；危险夹具未通过不得发布 |
| 快速收集覆盖或写出 Inbox | 高 | 服务端生成文件名、固定目录、原子新建、不接受客户端路径；默认关闭 |
| 外部资源代理导致 SSRF | 高 | 服务端不抓取远程图片 / 链接，仅代理 Vault 内附件 |
| Obsidian 深链接放宽 Electron 协议边界 | 高 | 只允许显式点击触发的 `obsidian://open` 和规范参数；其余拒绝 |
| Vault 扫描耗尽 CPU / 内存 | 中 | 文件数、大小、并发、频率限制；后台增量索引；首页不等待扫描 |
| SQLite 派生正文扩大备份或泄露 | 中 | 索引不进入业务导出，支持一键按用户清除 / 重建，数据库权限沿用服务端安全策略 |
| 笔记标题进入日志或通知 | 中 | API / 宠物事件日志仅记录 `noteId` 和错误码，普通日志不记录标题、正文、查询词 |
| 商业角色素材版权 | 中 | 内置仅原创；用户上传内容由用户自行授权 |

任何高严重度威胁未完成自动化测试和代码审查时，相关开关保持关闭。

---

## 12. 风险与处理

| 风险 | 处理 |
|---|---|
| Vault 不在服务器 | 在状态页显示部署说明；不尝试从云端回连用户电脑 |
| 用户以为导航会提供 Obsidian Sync | 文档明确：同步工具在项目范围外，导航只读挂载结果 |
| Data URL 迁移放大 bundle 或上传失败丢图 | 上传成功后才切换宠物 v3；保留 v2 直到服务端确认 |
| 大 Vault 首次索引慢 | 后台任务、进度状态、增量索引、文件上限；不阻塞首页 |
| 文件监听丢事件 | 周期校验 + 手动重建兜底；索引是可重建派生数据 |
| 同名 Wiki 链接解析歧义 | 使用当前目录优先和唯一匹配规则；歧义时不自动跳错笔记 |
| 写入导致同步冲突 | 默认只读；固定 Inbox、原子写入、永不覆盖已有文件 |
| 宠物遮挡主操作、移动端耗电 | 安全区碰撞、窄屏禁巡逻、页面隐藏停 RAF、减弱动画静态化 |
| Electron 协议处理扩大攻击面 | 单独严格验证 `obsidian:`，不修改通用外链白名单 |

---

## 13. 开工前产品决策

除非用户后续明确修改，实施时按以下锁定项执行：

1. **宠物定位**：状态伙伴 + 快捷助手，不做养成经济。
2. **知识事实源**：Obsidian Vault；导航 SQLite 只是可重建索引。
3. **部署接入**：服务器目录挂载；Vault 到服务器的同步由部署者自行选择工具。
4. **写入策略**：默认只读；快速收集后置，且只能写固定 Inbox。
5. **阅读策略**：导航内置安全阅读器保证跨端可用；“在 Obsidian 中打开”是桌面增强能力。
6. **原 `/blog` 定位**：如保留则改名“博客”，与 Obsidian 知识库解耦。
7. **内置角色策略**：原创星轨角色 + 用户自定义上传，不直接分发商业游戏角色素材。

---

## 14. 第一批可执行任务

1. 写 `docs/contracts/obsidian-nav-integration.md`，冻结第 4–5 节的目录、索引、API、错误码与安全规则。
2. 为 `PetConfigV3`、状态优先级和 v2 迁移先写失败测试。
3. 新增 `media/pet` 服务端上传、读取、删除、导出与跨用户权限测试。
4. 新增 `server/knowledge/paths.js` 与路径安全测试，先证明任何输入都不能逃出用户 Vault。
5. 新增扫描器、SQLite 派生表、FTS5 索引和重建 / 增量测试。
6. 实现 `/api/knowledge/status`、`search`、`recent`、`notes/:noteId` 的只读 MVP。
7. 将 AI / 同步 / 网络改为显式派发宠物事件，删除 UI class 观察。
8. 完成首页知识舱最小版：状态、最近、固定项、标签和搜索。
9. 完成宠物中心最小版：角色、行为、显示、快捷动作四类设置。
10. 用样例 Vault 在手机、PWA、EXE 和 DMG 完成一轮 UAT，再进入阅读器附件与可选 Inbox 写入。

第一批不启用 Vault 写权限、不实现 AI / 向量检索，也不发布新的桌面安装包；目标是先验证安全只读链路、索引一致性、用户隔离与首页体验。
