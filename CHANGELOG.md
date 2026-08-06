# Changelog

本文件记录 Telegram Private Chat Gateway 的正式版本变化。

## [Unreleased]

### 工程优化

- 消除 `worker.js` 与 `src/utils.js` 重复的 10 个纯函数定义，统一 import（单文件部署仍由 esbuild bundle 完成）。
- `tgCall` 缓存 Telegram 客户端实例，避免每条消息重复创建（并发复用同一 botToken/apiBase 的 client）。
- 提取 `forwardPendingMessageIds` 公共函数，统一本地题库与 Turnstile 回调的待处理消息转发（去重 + 并发 3 + 送达通知）。
- 管理确认回调抽离 `confirmAsk` / `confirmCancel`，消除封禁/关闭/重置 6 处重复块。
- 提取 `readKvBlockedWords`，`/addword` `/delword` `/listwords` 共用 KV 词库读取。
- 媒体组清理阈值改为与 `MEDIA_GROUP_EXPIRE_SECONDS` 常量对齐（原硬编码 5 分钟与 60 秒 TTL 不一致）。
- `cleanProfileText` 上提至 `src/utils.js`，统一话题标题与资料卡文本清理规则。
- ID 白名单解析带实例级缓存，避免每次权限判断重复 split。
- 删除零引用的 `StorageError` 死代码（`src/storage/storage.js`）。
- **消除双栈重复**：删除 `conversation-service.js` 中生产不可达的私聊/管理员消息处理与资料卡（`syncUserProfile`/`buildProfileCard` 等约 600 行），收敛为编辑消息映射/通知单一职责；`buildTopicTitle` 唯一实现归 `worker.js`。
- **主文件拆分**：`worker.js` 由 3457 行降至约 2140 行；新增 `src/admin-actions.js`（管理动作/词库/清理）、`src/verification.js`（题库+Turnstile 验证）、`src/media-group.js`（媒体组合并）、`src/blocked-words.js`（词库共享）、`src/daily-stats.js`（CST 日统计共享）；移除 `getAdminHandlers` 门面与 12 个转手包装器。
- **webhook 单次解析**：`app.js` 解析后的 update 直传业务层，消除双重 JSON 读取/校验；补充「私聊路径失败返回 200 不重试」的刻意设计注释。
- 覆盖率门槛从仅 `src/utils.js` 扩展到 `worker.js` + `src/**`；新增主消息链路集成测试（验证→建话题→转发/媒体组/编辑通知/封禁/屏蔽词/垃圾检测），worker.js 行覆盖 12% → 53%。
- `getUsersByIds` 改单条 IN 查询（消除 N+1）；`secureRandomInt` 拒绝采样消除取模偏差；`getAllKeys` 支持页数上限。
- `Logger` 增加 `onError` 旁路，替换模块级 monkey-patch；删除 `kv-storage` 死模块（唯一调用点改内联 KV 读取）。
- `admin-commands` 的存储访问改为依赖注入、`sysinfoKvCache` 移入实例、看板分页拆分为独立渲染器。
- 测试：新增 `admin-actions` 单测 8 例；`conversation-service` 测试重写为仅覆盖活面。

### 管理体验

- 管理 UI 展示与命令编排拆至 `src/admin-ui-format.js`、`src/admin-commands.js`（行为不变，便于后续迭代与单测）。
- 关闭对话、重置验证与封禁一致支持二次确认（面板按钮与 `/close` `/reset` 文本命令）。
- 今日活跃/统计空数据增加可操作引导；修复管理菜单「屏蔽词」回调未注入 listwords 的问题。
- `/stats` 近 7 日标注峰值日；概览页提示最近错误条数；错误页补充排查提示。
- 用户面板状态与备注提示更清晰；私聊 `/help` 补充静音/封禁通知说明。
- 人机验证文案统一（Turnstile / 本地题库 / 过期 / 答错 / 成功）；答错时在题目下追加可继续选择的提示。
- 管理面板执行封禁/关闭/静音/信任/重置等后自动再发一份最新 `/panel` 状态。
- 用户侧拦截/限流/封禁静音/关闭会话等文案集中到 `user-copy.js`，与验证文案分层。
- 屏蔽词命令与列表、清理报告、spam 通知、转发失败告警统一 HTML。
- `/find` 状态中文标签；`/whoami` 更清晰；菜单按钮标签优化；面板展示最近消息与 D1 状态。
- Turnstile 网页成功/过期提示与私聊验证口径对齐；pending 消息送达通知使用 HTML。
- 新增 `/panel` 用户快捷按钮面板；`/info` 附带操作按钮与备注/静音/最近消息。
- `/sysinfo` 分页：概览 / 存储 / 错误 / 今日统计 / 活跃，带刷新按钮。
- 新增 `/menu` 管理首页按钮；`/stats` `/rank` `/notes` `/whoami` `/find` `/note` `/mute` `/unmute`；Owner `/synccommands`。
- 今日活跃：入站消息排行（奖牌）、小时热力条（展示为中国时间 CST）、高峰时段；无 message_links 时用 KV 小时桶与 last_message 兜底。
- **日切统一为 CST（UTC+8）**：日统计 KV 键、活跃窗口、昨日对比均按中国日历日；`/stats` 增加近 7 日入站 sparkline。
- `/stats` 显示较昨日增量；活跃页避免重复查库；排行/备注跳转按钮双列更紧凑。
- `/notes 关键词` 扫描管理员备注；`/find` 与排行结果可一键打开用户面板；菜单增加「查找」用法提示。
- 修复排行展示在仅有用户名时出现重复 `@user @user` 的问题。
- 封禁与清理支持二次确认；`/ban` 文本命令与按钮一致需确认；时间显示相对时间；非管理员误发指令有提示。
- `OWNER_IDS` 视为管理权限（无需同时是群管理员）；管理回调校验 userId、防重复 answer、失败可提示。
- 修复 `isOwnerUser` / Owner 配置检测对数组误用 `.has`/`.size` 导致 Owner 判断抛错的问题。
- 关闭/打开会话在无 KV 记录时也会写状态并反馈；操作提示统一 HTML。
- 私聊 `/help` 对普通用户可见；封禁/静音会通知用户；话题标题缺资料时自动补全与修复。
- README / 运维文档补充管理命令速览。

