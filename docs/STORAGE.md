# 存储方式

项目的业务数据不应长期存放在浏览器中。推荐运行方式是 Node/Docker 同源服务端模式，此时前端通过 `/api/data` 读写服务端 SQLite，媒体文件存放在服务端数据目录的 `media/` 子目录中。浏览器本地仅保留登录会话等短期状态，旧版 localStorage/IndexedDB 数据会在设置的“数据管理”中标记为遗留数据。

SQLite 文件默认位于 `DATA_DIR/sakura.db`。主要表包括 `app_data`、`media_files`、`ai_settings` 和 `data_snapshots`。`app_data` 存储 `sakura-nav@2` 结构的整包 JSON；`ai_settings` 独立保存 AI 供应商与人设设置，避免混入浏览器本地；`data_snapshots` 保存快照 payload、校验和、大小与创建时间。

媒体文件通过 `/api/media/bg`、`/api/media/music`、`/api/media/lrc` 上传，并通过 `/api/media/file/{category}/{filename}` 读取。设置页的媒体清理会扫描当前 bundle 中引用的媒体 URL，再和磁盘清单比对，只允许删除未被当前数据引用的孤儿文件。

备份分两层：快照用于服务端内快速恢复，ZIP 导出用于跨设备迁移。快照支持整包恢复，也支持按分类恢复，例如只恢复 `nav`、`settings` 或 `calendar`。ZIP 导出包含 SQLite 和媒体目录，导入会替换当前服务端数据，适合换机器或 Docker 数据卷迁移。
