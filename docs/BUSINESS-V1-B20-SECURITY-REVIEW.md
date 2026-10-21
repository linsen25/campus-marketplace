# B20 — Targeted payment security review

2026-10-20。**REVIEW ONLY；实施未开始。** 本轮用户已确认 Stripe 为 Business V1
唯一支付服务商，取代 B20 计划中“服务商待选”的历史状态；这不等于批准具体 Connect
资金流、实际扣款或任何部署。按要求不修改 B20 计划。

仅检查支付接口、付款 attempts、取消/结算权限、签名/inbox、B10/B12 计费隔离和
B14 守卫；无全项目重审、远端连接或测试执行。以下为源码安全审查，不是 Stripe
文档兼容性、真实权限或财务运行验收。用户指定 GPT-6.1 Sol / High；当前工具无法
切换或核实模型路由，因此不将本报告冒充为已认证的指定模型评审记录。

## 结论与分类

可复用现有边界完成 **contract-only B20**，无需新表、API、UI、worker 或 cron。
**不能直接用当前抽象接口、布尔模拟器或 setup inbox 开启真实收款。**
审查已完成；下列 BLOCKER 必须在适用实施/启用阶段解决，不代表已发现当前线上
非法扣款。现有代码主动阻断 Stripe 模式下的 Order payment，本轮不解除。

