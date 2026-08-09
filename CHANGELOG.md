# Changelog

## [Unreleased]

### 一致性

- **命令参数提取统一**：新增 `commandArgument(text, command)`，`/addword` `/delword` 不再使用 `slice(9)`（不支持 `@bot` 后缀），`/note` `/find` `/notes` 一并接入，消除命令前缀长度漂移。
- **通知键收敛**：`ban_notice` / `mute_notice` / `cmd_hint` / `cmd_unknown` 前缀统一由 `noticeKey` 构造函数生成，worker 与 admin-actions 共用。

### 体验

- **验证页移动端安全区适配**：`viewport-fit=cover` + `env(safe-area-inset-*)` 安全区 padding，适配刘海屏。
- **验证页成功态聚焦返回按钮**：键盘/读屏器用户验证成功后可直接回车返回 Telegram。
- **管理帮助突出来源**：`/help` 管理帮助末尾加入可点击项目地址，与 `/sysinfo` 页脚一致。

### 健壮性

- **媒体组 caption 归属改进**：首项无效被过滤时，caption 自动落到第一个有效项，不再丢失。

### 测试

- 新增：`POST /` webhook 超限 413 边界、`readEnvValue` trim 别名与空字符串回退、`commandArgument` 参数提取、媒体组 caption 迁移、管理帮助来源行。

### 行为与体验

- **`/start` 深链参数不入待转发队列**：`/start <payload>` 验证通过后不再把指令文本转发给管理员，只触发验证流程。
- **v1 资料卡回执显示新状态**：`v1:user:*` 回调回执由笼统「已处理」改为按动作显示结果（已封禁/已解封/已信任/已取消信任/已关闭对话/已打开对话/已静音/已取消静音）。
- **未知指令一次性提示**：普通用户私聊发送未识别指令时，每小时最多一次提示「发送 /help 查看可用功能」，不再静默丢弃。
- **`/start` 深链参数修复**：`/start <payload>`（Telegram 深链）不再被指令拦截分支静默丢弃——未验证用户点深链可正常触发验证，已验证用户视为无操作命令不转发。

### 健壮性

- **Webhook 响应统一 `no-store`**：`update-router` 的 200/400/500 响应统一禁用缓存，错误与确认均不被边缘缓存复用。

### 一致性

- **转发失败分类复用**：`handleForwardFailure` 的「chat not found」判断改用 `classifyTelegramError` 分类结果，替换手写描述匹配，与 `telegram-client` 共用同一分类源。

### 配置与常量

- **Turnstile 验证超时命名**：`verifyTurnstileToken` 的 10s 硬编码超时收敛为 `TURNSTILE_VERIFY_TIMEOUT_MS`。
- **spam 统计保留期命名**：spam 分类统计的 30 天 KV TTL 收敛为 `SPAM_STATS_TTL_SECONDS`。
- **存储页分页上限命名**：`countKvPrefix` 的 20 页上限收敛为 `KV_COUNT_MAX_PAGES`。

### 测试与质量

- **覆盖率阈值上调**：`vitest.config.js` 阈值由 funcs 50 / lines 45 / branches 40 上调至 funcs 75 / lines 65 / branches 55（实际 81 / 72 / 65），锁定后续测试覆盖不回落。
- **测试补充**：`note` 500 字符截断、验证页未知错误码兜底、`chat not found` 转发失败处理、未知指令提示与深链验证、保留期边界、`claimUpdate` 处理中重复投递、验证页失败可重试。

### 文档

- **README 命令速览补全**：中英文 README 补充 `/note`、`/cleanup` 行，与运维指南对齐。

### 性能

- **Webhook 请求体单次读取**：`validateTelegramWebhookRequest` 校验通过后直接返回解析后的 Update，`routeUpdate` 复用结果，消除此前每条 webhook 二次 `clone().json()` 的读取与解析；密钥校验仍保持在最前，未认证请求不泄露 env 在位信息。

### 健壮性与安全

- **Telegram 错误分类扩充**：`classifyTelegramError` 新增 `chat_not_found` / `user_not_found` / `message_missing` / `message_too_long` 分类，日志与重试决策更可操作。
- **HTTP 错误/诊断响应统一 `no-store`**：Webhook 校验错误、404、500 与 `/health/env`、`/health/d1` 响应统一禁止缓存，防止错误被边缘缓存复用。

### 体验

