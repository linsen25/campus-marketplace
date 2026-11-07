# B32 Stripe Test Mode 本地测试

本流程只允许隔离的 Test Mode。不要把 `.env.staging.local`、Secret、Webhook Secret 或 Service Role Key 提交到 Git。

## 环境预检

创建仅存在于仓库外的 `.env.b32.test.local`，然后运行：

```powershell
npm run check:b32:env
```

预检会拒绝已知 Staging/Production 项目 `pcaqxezdfxofysghssyo`、不匹配的测试 Project Ref、Live Key、以及把 Migration 011 纳入白名单的情况。它不会连接 Supabase 或 Stripe，也不会打印密钥。

## 离线验收

不需要 Supabase 或 Stripe 网络连接：

```powershell
node tests/b32-offline.cjs
```

该入口只运行 B21–B25/B28 的配置、Payment、Refund、Transfer、Dispute、Recovery 和 Worker 契约测试。

## 隔离环境要求

真实 Test Mode 联调必须使用本地 Supabase/临时数据库，不能把 `NEXT_PUBLIC_SUPABASE_URL` 指向 Staging 或 Production。Migration 011 不得复制或执行。

必需的服务端配置名称：

- `APP_ENV=staging`
- `STRIPE_PROVIDER_ENABLED=true`
- `STRIPE_SECRET_KEY=sk_test_...`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...`
- `STRIPE_PLATFORM_ACCOUNT_ID=acct_...`
- `STRIPE_API_VERSION=2026-09-30.endive`
- `STRIPE_APPLICATION_ORIGIN=https://...`（本地可用 `http://localhost`）
- `STRIPE_WEBHOOK_SECRET=whsec_...`
- `STRIPE_CONNECT_WEBHOOK_SECRET=whsec_...`
- `STRIPE_ACCOUNT_WEBHOOK_SECRET=whsec_...`
- `STRIPE_WORKER_SECRET`（至少 32 字符）

第一阶段只开启：

```text
STRIPE_ORDER_PAYMENTS_ENABLED=true
```

`STRIPE_ORDER_REFUNDS_ENABLED`、`STRIPE_ORDER_TRANSFERS_ENABLED`、`STRIPE_ORDER_TRANSFERS_CREATE_APPROVED`、Payout、Dispute、Recovery 开关保持 `false`，直到对应阶段单独验收。

## 首笔支付顺序

1. 为卖家完成 Connect Test Account 设置，为买家完成 Card Setup。
2. 创建合法订单并确认订单前置状态。
3. `POST /api/orders/{orderId}/campus/payment/start`。
4. 浏览器使用返回的 `clientSecret` 调用 Stripe.js `confirmCardPayment`。
5. Stripe CLI 将签名事件转发到 `/api/stripe/webhook`。
6. 通过数据库对账确认 PaymentIntent、金额、币种、订单和 attempt 完全匹配后才标记 Paid。

重复 Webhook、延迟、失败和未知 Provider 结果必须保持幂等、重试或人工恢复状态；不得直接视为成功。

## 外部配置核对

使用 Stripe CLI 时只检查格式和 Endpoint 绑定，不把 Secret 打印到日志：

```powershell
stripe login
stripe listen --forward-to http://localhost:3000/api/stripe/webhook
```

真实 PaymentIntent、Webhook 投递和数据库 Paid 状态只有在本地隔离数据库与 Test Mode 凭据都实际可用时才能标记 PASS。