| ID / 分类                                        | 证据与问题                                                                                                                                                                                                                                                                                             | 最小纠正 / 归属                                                                                                                                                                                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 **BLOCKER**（使用现有接口作为真实收款证据前） | `lib/server/payment-provider-boundary.ts:23` 的 webhook 返回仅 eventId/reference/`status: string`，`:27` reconcile 直接给 Paid/Failed/Processing；没有 purpose、platform/account/mode、Order/attempt/customer、冻结金额/币种及 capture 证据。该接口尚无真实 executor，不能因类型返回 Paid 就认为可信。 | **B20 REQUIRED**：在原文件定义受限的观察值、期望绑定和纯校验/映射结果；不允许任意 status 或布尔值生成收款证明。真实证据建立、持久化和受限应用由 **B21/B22 DEFERRED** 实施。                                                                              |
| F2 **REQUIRED**                                  | `stripe-setup.ts:459,483,555` 与 `202610160004_stripe_account_setup.sql:138` 是 setup-only。会员付款也可能使用平台的 PaymentIntent；签名、customer、事件类型均不能独立判定“这是某 Order 的付款”。                                                                                                      | B20 契约明确 account_setup / marketplace_order / shop_membership 的独立用途和绑定。只以服务端已登记的 Stripe 对象 → 用途/业务 ID 解析，不信任客户端或 metadata 自报用途。不能只扩充现有 setup allowlist。B22 再批准消费者隔离/claim 方案。               |
| F3 **REQUIRED**                                  | `payment-provider-boundary.ts:27` 无 unknown/action-required 的观察类型。`stripe-setup.ts:113` 已有 unresolved-operation 保护，但它是 setup 的 20 小时阈值，不是所有付款可重建的保证。                                                                                                                 | B20 映射中 timeout/5xx/响应丢失保持 unknown；action-required 保持等待，不变 Failed/Paid。先查原对象和原操作，不生成新 key。精确终态和幂等保留期需之后核对当前 Stripe 文档；B21/B22 实现。                                                                |
| F4 **REQUIRED**                                  | `202610120008_order_campus_payment.sql:11` 已有 Buyer/command 唯一性及每 Order 一个 processing/paid attempt；但没有 Stripe 引用/用途/平台等绑定。SDK retry、UUID 与 inbox event 去重单独都不足以防多次收款。                                                                                           | B20 明确稳定操作键：provider+mode+platform/account+purpose+attempt/authorization+operation kind；同键输入摘要不一致拒绝，换 UUID 不得绕开未解决 attempt。DB 唯一绑定/租约及并发应用是 B21/B22，不在本轮造新账本。                                        |
| F5 **REQUIRED**                                  | `202610140002_order_cancellation_settlement.sql:511` 的 start 在返回原 attempt 前调用 progression guard；取消意图可能阻止用户继续触发该入口。`:119` finalizer 在 processing 时等待，`:674` resolver 持 Listing→Order→attempt 锁，再处理取消。                                                          | 后台可信 reconciliation 不能仅依赖 Buyer 再点 Pay。B20 保留 capture 与取消意图的独立证据及迟到成功处理；B22 在相同锁序和 fenced 提交下串行应用并复用取消授权。不得在未知付款时因超时释放库存。                                                           |
| F6 **REQUIRED**                                  | `payment-provider-boundary.ts:2,30,34` 已区分经济快照/退款入口，但 `executePayout` 含义模糊。`202610160005_dual_payment_paths.sql:229,342` 冻结历史经济并禁止 external UU payment；B10 §13 保护已存在 Order。                                                                                          | B20 区分 authorization、captured payment、refund、seller transfer、bank payout 的观察/操作类型。冻结 cents/币种/原目的地，NULL≠0，不重算当前费用；external 必须零 Stripe 调用。会员 Suspended 不得剥夺合法旧 Order 的退款/争议权限；B14 新交易禁令保持。 |
| F7 **BLOCKER**（具体资金执行方案前）             | `stripe-setup.ts:154` 仅设置 Accounts v2 recipient/stripe_transfers，并将 fees/losses collector 设为 application。B10 §18 仍将最低收款额、税务、退款/拒付执行列为后续事项。Stripe 已获准，但捕获/转账模式与损失负担未因此定案。                                                                        | 用户需批准适用的 Connect 资金流与责任合同；不能默认 destination charge、无限期 manual capture、自动向卖家转嫁费用/负余额。可先编写不执行资金的中性 B20 契约；具体 charge/transfer executor 保持阻断。                                                    |
| F8 **DEFERRED**                                  | 当前 `marketplace_stripe_events` 的 claim 只找 setup binding；done/retry 按 lease fencing 更新，但返回 `{}`，`drainStripeEvents` 随后递增 processed。这不构成一次金融应用成功证明。                                                                                                                    | B22 的金融提交要原子校验有效 lease/evidence/业务状态并返回明确 applied/already-applied/stale/conflict。不可把 worker processed 数、ack 或单独 inbox done 当成付款/结算证明。不在 B20 修改 setup worker。                                                 |
| F9 **DEFERRED**                                  | `order_settlement_authorizations` 是处置许可，不是 Stripe refund/transfer 回执；`marketplace_order_cancellation_state` 明确输出 `provider_not_integrated`。                                                                                                                                            | B23/B24 按已有授权约束金额及累计执行，原收款引用、operation kind 和资金去向去重；部分失败/未知结果继续可追踪。争议、异常捕获、拒付等 B25 处理，不由客户端创造纠正金额。                                                                                  |
| F10 **OPTIONAL — 不建议**                        | 本轮没有证据需要第二套 Orders/payment ledger、通用追踪平台、统一会员+Order consumer 或新 cron。                                                                                                                                                                                                        | 保持原系统；仅在 B21/B22 证明现有结构无法持久化必要证据时，单独审批最小字段/表/claim 调整。不得为“统一架构”扩大 B20。                                                                                                                                    |

## 1. 哪些证据可以标记 Paid

**只有后续 B22 已验证、持久化并在当前事务权限内应用的 captured-payment 证据**。
必要检查：

1. 来自服务端 Stripe SDK 查询或正确渠道/secret 验证的原始签名事件；事件真实性
   只是入口检查，不代表金额、对象、用途和业务状态已经匹配。核销前取得足够的
   Stripe 对象/charge capture 事实；event 时间戳不是可靠状态顺序。
2. 与服务端 immutable binding 的 Stripe 对象、platform/account/test-mode、用途、
   Order、attempt、Buyer/customer、冻结总额和币种完全匹配。客户端不能指定这些事实；
   metadata 只能辅助关联，不能取代私有绑定。相同 customer 可有不同用途付款。
3. 已实际 capture，而非只是 authorization、requires_capture、创建成功、HTTP 200、
   checkout redirect、返回 client secret 或客户端声称 SDK 成功。