- **验证页成功态隐藏验证组件**：验证通过后 Turnstile 挂载点隐藏，避免用户重复点击或误以为仍需验证。

### 文档

- **可调项补充**：`operations.md` 可调项表新增 `RETRY_COUNT_TTL_SECONDS`。
- **脱敏说明同步**：`security.md` 日志脱敏键清单补充通用凭据字段（`token`/`phone`/`password`/`api_hash` 等）与 32 KiB 单条截断。

### 工程重构

- **假条件移除**：`/sysinfo`「Worker 运行中」不再使用恒真的 `statusChip(true)`，改为直接陈述。
- **测试补充**：网络重试超出总时限立即放弃、`validateTelegramWebhookRequest` 返回解析结果、非法 JSON 400、错误响应 `no-store`、错误分类稳定。

### 来源突出

- **部署产物突出来源**：验证页（成功页与错误页）页脚、管理看板 `/sysinfo` 每页页脚均加入可点击的 GitHub 项目地址；README 双语顶部补充「项目地址」行。仓库 URL 收敛为 `src/utils.js` 的 `GATEWAY_REPO` 单一来源（验证页 / worker / 管理命令共用）。

### 行为与文案

- **资料快照写入后移**：`saveUserProfileSnapshot` 移到限流检查之后，被限流的消息不再触发 KV 写。
- **系统繁忙文案统一**：`USER_COPY.systemBusy` 与 `VERIFY_COPY.systemError` 统一为「系统繁忙，请稍后重试。」，测试锁定两处一致。
- **已验证用户 `/start` `/cancel` 不再转发**：无操作命令不再进入管理话题，未验证用户发 `/start` 仍正常触发验证。
- **编辑消息被拦截同步提示用户**：用户把消息编辑成违规内容时，除管理员收到拦截原因外，用户侧也收到与新消息拦截一致的提示。

### 配置与常量

- **重试计数 TTL 收敛**：话题健康重试计数有效期由硬编码 `3600` 收敛为 `CONFIG.RETRY_COUNT_TTL_SECONDS`。
- **降级扫描页数命名**：`updateThreadStatus` 全量反查页数上限收敛为 `TOPIC_SCAN_MAX_PAGES`。
- **验证页错误文案收拢**：缺参/未配置/重发引导三句文案移入 `VERIFY_COPY.pageErrorMissingParams`。

### 健壮性与安全

- **scheduled 错误捕获**：定时任务失败经 `Logger.error('scheduled_failed')` 进入系统错误缓冲（`/sysinfo` 错误页可见），不再产生 waitUntil 未处理拒绝。
- **`ensureMigrations` 非对象 db 守卫**：误配为字符串的 `TG_BOT_DB` 直接给出明确错误，修复此前 `WeakMap.set` 抛错并留下孤儿未处理拒绝的缺陷。
- **健康响应禁缓存**：`/` 与 `/health` 响应加 `Cache-Control: no-store`，避免存活检查被边缘缓存污染。
- **日志脱敏键扩充**：新增 `token`/`secret`/`phone`/`password`/`auth_key`/`api_hash`/`access_hash`/`session_key`/`private_key` 等精确键名脱敏。

### 工程重构

- **`formatUserName` 统一姓名拼接**：兼容 Telegram（`first_name`/`last_name`）与 D1（`firstName`/`lastName`）双形态，面板/资料卡/看板共用。
- **截断逻辑收敛**：`truncateText` 上移纯函数基座 `src/utils.js`，编辑通知与按钮标签共用同一截断规则。
- **双语 README 核对**：中英文 README 命令表与部署章节确认无漂移。

### 功能一致性

- **动态规则对新消息生效**：新消息路径统一走 `evaluateLegacyPolicy`，D1 存储规则（`blocked_keyword` / `auto_reply` 等）此前仅对编辑消息生效，现与新消息路径共用同一策略评估；屏蔽词命中日志对 D1 规则改为记录规则 ID，避免越界取词。
- **话题健康重试计数接通**：`retry:userId` 计数器此前只读不写（上限分支为死代码），现由 `checkThreadHealth` 在连续未知错误时累计（1 小时 TTL），达到 `MAX_RETRY_ATTEMPTS` 后暂停转发并提示用户；健康探测成功时自动清零。
- **`/find` 搜索通配符转义**：`searchUsers` 的 LIKE 查询将 `_`、`%` 视为字面量（`ESCAPE '\'`），修复下划线用户名被单字符通配符误匹配的问题。
- **话题状态降级扫描分批并发**：`forum_topic_closed/reopened` 触发全量反查时改为每批 20 并发读取，避免降级路径逐条串行等待 KV 拖垮请求。

