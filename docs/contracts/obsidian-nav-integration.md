# Obsidian × 闲然导航接入契约

**版本**：1
**状态**：Wave 1–3 已实现
**事实源**：服务器挂载的 Obsidian Vault

## 部署边界

- 闲然导航不实现 Obsidian Sync，只读取服务器上已经同步完成的 Vault。
- `OBSIDIAN_ENABLED=false` 为默认值；关闭时知识 API 返回 `OBS_DISABLED`，导航其他功能照常启动。
- 多用户模式使用 `<OBSIDIAN_VAULT_ROOT>/user-<userId>`；目录由服务端根据登录用户决定，前端不能传路径。
- 单用户模式设置 `OBSIDIAN_SINGLE_USER_ID=1` 后，`OBSIDIAN_VAULT_ROOT` 本身就是该用户的 Vault。
- Docker 默认以只读方式把 `OBSIDIAN_VAULT_HOST_PATH` 挂到 `/vaults`。

## 环境变量

| 名称 | 默认值 | 约束 |
|---|---:|---|
| `OBSIDIAN_ENABLED` | `false` | `true/false` |
| `OBSIDIAN_VAULT_ROOT` | `/vaults` | 服务端绝对路径 |
| `OBSIDIAN_SINGLE_USER_ID` | 空 | 正整数；空表示多用户目录模式 |
| `OBSIDIAN_WRITE_ENABLED` | `false` | 当前不开放写入接口 |
| `OBSIDIAN_INBOX_DIR` | `00-Inbox` | 为后续固定 Inbox 写入预留 |
| `OBSIDIAN_MAX_NOTE_BYTES` | `2097152` | 1 KiB–20 MiB |
| `OBSIDIAN_MAX_ATTACHMENT_BYTES` | `20971520` | 1 KiB–200 MiB |
| `OBSIDIAN_MAX_FILES` | `20000` | 1–200000 |
| `OBSIDIAN_RESCAN_INTERVAL_MS` | `300000` | 30 秒–24 小时 |

## 扫描与索引

- 只扫描 `.md`，忽略点目录、`.obsidian`、`.trash`、`.git` 与符号链接。
- 每个真实路径必须仍位于当前用户 Vault 内。
- 使用 `mtime + size` 跳过未变化笔记；变化后再计算 SHA-256。
- SQLite 表 `obsidian_notes`、`obsidian_links`、`obsidian_assets` 都是可重建派生数据，不进入用户业务 bundle。
- 优先使用 FTS5 trigram；运行环境不支持时自动使用带转义的 `LIKE` 搜索。
- `noteId` 使用服务端密钥、用户 ID 和规范化相对路径生成 HMAC，不暴露绝对路径。
- 文件移动且内容哈希唯一时复用旧 `noteId`，尽量保留最近记录。

## 只读 API

所有接口都要求当前导航登录会话。

| 方法与路径 | 成功响应 |
|---|---|
| `GET /api/knowledge/status` | `{ enabled, configured, writable, indexing, noteCount, lastIndexedAt, errorCode, taskId, issueCount }` |
| `GET /api/knowledge/search?q=&limit=` | `{ items, query, limit }`，`limit` 最大 20 |
| `GET /api/knowledge/tags?limit=` | `{ items:[{tag,count}] }` |
| `GET /api/knowledge/config` | 当前用户知识舱显示偏好与固定笔记摘要 |
| `PATCH /api/knowledge/config` | 更新固定项、最近查询与打开偏好；不接受路径 |
| `GET /api/knowledge/notes/:noteId` | 安全结构化文档、元数据、出链、反链和附件摘要；不返回原始 Markdown 或路径 |
| `GET /api/knowledge/attachments/:assetId` | 登录态附件代理；PNG/JPEG/WebP/GIF/PDF 流式返回，SVG 检查后返回 |
| `GET /api/knowledge/recent?limit=` | 当前用户最近记录，失效项带 `available:false` |
| `POST /api/knowledge/opened` | `{ ok:true }`，请求 `{ noteId }` |
| `POST /api/knowledge/reindex` | HTTP 202，`{ ok, taskId, existing }`；每用户 30 秒限频 |

`GET /api/knowledge/notes/:noteId` 返回版本化的安全文档模型。前端只通过 `createElement`、`createTextNode` 和 `textContent` 生成标题、段落、列表、引用、代码、站内笔记按钮、外链及附件，不使用 `innerHTML`。站内链接只携带不透明 `noteId`，外链只允许 HTTP/HTTPS 并统一使用 `noopener noreferrer`。

## 统一错误码

| HTTP | 错误码 | 含义 |
|---:|---|---|
| 400 | `INVALID_QUERY` | 搜索词为空或超过 120 字 |
| 400 | `UNSAFE_PATH` | 路径逃逸或符号链接 |
| 404 | `VAULT_NOT_CONFIGURED` | 当前用户没有 Vault |
| 404 | `NOTE_NOT_FOUND` | 笔记不存在或不属于当前用户 |
| 404 | `ATTACHMENT_NOT_FOUND` | 附件不存在或不属于当前用户 |
| 409 | `ATTACHMENT_CHANGED` | 附件已变化，需要重新索引 |
| 429 | `REINDEX_RATE_LIMITED` | 30 秒内重复手动重建 |
| 415 | `UNSAFE_ATTACHMENT` | 附件类型或 SVG 内容不安全 |
| 503 | `OBS_DISABLED` | 服务端未启用 Obsidian |
| 503 | `INDEX_BUILDING` | 首次索引尚未生成可读快照 |
| 500 | `KNOWLEDGE_ERROR` / `INDEX_FAILED` | 受控内部错误；响应不暴露服务器路径 |

## 安全不变量

1. 所有数据库查询同时绑定 `user_id` 和不透明 ID。
2. API 不接受 Vault 绝对路径、相对路径、`file://` 或远程抓取目标。
3. 符号链接不进入扫描结果；路径解析必须通过 `realpath` 根目录约束。
4. Frontmatter 只收集允许的安全字段，不执行 Dataview、Templater 或任何插件代码。
5. 原始 Markdown 和 HTML 不进入浏览器响应；服务端先生成受限结构化文档，危险协议与未解析目标退化为普通文本。
6. 附件查询同时绑定 `user_id + asset_id`，发送前重新验证真实路径、大小、类型与 SHA-256；SVG 拒绝脚本、事件属性、外部引用、动画和嵌入对象。
7. 所有附件响应设置 `nosniff`、私有缓存、受限 CSP；普通图片与 PDF 不整块载入 Node 内存。
8. Vault 不可用、索引失败或功能关闭均不能阻塞导航主服务启动。
