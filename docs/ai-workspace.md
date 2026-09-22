# AI 工作区

AI 面板顶部切换对话、生图、生视频。关闭面板不停止任务；提示词、参考图和各模式的供应商选择保存在现有 AI 设置中。图库原来的生图入口跳转到新工作区，成功图片继续同步到图库。

图片支持 Images（文生图、multipart 图生图）、Responses（文本驱动、SSE 预览）、Gemini 原生（含参考图）、百炼原生文生图。接口协议是独立配置；模型列表只是候选建议。百炼图生图仍不支持。旧生图配置迁移时保留尺寸、质量、张数与模型，并恢复原有 Gemini／百炼路由意图。

首期视频仅开放 `grok-imagine-video`，使用 New API 的 `POST /v1/video/generations` 与 `GET /v1/video/generations/:task_id`。图生视频最多一张参考图；视频参数留空时不发送，由上游决定默认值。供应商地址可以包含或省略 `/v1`。不自动尝试其他协议或切换供应商。

## 模块边界

- `js/ui/ai.ui.js` 保留 app 的工厂入口，协调聊天、归档、设置、生成四个模块。
- `js/ui/ai-conversation.ui.js` 与 `styles/ai-conversation.css` 负责会话侧栏、标题与模型工具栏、输入区和手机抽屉，不另建聊天数据源。
- `js/ai-tasks.js` 封装带登录态的任务、参考素材及结果读取。既有 `AI.generateImage`／`AI.generateImageEdit` 也走任务服务。
- `js/ai-image-api.js` 是依赖注入的图片协议模块。服务端调用单次提交方法，不隐式重试生成。
- `server/ai/` 分离 HTTP 路由、任务执行与上游适配；SQLite 与媒体文件继续使用 nav 的数据目录。

## nav 接口

所有 `/api/ai/*` 接口需要当前 nav 用户的 Bearer token，返回 `Cache-Control: private, no-store`。

| 接口 | 请求／结果 |
| --- | --- |
| `POST /api/ai/tasks` | `{type, providerId, model, prompt, params, referenceIds, idempotencyKey}` → 202 任务记录 |
| `GET /api/ai/tasks?type=image&limit=30&offset=0` | 当前用户任务，按创建时间降序分页；type 可省略 |
| `GET /api/ai/tasks/:id` | 当前任务、预览、错误与结果素材 |
| `POST /api/ai/tasks/:id/cancel` | 取消队列或停止本地执行／查询，不承诺上游取消 |
| `POST /api/ai/tasks/:id/retry` | `{idempotencyKey}`；重试保存、恢复已有上游 ID 查询，或创建关联的新任务 |
| `POST /api/ai/assets` | `{dataUrl}` 上传图片参考素材，返回 `{id,mime,url}` |
| `GET /api/ai/assets/:id/content` | 验证所属用户后返回文件，支持 Range；`?download=1` 下载 |

图片参数：`apiMode`、`size`、`quality`、`n`、`textModel`；视频参数：`apiMode: "newapi"`、可选 `duration`、`width`、`height`。服务端通过用户配置读取密钥，任务记录不复制密钥。

## 状态与恢复

任务先落库，再进入最多两个并发执行槽。状态为 `queued → submitting/running → saving → succeeded`。出错区分 `failed`、`unknown` 和 `save_failed`；用户停止为 `cancelled`。

- 浏览器关闭或刷新不影响服务端执行。恢复查询不会重新生成。
- 服务重启时恢复队列、已有异步任务 ID，以及尚未保存完的素材；同步请求无法恢复时标记结果未知，不自动重新提交。
- 提交响应丢失时，浏览器保留幂等键。上游是否受理不明确的任务需要用户明确点击重新生成。
- 查询临时失败退避重试，任务每次执行最多等待 30 分钟。已保留上游 ID 的任务之后仍可手动恢复查询。
- 保存失败重用已完成输出，不调用生成接口。中间预览与最终结果分别标记。
- 图片最大 20 MiB，视频最大 200 MiB；仅接受列出的图片／视频 MIME，远程下载验证公网地址、重定向和大小。
- 新增的 `ai_tasks`／`ai_assets` 与 `media/ai` 纳入现有导出导入；执行任务期间导入返回 409，避免替换正在写入的数据库。

## 验证与发布

对话界面更新（2026-09-17）：桌面直接新建、搜索和切换会话，手机使用抽屉；正文与固定输入区分开滚动。草稿按会话保存，当前会话 ID 一并写入 AI 设置以便刷新恢复。生成期间锁定重复发送、模型切换和会话切换，仍可输入下一条草稿；停止保留已有文字。向上阅读时暂停跟随，可点「最新消息」返回。历史管理、茶话会、图库、图片和视频生成继续复用原模块。

新增 `tests/ai-conversation.test.js` 验证并发发送保护、停止后的部分回复保留、会话切换期间发送保护。浏览器验收使用临时数据库和模拟回复，不调用真实供应商；覆盖输入法、草稿、搜索、重试、滚动、深色与手机抽屉。源码改动需要另行部署后才会出现在运行中的站点。

`npm test` 包含任务幂等、用户隔离、取消竞态、重启恢复、保存重试及多协议模拟测试。浏览器验收使用临时数据库、模拟生成响应和本地视频测试素材，检查模式切换、草稿恢复、参考图、流式对话、图片读取、视频播放、Range 与手机／深色布局。

部署需要同时更新前后端并重建 nav 容器；`deploy/Dockerfile` 和独立 API Dockerfile 都已包含新模块。数据库建表为增量操作，旧设置、聊天及图库保留。Service Worker 已更新缓存版本。

没有调用现网供应商生成媒体，也没有改动或部署 New API／grok2api。模拟适配测试通过不代表现网模型或路由可用；现网缺失接口会在任务记录中显示错误，不能静默替换协议。