### 工程重构

- **管理命令清单统一**：私聊拦截与群内权限提示共用 `isAdminCommandText`，删除两处手工维护的相同正则。
- **区块映射共享**：`activity-summary` 抽取 `toBlockLevels`，sparkline 与小时热力共用同一 8 档映射。
- **`/find` 用法文案收拢**：空查询提示与导航卡片共用 `ADMIN_COPY.findUsage`。
- **日志长度上限**：单条日志截断至 32 KiB 并追加 `…[truncated]` 标记，防止超长负载撑爆 Cloudflare 日志配额。
- **mock KV 分页语义修复**：测试用 KV `list` 改为按游标推进，修复数据超过 limit 时调用方分页死循环的隐患。

### 文档

- **移除「项目状态」段**：README 与 README_EN 删除过时（仍写 `1.0.0`）的项目状态清单，预发布验证提示并入安全提示；docs 各篇去除「本文说明/面向…」样板开头；CLAUDE.md 移除过时版本陈述。

### 验证页体验

- **失败/加载态可返回**：验证页「返回 Telegram」按钮由仅成功显示改为始终可见，用户误入页面或验证失败时可随时返回，不再被卡在页面。
- **排障信息与用户文案分离**：Turnstile 组件错误只向用户展示友好提示，错误码与修复建议（域名授权/Site Key/CSP 等部署细节）折叠进「技术详情」供管理员排障，不再直接暴露给终端用户。
- **页脚收敛**：页脚不再直接展示用户 ID 与验证码（转为 data 属性承载，防调试信息泄露），新增随状态更新的状态行（正在验证/已完成可关闭/未完成可重试）；页面标题随验证状态切换，便于多标签页识别。
- **验证页与回调禁用缓存**：`/verify` 页面与 `/verify-callback` JSON 响应统一 `Cache-Control: no-store`——验证 code 单次有效，防止浏览器/Telegram 内置浏览器复用旧页面导致过期误判。

### 文案与一致性

- **`/help` 限流时长注入**：FAQ 中「请稍等约 1 分钟再发」改为按 `RATE_LIMIT_WINDOW` 动态生成，消除与配置漂移。
- **限流文案明确「未送达」**：消息发送限流提示补充「本次消息未送达」，避免用户误以为消息已发出；验证限流文案与消息限流统一「约 X 分钟」口径。
- **私聊帮助正文收拢**：`/help` 全文移入 `USER_COPY.helpText()`，无权限提示、话题未关联提示、清理确认、`/find` 导航等散落文案统一收拢到 `USER_COPY`/`ADMIN_COPY`，单一来源防漂移。
- **二次确认文案去重**：封禁/关闭/重置的确认卡片与取消回执收敛到 `admin-ui-format.js`（`confirmBanText`/`confirmCloseText`/`confirmResetText`/`dangerCancelText`），文本命令（`/ban` `/close` `/reset`）与面板回调（`adm:u:*ask`）共用同一来源；两处清理确认文案统一为 `CLEANUP_CONFIRM_TEXT`。

### 通知与友好度

- **骚扰告警附带消息片段**：spam 管理员告警新增截断（120 字符、先截断后转义）的消息正文片段，管理员无需点开消息即可判断拦截是否合理。
- **普通用户发管理指令有引导**：用户私聊发送已知管理指令时，每小时最多一次友好提示「该指令仅供管理员在超级群话题内使用」，不再静默丢弃。

### 性能与资源

- **profile 快照写去重**：`saveUserProfileSnapshot` 增加同 isolate 指纹缓存（5 分钟 TTL），资料未变化时不再每条消息重复写 KV（原每私聊消息一次 30 天 TTL 写入）。
- **媒体组过期清理概率化**：`flushExpiredMediaGroups` 由每条消息必扫改为按 `MEDIA_GROUP_CLEANUP_PROBABILITY`（默认 5%）抽样执行——媒体组键自带 60s TTL，孤儿键极少，避免每条消息都触发一次 KV list。
- **入站统计异步写入**：`messages_in` 日统计由用户可见链路上的 `await` 改为 `ctx.waitUntil` 异步写入，消除转发前的 KV 读改写等待。

### 工程重构

