# 开发指南

本文说明 Telegram Private Chat Gateway 的本地开发、测试、文档同步和发布前检查流程。

## 前置条件

- Node.js 18 或更高版本
- npm
- 可选：Cloudflare 账号和 Wrangler 登录，用于本地 Worker 或 dry-run
- 不需要真实 Telegram Token 即可运行单元和集成测试

## 安装依赖

```bash
npm install
```

不要将真实 Secrets 写入仓库。测试使用明显的假 Token、Mock KV、Mock D1 和 Mock Telegram Client。

## 项目结构

```text
.
├── worker.js                    # Telegram 业务编排和 Worker 导出
├── src/
│   ├── app.js                   # HTTP 安全入口和 Scheduled 入口
│   ├── admin-service.js         # 角色授权、资料卡和规则服务
│   ├── conversation-service.js  # Topic、双向消息和资料同步
│   ├── message-policy.js        # 内容策略和规则校验
│   ├── telegram-client.js       # Telegram API 客户端
│   ├── update-router.js         # Update 幂等路由
│   ├── logger.js                # 结构化脱敏日志
│   ├── maintenance-service.js   # 保留期清理
│   └── storage/                 # D1、KV 和 migrations
├── tests/
│   ├── unit/
│   ├── integration/
│   └── helpers/
├── docs/                        # 用户、运维和开发文档
└── scripts/                     # 文档同步和本地测试兼容脚本
```

## 本地运行

```bash
npm run dev
```

`npm run dev` 调用 `wrangler dev`。本地业务验证需要配置开发环境 KV、D1 和变量。不要将本地开发服务监听到不可信网络。

## 测试分层

### 单元测试

```bash
npm run test:unit
```

覆盖纯函数、配置、日志、Telegram Client、管理员权限、策略规则、KV 短期状态和资料卡行为。

### 集成测试

```bash
npm run test:integration
```

使用 Mock D1、Mock KV 和 Mock Telegram 验证：

- Worker HTTP 安全入口
- Update 幂等
- D1 migrations 和存储行为
- Topic 并发创建
- 双向消息映射
- 管理员资料卡和规则操作
- Scheduled 保留期清理

### 全量测试

```bash
npm test
```

### 监听模式

```bash
npm run test:watch
```

不要将 Vitest UI 或开发服务器暴露到公网。

### 覆盖率

```bash
npm run test:coverage
```

覆盖率输出位于 `coverage/`，该目录不提交。新增功能或修复应覆盖核心路径、异常路径和并发边界，不应为了提高数字编写依赖实现细节的脆弱测试。

## 文档同步

`CLAUDE.md` 的函数、CONFIG 和 KV 键名索引由脚本生成：

```bash
npm run sync-docs
```

修改 `worker.js`、`src/utils.js` 或 CONFIG 后运行此命令。不要手工修改以下自动区块：

- `AUTO-GENERATED START: functions`
- `AUTO-GENERATED START: config`
- `AUTO-GENERATED START: kv-keys`

修改功能、配置、部署要求或用户可见行为时，同时检查：

- `README.md`
- `README_EN.md`
- `docs/configuration.md`
- `docs/architecture.md`
- `docs/operations.md`
- `docs/security.md`
- `CHANGELOG.md`

## JavaScript 语法检查

项目没有独立 lint 或 TypeScript typecheck 配置。提交前至少运行：

```bash
for file in worker.js src/*.js src/storage/*.js scripts/*.js scripts/*.cjs; do
  node --check "$file"
done
```

## Wrangler dry-run

```bash
npx wrangler deploy --dry-run
```

dry-run 验证 ES Modules 打包和 Worker 配置，不会实际部署，也不能验证真实 Telegram 权限或生产 Bindings。

## 推荐开发顺序

1. 使用语义搜索和精确读取理解相关模块。
2. 为新行为或 Bug 编写失败测试。
3. 运行聚焦测试确认失败原因。
4. 实现最小修复。
5. 运行聚焦测试和相邻测试。
6. 同步相关文档。
7. 运行完整测试、覆盖率、语法检查和 dry-run。

## 代码边界

- `src/app.js` 不承载 Telegram 业务逻辑。
- `src/conversation-service.js` 通过 storage 和 telegram 接口访问外部状态。
- `src/admin-service.js` 负责角色授权和审计，不绕过权限直接写 D1。
- `src/message-policy.js` 保持纯策略计算和输入校验。
- D1 SQL 集中在 `src/storage/d1-storage.js`，数据值使用 `.bind()`。
- KV 短期状态集中在 `src/storage/kv-ephemeral-store.js`。
- 日志通过 `src/logger.js` 脱敏，不直接输出完整 Update。

## 发布前命令

```bash
npm run sync-docs
npm run test:unit
npm run test:integration
npm test
npm run test:coverage
git diff --check
npx wrangler deploy --dry-run
```

真实发布前还需要在预发布 Worker 验证 Telegram Bot 权限、KV/D1 Bindings、Webhook、Turnstile 和 Cron。
