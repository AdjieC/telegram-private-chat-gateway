# 安全设计

Telegram Private Chat Gateway 处理 Telegram 私聊、管理员操作和 Bot 凭据。安全边界以 Webhook 身份验证、最小权限、输入限制、参数化存储和日志脱敏为核心。

## 威胁模型

主要风险包括：

- 伪造 Telegram Webhook 请求
- 重放同一个 Telegram Update
- 未授权群成员向用户发送消息或修改用户状态
- 恶意 Callback 数据或规则输入
- 超大请求体造成内存和 CPU 消耗
- 正则表达式拒绝服务
- Telegram API Base 配置导致 SSRF
- 验证页面参数导致 XSS
- SQL 注入或并发状态覆盖
- 日志泄露消息正文、凭据或验证挑战

## Webhook Secret

生产 Webhook 必须配置至少 32 字节的 `WEBHOOK_SECRET`。Telegram 在请求头中发送：

```text
X-Telegram-Bot-Api-Secret-Token
```

`constantTimeEqual()` 对两个 UTF-8 字节序列执行固定长度循环比较，同时将长度差异纳入 mismatch，降低直接字符串比较的时序差异。

Secret 错误返回 401；缺少生产 Secret 配置返回明确的服务器错误。

## Content-Type 和请求体限制

Telegram Webhook 只接受 `application/json`。所有公开 POST 请求体最多 1 MiB，Worker 使用 Web Streams reader 逐块累计字节数，超限立即返回：

```text
413 Payload Too Large
```

非法 JSON 返回 400，错误 Content-Type 返回 415。

## Update 幂等与重放控制

每个 Telegram Update ID 在 D1 中声明。并发重复请求只有一个可以获得处理权；已完成记录直接跳过。可重试错误和超时 processing 状态使用受控条件重新声明。

幂等机制用于避免重复 Topic、重复消息和重复管理员动作，但不能替代 Webhook Secret 身份验证。

## 管理员权限

群组命令和消息回复要求发送者通过管理员检查。资料卡和管理员服务使用 Owner、Operator、Rules Manager 权限模型。

安全规则：

- `OWNER_IDS` 中的恢复 Owner 拥有完整恢复权限。
- D1 管理员记录必须为 enabled。
- 每次 Callback 执行时重新检查权限，不信任按钮生成时的旧状态。
- Callback 只接受固定版本、资源、动作和 1 到 20 位数字用户 ID。
- 未知动作、非法格式、无权限和不存在用户都会拒绝处理。
- 成功的用户状态操作写入管理员审计。

`ADMIN_IDS` 是群组管理员检查的可选白名单，应只包含可信 Telegram 用户 ID。

## D1 安全

所有用户值均通过 D1 `.bind()` 参数绑定。

`updateUserState()` 的 SQL 列名根据调用者传入字段动态组合，但字段必须命中内部固定白名单：

- username
- firstName / lastName
- status
- trustLevel
- isMuted
- violationCount
- topicId
- infoCardMessageId
- profileSnapshot
- lastMessageAt

用户输入不能成为 SQL 表名、列名或语句片段。

新用户使用 `INSERT OR IGNORE`，状态更新使用原子部分 `UPDATE`，降低并发请求相互覆盖 Topic 或封禁状态的风险。

## 正则规则安全

动态规则限制：

- pattern 最大 200 字符
- response text 最大 4000 字符
- 参与匹配的输入最大 5000 字符
- match type、rule type 和 action 使用白名单
- 正则必须可编译且不能匹配空字符串
- 拒绝嵌套量词
- 拒绝明显重叠的量化分支

这些检查降低常见灾难性回溯风险，但不能形式化证明所有正则都为线性复杂度。只向可信 Rules Manager 开放规则写权限。

## Telegram API 与 SSRF

`API_BASE` 只允许：

- `https://api.telegram.org`
- `https://api.telegram.dev`

其他值会记录拒绝事件并回退到默认官方 API。当前版本不允许任意自托管地址，防止配置被用于访问内网或非 Telegram 服务。

## 验证页面与 XSS

`GET /verify` 的动态参数在进入 HTML 模板前执行 HTML 转义。页面配置 Content Security Policy：

- 仅允许 Cloudflare Turnstile 脚本和 frame
- 内联脚本使用每次请求生成的 nonce
- 禁止对象资源
- 禁止外部表单提交
- 禁止页面被其他站点 frame

状态消息使用 `textContent`，不使用用户输入拼接 `innerHTML`。

## Turnstile Callback 信任边界

`POST /verify-callback` 是验证页面调用的公开端点，不使用 Telegram Webhook Secret。它依赖：

- 请求体 1 MiB 上限
- token、code、userId 参数检查
- Cloudflare Turnstile 服务端 token 验证
- KV 中短 TTL code 与 userId 绑定
- code 成功使用后的状态更新

该端点不得用于普通业务写入。生产环境应监控异常请求量和 Turnstile 验证错误。

## 结构化日志脱敏

日志输出前递归脱敏：

- `BOT_TOKEN`
- `TURNSTILE_SECRET_KEY`
- `WEBHOOK_SECRET`
- Bot、Turnstile 和 Webhook token 字段
- `verifyCode`、`verifyId`
- `text`、`caption`

错误日志保留错误消息和 stack 以便排障。调用者不得把完整 Request、完整 Telegram Update 或包含凭据的任意字符串作为错误消息写入日志。

## Secrets 管理

使用：

```bash
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put TURNSTILE_SECRET_KEY
```

不要：

- 将 Secret 写入 `wrangler.toml`
- 将真实值写入测试 fixture
- 在 Issue、PR、截图或日志中公开 Secret
- 在生产环境复用测试 Secret

泄露后立即轮换 Bot Token、Webhook Secret 或 Turnstile Secret，并重新部署和设置 Webhook。

## 开发工具链

测试使用 Vitest 和 Vite 相关开发依赖。不要将 Vitest UI 或本地开发服务器直接监听在公网可访问地址。开发依赖不进入 Worker 运行时产物，但仍应定期执行：

```bash
npm audit
npm audit --omit=dev
```

依赖主版本升级应在独立变更中完成，并重新验证 Node.js、Vitest 和覆盖率兼容性。

## 发布前安全检查

- 生产依赖审计无高危漏洞
- Webhook Secret 至少 32 字节
- Secrets 通过 Cloudflare Secret 保存
- Owner 和管理员 ID 已核对
- Telegram Bot 只拥有必需权限
- D1 和 KV 使用独立生产资源
- `/health`、Webhook 401、请求体 413 和验证流程通过预发布验证
- 日志中没有正文、Token 或验证挑战
- 没有暴露 Vitest UI、Wrangler dev 或测试 Bot 凭据