- **spam 检测抽取独立模块** `src/spam.js`：关键词/链接/重复检测、管理员告警与统计从 worker.js 迁出（含关键词与消息哈希缓存状态），worker.js 由 2075 行降至约 1885 行，行为不变。
- **每小时通知模式抽取**：封禁/静音每小时提示收敛为 `sendHourlyNotice` 公共函数（统一错误日志）；「User」占位话题标题等魔法字符串常量化。
- **依赖方向整理**：`escapeHtml` 定义上移纯函数基座 `src/utils.js`（admin-ui-format re-export 保持兼容），验证页与验证模块不再反向依赖管理 UI 模块；`legacyApp.fetch` 移除对已 normalize env 的重复二次规范化。
- **日志健壮性**：`logger` 引入 `safeStringify`（BigInt/循环引用等不可序列化值不再抛异常）、`errorMessage` 归一化（非 Error 错误值安全落日志），输出路径 try/catch 兜底，日志异常永不拖垮业务。
- **问答键盘构建去重**：验证题目发送与答错追加提示共用 `buildQuizKeyboard` 纯函数，消除两处构造逻辑漂移；worker.js 清理 5 个未使用导入。
- **日志卫生**：`admin_check_failed` 补充错误详情；`private_message_failed` 与 `admin_reply_failed` 补充 `updateId` 关联维度。
- **管理面板微调**：用户跳转按钮超长用户名截断追加省略号；排行封禁/关闭徽标判断抽为 `statusBadge` 函数，消除嵌套三元。
- **验证页可访问性**：新增 `prefers-reduced-motion` 减弱动态（关闭加载动画）、`format-detection` 关闭电话号码自动识别（防验证码误识别）、装饰图标对读屏器隐藏（`aria-hidden`）。
- **占位标题检测统一**：`isPlaceholderTopicTitle` 收敛 worker.js 与 admin-actions.js 两处相近但不同的「User 占位标题」规则，单一来源防漂移。
- **错误条目归一化共享**：`normalizeRecentErrorItem` 抽取到 `src/utils.js`，`recordSystemError` 与错误看板共用同一套截断规则。
- **清理报告文案收拢**：`/cleanup` 完成报告（统计/列表/截断）统一由 `ADMIN_COPY.cleanupReport` 生成，转义内聚。
- **随机 ID 去偏差**：`secureRandomId` 上移至 `src/utils.js`，改用与 `secureRandomInt` 一致的拒绝采样，消除取模偏差。
- **策略校验与正则编译缓存**：`message-policy` 对同一「类型/模式/动作」规则只完整校验一次，正则按 pattern 复用编译结果——热路径上每条消息 × 每条规则不再重复执行 ReDoS 启发式扫描与编译。
- **重试超限文案**：新增 `USER_COPY.retryExceeded`，区分于通用 `systemBusy`，提示用户稍后重试或联系管理员。
- **媒体组单测覆盖**：`extractMedia` 各媒体类型、合并发送、过期清理独立单测，不再只依赖集成链路。

### 测试

- 新增 `tests/unit/spam-module.test.js`（11 例：重复检测/关键词/链接窗口/prune/统计/告警文案）；`verify-page` 增加返回按钮可见、排障折叠、页脚收敛断言；`admin-ui-format` 增加截断省略号与状态徽标断言；消息链路增加 profile 写去重集成测试。spam.js 行覆盖 85%，verify-page/utils 100%。

### 打磨优化

- **管理命令 KV 读取并发化**：话题反查降级扫描改为单次 list 取 200 键 + 每批 20 并发读（原无上限分页后再截断、逐条串行读）；`/notes` 备注分批并发读取；存储页 11 个 KV 前缀计数并行统计，缩短命令响应延迟。
- **系统错误 KV 写入节流**（30 秒窗口）：错误风暴期间内存环形缓冲全量保留，KV 尽力写入降频，避免放大 KV 写入成本。
- **spam 统计并行化**：各原因计数并行写入，缩短 waitUntil 内滞留时间。
- **抽取 `buildLegacyBlockedRules`**：消息策略模块统一构造 legacy 屏蔽规则，消除 worker.js 两处重复。
- **验证页共享样式抽取**：主页面与错误页 CSS 收敛为 `VERIFY_SHARED_STYLE` 常量，消除约 80% 重复。
- **限流文案对齐窗口**：消息发送限流提示按 `RATE_LIMIT_WINDOW` 注入分钟数（与验证限流口径一致），不再与 `/help` FAQ 时长漂移。
- **`/find` 无结果引导**：补充「仅收录私聊过机器人的用户」与 `/notes` 搜索提示。
- **输入健壮性**：`/addword` 单词长度上限（`WORD_MAX_LENGTH` 50 字）防词库污染；`/find` 查询长度上限 100 字符防 LIKE 拖慢 D1。
- **端点健壮性**：`/verify-callback` 非法 JSON 返回 400（原 500）；Turnstile siteverify 请求加 10 秒超时；验证页/错误页响应补充 `X-Content-Type-Options` 与 `Referrer-Policy` 安全头。
- **面板与看板**：用户面板展示话题标题；错误页汇总最近错误条数；概览页未配置 `VERIFICATION_PAGE_URL` 时端点区降级为相对路径，避免渲染无效链接。