### 界面与文案打磨

- 清理流程消息统一 HTML 渲染（原 `parse_mode: "Markdown"` 的 `**粗体**`/反引号会因未转义而显示异常），错误信息经 `escapeHtml` 后展示。
- 用户侧「管理员修改了回复」、管理侧「用户修改了消息」「用户编辑已拦截」编辑通知文案集中到 copy 模块，保持纯文本渲染。
- 管理状态操作反馈（静音/备注/关闭/重置/信任/封禁/解封）与回调 toast（无权限/已更新/已取消等）统一收编至 `ADMIN_COPY`，全项目 Telegram 消息文案单一来源。
- 验证限流提示入 `VERIFY_COPY`，窗口秒数常量化（300s ↔「5 分钟」）防止文案与配置漂移；自动送达失败提示集中。
- 答错提示追加判断改为引用提示常量本身，消除「回答不正确」魔法字符串，文案调整不再破坏幂等逻辑。
- 验证日志不再记录题目文本，日志去敏边界收紧。

### 文档与发布

- 部署文档仅保留 **dist 单文件手动粘贴到 Cloudflare Worker** 路径，移除 Wrangler/Git 自动部署作为推荐方式。
- 配置、运维、安全、开发文档统一为 Dashboard 配置 Bindings 与 Variables。
- 新增提交钩子：变更源码时 pre-commit 自动 `npm run build:single` 并 stage `dist/worker.single.js`。
- `/listwords` 增加展示环境变量 `SPAM_KEYWORDS` 一节，避免与动态屏蔽词混淆。
- 同步 README / README_EN / architecture / development / operations / security / Claude.md：管理模块拆分、CST 日切、命令速查、`OWNER_IDS` 管理权限与文案模块边界。

## [1.0.0] - 2026-07-11

### 核心能力

- 将 Telegram Bot 私聊接入独立 Forum Topic，并支持管理员双向回复。
- 提供 Turnstile 和本地题库人机验证流程。
- 提供关键词、链接、重复消息和 D1 动态规则内容策略。
- 提供 Owner、Operator 和 Rules Manager 角色权限。
- 提供用户资料卡以及信任、封禁、关闭和静音操作。

### 安全

- 使用至少 32 字节的 Telegram Webhook Secret Token 验证请求。
- 限制公开 POST 请求体为 1 MiB，并校验 JSON Content-Type。
- 对 Telegram API Base URL、Callback 数据、规则类型和动作使用白名单。
- 对验证页面参数执行 HTML 转义，并配置 CSP 和脚本 nonce。
- 对日志中的凭据、消息正文、caption 和验证挑战标识进行递归脱敏。

### 数据与可靠性

- 使用 Cloudflare D1 保存用户、Topic、消息映射、规则、管理员和审计等长期状态。
- 使用 Cloudflare KV 保存验证、速率限制、管理员缓存和 Topic 健康等短期状态。
- 使用 D1 Update 声明实现 Telegram Update 幂等处理。
- 使用实例内合并与 D1 Topic Lock 防止并发重复创建 Topic。
- 使用原子部分更新避免并发资料同步覆盖用户状态。
- 使用 Cron 按 7、30、90 天保留期清理幂等记录、消息映射和管理员审计。

### 开发与运维

- 提供单元测试、集成测试、覆盖率检查和 Mock KV/D1/Telegram 环境。
- 提供结构化日志、Cloudflare Observability 示例和发布检查清单。
- 提供从零部署、配置、架构、安全、运维和开发文档。
- 提供 `npm run sync-docs` 自动生成函数、CONFIG 和 KV 键名索引。
- 提供 `npm run build:single` 生成可粘贴的 `dist/worker.single.js`。
