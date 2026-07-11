# 配置参考

Telegram Private Chat Gateway 使用 Cloudflare Worker Secrets、普通变量、KV Binding 和 D1 Binding。代码只读取本页列出的配置；未列出的变量不会改变运行时行为。

配置一律在 **Cloudflare Dashboard → 目标 Worker → Settings** 完成。  
发布代码时粘贴 `dist/worker.single.js`，详见 [部署指南](deployment.md)。

变量 **Name 不要有前导/尾随空格**（例如错误名 ` SUPERGROUP_ID` 会导致运行时读不到）。

## 必需 Secrets

路径：**Variables and Secrets** → 类型 **Secret**。

### `BOT_TOKEN`

Telegram Bot API Token，由 BotFather 提供。  
不得写入仓库、日志或公开文档。

### `WEBHOOK_SECRET`

Telegram Webhook Secret Token，必须至少 32 字节。  
`setWebhook` 的 `secret_token` 必须与此值完全一致。Worker 使用固定时间比较校验请求头 `X-Telegram-Bot-Api-Secret-Token`。

```bash
openssl rand -hex 32
```

## 必需变量

路径：**Variables and Secrets** → 类型 **Text**。

### `SUPERGROUP_ID`

管理员超级群组 ID，必须以 `-100` 开头。群组必须启用 Topics，机器人需要相应管理权限。

示例：`-1001234567890`

## 强烈建议

### `OWNER_IDS`

恢复 Owner 用户 ID 列表。支持逗号、分号或空白分隔，只接受 1 到 20 位数字 ID。

示例：`123456789,987654321`

恢复 Owner 无需依赖 D1 管理员记录即可访问管理员连接检查和全部授权动作，可用于恢复后台权限。

## 必需 Bindings

路径：**Bindings**（不是 Variables）。

### `TOPIC_MAP`

类型：**KV Namespace**。用于：

- 临时验证状态和验证挑战
- 速率限制
- 待处理消息 ID
- 管理员状态缓存
- Topic 健康缓存
- 媒体组临时数据
- 动态屏蔽词

### `TG_BOT_DB`

类型：**D1 Database**（禁止做成 Text/Secret 字符串变量）。用于：

- 用户和 Topic 长期状态
- 信任、封禁、关闭和静音状态
- 消息映射
- 动态规则
- 管理员角色
- 管理员审计
- Telegram Update 幂等记录
- Topic 创建锁

若误配为字符串变量，会出现 `db.prepare is not a function`。

## Turnstile 配置

Turnstile 需要以下三项同时存在：

| 配置 | 类型 | 说明 |
|------|------|------|
| `TURNSTILE_SITE_KEY` | 变量 | Turnstile Site Key |
| `TURNSTILE_SECRET_KEY` | Secret | Turnstile Secret Key |
| `VERIFICATION_PAGE_URL` | 变量 | Worker Origin，不包含 `/verify` 后缀 |

在 Dashboard 配置：

| 名称 | 类型 | 说明 |
|------|------|------|
| `TURNSTILE_SITE_KEY` | Text | Turnstile Site Key |
| `TURNSTILE_SECRET_KEY` | Secret | Turnstile Secret |
| `VERIFICATION_PAGE_URL` | Text | Worker Origin，如 `https://xxx.workers.dev`，不含 `/verify` |

任一项缺失时使用内置本地题库验证。

**Turnstile 站点 Hostname（必配）：**  
在 Cloudflare Dashboard → **Turnstile** → 你的站点 → **Hostname Management** 中加入实际打开验证页的域名，例如：

```text
telegram-private-chat-gateway.<subdomain>.workers.dev
```

未加入时浏览器会报客户端错误 **110200 Domain not authorized**，页面显示验证组件失败。  
若暂时无法使用 Turnstile（网络拦截 `challenges.cloudflare.com`，或仅想先测通），删除/清空上述三项中任意一项并 Deploy 变量后，Bot 会回退到**本地题库**验证。

## 管理员检查

### `ADMIN_IDS`

可选的管理员用户 ID 白名单（Text）。白名单命中时跳过 Telegram `getChatMember` 检查。

示例：`123456789,987654321`

这与 D1 中的 Owner、Operator、Rules Manager 角色不同：`ADMIN_IDS` 服务于群组命令权限快速判断，D1 角色服务于资料卡和管理员服务授权。

## 内容过滤

### `SPAM_KEYWORDS`

逗号分隔的**垃圾检测**关键词列表（Text），供 `spamCheck` 使用（与链接、重复消息等策略一起判断是否 spam）。

示例：`keyword-a,keyword-b`

注意与「屏蔽词」是两套机制：

| 机制 | 配置位置 | 管理命令 | `/listwords` 展示 |
|------|----------|----------|-------------------|
| 屏蔽词（硬编码 + KV） | 代码 `BLOCKED_WORDS` + KV `blocked_words_kv` | `/addword` `/delword` | 硬编码词 + 动态词 |
| 垃圾关键词 | 环境变量 `SPAM_KEYWORDS` | 只能改 Dashboard Variables | 单独一节「SPAM_KEYWORDS」 |

`/addword` **不会**把词写入 `SPAM_KEYWORDS`；要让词进入 spam 检测，应设置变量（不要有前导空格的变量名）。

## Telegram API

### `API_BASE`

可选 Telegram Bot API Base URL。代码只允许：

- `https://api.telegram.org`
- `https://api.telegram.dev`

其他值会被拒绝并回退到官方默认地址，以降低 SSRF 风险。当前版本不支持任意自托管 Bot API 地址。

## HTTP 限制

- Telegram Webhook 必须使用 `application/json`。
- 公开 POST 请求体最大为 1 MiB。
- 超过限制返回 `413 Payload Too Large`。
- Webhook Secret 错误返回 401。
- Webhook JSON 非法返回 400。
- Webhook Content-Type 非 JSON 返回 415。

## Cron

Dashboard：**Settings → Triggers → Cron Triggers**，建议：

```text
0 3 * * *
```

保留期：

- Telegram Update 幂等记录：7 天
- 消息映射：30 天
- 管理员审计：90 天

## 可观测性

可在 Dashboard 为 Worker 开启 Logs / Observability。结构化日志会脱敏已知凭据和消息正文字段，但仍不应主动记录完整 Telegram Update。根据流量与费用调整采样。