- **验证体验**：答题验证通过后题目消息清空按钮（原残留可点击选项，再点只会提示「已过期」）；验证链接过期提示分钟数改为由 `TURNSTILE_VERIFY_TTL` 注入，消除页面文案与后端有效期漂移。
- **验证页 UI**：`/verify` 缺参/未配置错误页复用验证页视觉语言（暗色模式 + 返回 Telegram 按钮），替代裸 HTML；Turnstile 组件主题移除硬编码 light，由脚本按系统偏好设置并随 `prefers-color-scheme` 实时重建。
- **日志卫生**：`verification_passed` 仅记录选中索引，正确答案文本不再落入日志；告警节流改为窗口内丢弃计数汇总输出（`admin_alert_burst_summary`），消除风暴期逐条 DEBUG 噪声。
- **通知文案**：垃圾消息告警反查用户话题，有话题时发送到对应 Topic 且提示「已发送到该用户话题」（原恒提示「尚无话题」与实际不符）；私聊 `/help` 改为常见问题 FAQ（验证/过期/违规/限流/静音封禁指引）。
- **性能**：`flushExpiredMediaGroups` 由全量分页扫描（上限 20 页 × 1000 key）收敛为单页 100 条（媒体组 key 自带 60s TTL，残留极少）；`createD1Storage` 按 db 绑定弱引用缓存实例，避免每请求多次闭包实例化。

### 工程优化

- 消除 `worker.js` 与 `src/utils.js` 重复的 10 个纯函数定义，统一 import（单文件部署仍由 esbuild bundle 完成）。
- `tgCall` 缓存 Telegram 客户端实例，避免每条消息重复创建（并发复用同一 botToken/apiBase 的 client）。
- **管理告警节流**：同类型告警 60 秒内只发一条（新增 `ALERT_THROTTLE_MS` 内部常量，默认 60000ms），故障期不再告警刷屏；`notifyAdmin` JSDoc 修正为 HTML 默认解析模式。
- **Turnstile 验证页抽取独立模块** `src/verify-page.js`（模板 + 渲染函数），页面渲染可单测；`worker.js` 不再内嵌约 120 行 HTML 模板。
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
- **Turnstile 验证页 UI 升级**：暗色模式跟随系统偏好（`prefers-color-scheme`）、加载动画、成功/失败状态胶囊样式、`aria-live` 无障碍提示；Turnstile 组件主题与系统同步。
- **管理看板时间 CST 化**：`formatTimeBoth` 绝对时间由 UTC 改为中国时间（`formatCstTime`，CST UTC+8），与日切/热力口径一致。
- **编辑通知防超长**：用户/管理员编辑消息通知单侧截断（`EDIT_SNIPPET_LIMIT` 1500 字符 + 省略号），避免超过 Telegram 4096 上限导致通知静默失败。
- **策略原因中文映射**：`userEditBlocked` 由英文原因码改为可读中文（命中屏蔽词或规则 / 用户已封禁 / 会话已关闭 / 需要重新验证等），未知码保留原值便于排障。
- **分隔线统一**：管理菜单 / 看板 / 用户面板分隔线统一为 `SEP_LINE` 常量，消除 12/16 字符不一致。
- **用户面板状态 chips**：只列出生效的受限状态（🚫 已封禁 / 🔇 已静音 / 🔒 已关闭），无限制时显示「✅ 状态正常」。
- **spam 拦截通知定位引导**：已建话题时引导本话题 `/panel` 操作，无话题时引导 `/find UID` 定位用户。

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