4. 一次 locked/idempotent 应用检查 Order/attempt/库存/Agreement/取消状态，记录
   唯一操作与证据，才允许原状态机转移。退款、transfer、bank payout 是后续独立事实，
   不能从 Paid 推导已入银行、已结算或无争议。

明确不能成为真实付款证明：Offer Accept、创建 Order、SetupIntent succeeded、
financial-capability ready、`p_success=true`、Demo/fixture、UI 选套餐或 webhook ack。

具体证据：`orders-service.ts:260–299` 在 Stripe setup 开启时阻断 payment，其他模式
调用模拟器；`order-financial-service.ts:19` 也阻止 Stripe 模式模拟。
SQL `202610140002_order_cancellation_settlement.sql:674` 只验证 trusted staging
service-role 后接受布尔结果，**不是** Stripe 验证器；以后不能直接给它套 webhook
就称为生产付款核销。必须保留模拟/真实来源隔离，旧模拟 Paid 不升级为真实资金证明。

## 2. 安全状态表

下表是 B20 必须表达的映射要求，未实现。具体 Stripe 状态细节需后续授权阶段核对
版本文档；本轮未联系 Stripe，不宣称已验证资金流/API 可用性。

| 已验证事实                                  | 允许的业务结果                                     | 不允许                                                     |
| ------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| 尚未创建/确认资金操作；合法 start           | 由原 authority 建立/恢复 processing attempt        | Accept→Paid                                                |
| 对象已建、待用户动作或正在处理              | 保持 processing；恢复同一对象                      | 客户端成功 →Paid；因 action-required 直接新扣款            |
| 网络丢失、timeout、5xx、查不到可靠结果      | unknown；保留原 attempt/操作；受控查询/原 key 恢复 | Failed 后换 key 盲建；简单将“暂时查不到”当无付款           |
| 已证实终态失败/取消且该对象不能继续 capture | 幂等失败应用；之后才可按原规则新 attempt           | 只凭一次 payment_failed 事件或非终态状态认定永远不会扣款   |
| capture 成功且绑定/经济/状态匹配            | 原子 Paid 一次；客户端随后读权威结果               | 重复事件重复发货/通知；按事件到达顺序回退 Paid             |
| capture 与已提出取消相遇                    | 先保留收款事实，在同一锁纪律下重算当前合法处置授权 | 丢掉已收款事实、另扣一笔或临时发明退款金额                 |
| 迟到成功对应不匹配/终态旧 attempt           | 持久化异常，待 B25 授权核对；不重写历史            | 为“对齐 Stripe”强行复活 Order/重开库存                     |
| refund/transfer 已请求或结果未知            | pending/unknown，原授权和 key 恢复                 | 请求成功就标 refunded/paid_out；只重试其中金额而不核对整体 |

“重新使用原 key”也受 Stripe 幂等保存条件限制；超过可靠窗口且对象引用未知时应
停止自动 create 并升级核对，而不是假设 SDK 重试能无限期保证不重复。

## 3. 并发、取消及不可变财务记录

- 复用 attempts 唯一索引和原 Listing→Order→attempt 锁序；网络请求在 DB 锁外。
  请求前先建立稳定意图，回写时重验 lease/业务版本/原对象身份。无跨 Stripe/PG
  原子事务，必须覆盖“Stripe 成功、DB 提交/响应失败”的窗口。
- 请求 UUID 防同一用户命令重放；绑定唯一性防多个 UUID 指向同一次逻辑付款；
  event 去重防回调重放；authorization+kind 唯一性防重复退款/转账。四者不能互相替代。
- `finalize_order_cancellation` 明确在 processing 时等待；原 resolver 使用行锁，
  成功后再调用 finalizer。这是可复用的 domain seam，不是实时 PSP 验证。
  unknown 不能绕过保护触发取消/到期释放；后台应有独立恢复入口，不以用户重新点击为前提。
- 已冻结 `v2_order_economics` 与 `order_settlement_authorizations` 决定金额分配；
  B23/B24 必须防累计超额退款、退款/转账冲突与重复处置。partial/unknown 不清除历史证据。
