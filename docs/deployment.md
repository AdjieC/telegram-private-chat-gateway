# 部署指南

本文说明如何从零部署 Telegram Private Chat Gateway。部署过程不会自动创建 Cloudflare KV、D1、Secrets、Cron 或 Telegram Webhook，这些资源需要在自己的 Cloudflare 和 Telegram 账号中配置。

## 前置条件

- Cloudflare 账号
- Node.js 18 或更高版本
- npm
- Telegram Bot Token
- 已开启 Topics 的 Telegram 超级群组
- 机器人在超级群组中具有发送消息、管理 Topics 和删除消息所需权限

## 1. 获取项目

```bash
git clone https://github.com/Silentely/telegram-private-chat-gateway.git
cd telegram-private-chat-gateway
npm install
```

## 2. 登录 Cloudflare

```bash
npx wrangler login
```

确认当前账号：

```bash
npx wrangler whoami
```

## 3. 创建 KV Namespace

创建用于验证状态、速率限制、管理员缓存和 Topic 健康缓存的 KV Namespace：

```bash
npx wrangler kv namespace create TOPIC_MAP
```

将返回的 Namespace ID 写入 `wrangler.toml`：

```toml
[[kv_namespaces]]
binding = "TOPIC_MAP"
id = "<YOUR_KV_NAMESPACE_ID>"
```

## 4. 创建 D1 Database

```bash
npx wrangler d1 create telegram-private-chat-gateway
```

将返回的数据库信息写入 `wrangler.toml`：

```toml
[[d1_databases]]
binding = "TG_BOT_DB"
database_name = "telegram-private-chat-gateway"
database_id = "<YOUR_D1_DATABASE_ID>"
```

Worker 在首次业务请求或 Scheduled 任务执行时幂等创建所需表和索引。发布前仍应通过预发布 Worker 验证当前账号拥有 D1 读写权限。

## 5. 配置 Secrets

使用 Cloudflare Secrets 保存敏感值：

```bash
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET
```

`WEBHOOK_SECRET` 必须是至少 32 字节的高熵随机字符串。可以使用密码管理器或系统安全随机工具生成，不要将真实值写入 `wrangler.toml`。

启用 Turnstile 时还需要：

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY
```

## 6. 配置变量

在 `wrangler.toml` 或 Cloudflare Dashboard 中配置非敏感变量：

```toml
[vars]
SUPERGROUP_ID = "-1001234567890"
OWNER_IDS = "123456789"
```

- `SUPERGROUP_ID` 必须是以 `-100` 开头的 Telegram 超级群组 ID。
- `OWNER_IDS` 是逗号、分号或空白分隔的恢复 Owner 用户 ID，强烈建议至少配置一个。
- 其他可选配置请查看[配置参考](configuration.md)。

## 7. 配置 Turnstile（可选）

在 Cloudflare Turnstile 创建站点后配置：

```toml
[vars]
TURNSTILE_SITE_KEY = "<YOUR_SITE_KEY>"
VERIFICATION_PAGE_URL = "https://<YOUR_WORKER_DOMAIN>"
```

`TURNSTILE_SITE_KEY`、`TURNSTILE_SECRET_KEY` 和 `VERIFICATION_PAGE_URL` 三项同时存在时启用 Turnstile。否则机器人使用本地题库验证。

## 8. 配置 Cron

Scheduled 任务负责删除过期幂等记录、消息映射和管理员审计。建议每天 UTC 03:00 执行：

```toml
[triggers]
crons = ["0 3 * * *"]
```

Cron 不删除用户、规则、管理员或 Topic 主记录。

## 9. 执行发布前检查

```bash
npm run test:unit
npm run test:integration
npm test
npm run test:coverage
npx wrangler deploy --dry-run
```

`--dry-run` 只验证打包，不会实际部署。

## 10. 部署 Worker

```bash
npm run deploy
```

记录部署后的 Worker URL，例如：

```text
https://telegram-private-chat-gateway.<YOUR_SUBDOMAIN>.workers.dev
```

如果启用了 Turnstile，确认 `VERIFICATION_PAGE_URL` 与实际 Worker Origin 一致，然后重新部署变量配置。

## 11. 设置 Telegram Webhook

```text
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=<WORKER_URL>&secret_token=<WEBHOOK_SECRET>&allowed_updates=%5B%22message%22,%22edited_message%22,%22callback_query%22%5D
```

替换：

- `<BOT_TOKEN>`：Telegram Bot Token
- `<WORKER_URL>`：完整 HTTPS Worker URL
- `<WEBHOOK_SECRET>`：与 Cloudflare Secret 完全相同的值

检查 Webhook：

```text
https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo
```

## 12. 发布后验证

按顺序验证：

1. `GET /health` 返回 `OK`。
2. 不带正确 Secret Token 的 Webhook 请求返回 401。
3. 新用户私聊时收到验证流程。
4. 验证通过后创建独立 Forum Topic。
5. 管理员在 Topic 中回复时，消息到达对应用户。
6. 恢复 Owner 私聊机器人发送 `/start` 时收到后台连接检查入口。
7. 用户资料卡的信任、封禁、关闭和静音操作符合角色权限。
8. Cloudflare Logs 中不出现消息正文、Bot Token 或验证挑战标识。
9. 手动触发或等待 Cron 后，Scheduled 任务无绑定或 SQL 错误。

生产发布建议先使用单独的测试 Bot、测试群组和预发布 Worker 完成上述验证。
