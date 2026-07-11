# 配置参考

Telegram Private Chat Gateway 使用 Cloudflare Worker Secrets、普通变量、KV Binding 和 D1 Binding。代码只读取本页列出的配置；未列出的变量不会改变运行时行为。

## 必需 Secrets

### `BOT_TOKEN`

Telegram Bot API Token，由 BotFather 提供。

```bash
npx wrangler secret put BOT_TOKEN
```

不得写入仓库、日志或普通 `[vars]`。

### `WEBHOOK_SECRET`

Telegram Webhook Secret Token，必须至少 32 字节。

```bash
npx wrangler secret put WEBHOOK_SECRET
```

Telegram `setWebhook` 请求中的 `secret_token` 必须与此值完全一致。Worker 使用固定时间比较校验请求头 `X-Telegram-Bot-Api-Secret-Token`。

## 必需变量

### `SUPERGROUP_ID`

管理员超级群组 ID，必须以 `-100` 开头。群组必须启用 Topics，机器人需要相应管理权限。

```toml
[vars]
SUPERGROUP_ID = "-1001234567890"
```

## 强烈建议

### `OWNER_IDS`

恢复 Owner 用户 ID 列表。支持逗号、分号或空白分隔，只接受 1 到 20 位数字 ID。

```toml
[vars]
OWNER_IDS = "123456789,987654321"
```

恢复 Owner 无需依赖 D1 管理员记录即可访问管理员连接检查和全部授权动作，可用于恢复后台权限。

## 必需 Bindings

### `TOPIC_MAP`

Cloudflare KV Namespace，用于：

- 临时验证状态和验证挑战
- 速率限制
- 待处理消息 ID
- 管理员状态缓存
- Topic 健康缓存
- 媒体组临时数据
- 动态屏蔽词

```toml
[[kv_namespaces]]
binding = "TOPIC_MAP"
id = "<YOUR_KV_NAMESPACE_ID>"
```

### `TG_BOT_DB`

Cloudflare D1 Database，用于：

- 用户和 Topic 长期状态
- 信任、封禁、关闭和静音状态
- 消息映射
- 动态规则
- 管理员角色
- 管理员审计
- Telegram Update 幂等记录
- Topic 创建锁

```toml
[[d1_databases]]
binding = "TG_BOT_DB"
database_name = "telegram-private-chat-gateway"
database_id = "<YOUR_D1_DATABASE_ID>"
```

## Turnstile 配置

Turnstile 需要以下三项同时存在：

| 配置 | 类型 | 说明 |
|------|------|------|
| `TURNSTILE_SITE_KEY` | 变量 | Turnstile Site Key |
| `TURNSTILE_SECRET_KEY` | Secret | Turnstile Secret Key |
| `VERIFICATION_PAGE_URL` | 变量 | Worker Origin，不包含 `/verify` 后缀 |

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY
```

```toml
[vars]
TURNSTILE_SITE_KEY = "<YOUR_SITE_KEY>"
VERIFICATION_PAGE_URL = "https://telegram-private-chat-gateway.example.workers.dev"
```

任一项缺失时使用内置本地题库验证。

## 管理员检查

### `ADMIN_IDS`

可选的管理员用户 ID 白名单。白名单命中时跳过 Telegram `getChatMember` 检查。

```toml
[vars]
ADMIN_IDS = "123456789,987654321"
```

这与 D1 中的 Owner、Operator、Rules Manager 角色不同：`ADMIN_IDS` 服务于群组命令权限快速判断，D1 角色服务于资料卡和管理员服务授权。

## 内容过滤

### `SPAM_KEYWORDS`

逗号分隔的垃圾关键词列表，与代码内置关键词共同参与检测。

```toml
[vars]
SPAM_KEYWORDS = "keyword-a,keyword-b"
```

动态屏蔽词也可以由管理员在群组 Topic 中通过命令写入 KV。

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

建议配置：

```toml
[triggers]
crons = ["0 3 * * *"]
```

保留期：

- Telegram Update 幂等记录：7 天
- 消息映射：30 天
- 管理员审计：90 天

## 可观测性

仓库默认示例开启 Cloudflare Observability，并使用 10% 日志采样：

```toml
[observability]
enabled = true

[observability.logs]
enabled = true
head_sampling_rate = 0.1
```

根据实际流量、排障需求和 Cloudflare 费用调整采样率。结构化日志会脱敏已知凭据和消息正文字段，但仍不应主动记录完整 Telegram Update。