- B14 `guard_new_shop_transaction()` 和三个 BEFORE INSERT 触发器见
  `202610190004_shop_product_publication.sql:151–164`。保持关闭新 Shop
  Conversation/Offer/Order；付款实施不得借此绕过交易开放审批。

## 4. Webhook 与会员隔离

可复用的现有防护：`stripe-webhook-handler.ts:13–27` 只接受 POST、限制签名及 body
大小，原始字节交给 verifier；各 webhook route 关闭 body parser。
`stripe-setup.ts:483–553` 使用渠道对应 secret、SDK signature 验证、test-mode 与
account-scope 检查，allowlist 后 durable enqueue。配置/密钥只在 server。

限制：`202610160004_stripe_account_setup.sql:38,138–160` 的 scoped inbox 主键和
SKIP LOCKED/lease 可以复用其模式，但没有 Order/membership purpose 分流，claim
假定 setup owner binding；setup worker 无真实支付应用能力。不能因为签名通过就
让任意 Stripe 财务事件进入这个 consumer。B22 应先评估 purpose-filtered claim，
确保旧 worker 不抢金融事件；是否扩展现有结构需单独论证，不预设新 inbox/worker。

B12 `shop_membership_command`（`202610190003_shop_membership_authority.sql:151`）
只接受内部 proof，含幂等及跨 owner proof 锁，但本身不验证 Stripe。
不可将任意 Stripe eventId 填 proof。会员适配器应核验对应用户、账单、金额、币种、
周期/套餐/明确续费同意及之前是否已授予；同一个付款对象不能既给 Order Paid 又给
会员周期。B10 §16 禁止重复结算/重复授时，§1/Trial 禁止从默认选项或免卡 Trial
推导自动扣费许可。该适配器是独立后续授权，不在 B20 实施。

## 5. 用户尚需决定什么

**已决定：Stripe 是唯一服务商，不再询问选择其他服务商。** 尚需批准的是：

1. Connect 具体资金流（计划中的平台 capture + 延后独立 transfer 是否采用），
   capture/transfer 时点与既有业务规则兼容性，以及对应 account/capability/地域支持。
2. 平台/卖家承担 Stripe 费用、refund 不退费用、dispute/chargeback、负余额/追偿的
   责任；既有 setup 的 application fee/loss defaults 不能替代明确产品/运营决定。
   不新增买家费用或改历史 seller gross。税务、最低支付额等尚未定义的执行政策也
   必须在实际收费前解决；不把它们变成 B20 新建 accounting 子系统的理由。
3. 批准 B20 contract-only 本地修改与测试；此后 B21/B22 的证据持久化及 trusted apply
   另行审批。需要 SCA/3DS/确认动作时，保持 UI 冻结并先请求具体交互例外。

这些决定阻断相关真实执行/具体资金模型，不阻断本报告的完成，也不要求为纯类型
和映射辅助函数预先创建远端账号。当前账号能力、Webhook 部署及 SDK 版本兼容性
本轮均 **NOT TESTED**。

## 最小下一步与验收边界

若单独批准 B20 实施：优先只改 `payment-provider-boundary.ts`，必要时一个纯
`order-provider-contract.ts` helper，增加本地契约用例。涵盖用途/对象伪造、金额币种、
external 零调用、capture 与 authorization、未知结果、重复/乱序、取消/迟到成功和
transfer≠bank payout。类型标签不能替代运行时验证，纯 helper 也不能冒充真正 PSP proof。

持久化唯一绑定、financial inbox/lease claim、trusted resolver、真实收费、退款、转账
和争议处理分别留给 B21–B25。没有特定必要性证明时不增表/API/UI/基础设施。
本轮未更改应用、迁移、测试、UI、凭据、B20 计划或 task breakdown；仅创建本报告。
未执行测试、Stripe 操作、Staging/Production 访问、部署或 Git mutation。

**B20 SECURITY REVIEW COMPLETE — IMPLEMENTATION NOT STARTED**
