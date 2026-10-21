# B19 Staging Read-Only Preflight

**B19 READY FOR STAGING DEPLOYMENT APPROVAL**

检查日期：2026-10-20。结论仅允许进入独立部署审批，不表示已部署或完成云端运行验收。
本轮仅新增本报告；不修改应用、UI、迁移、其他文档、环境文件或 Git 状态。

## 1. 证据等级

| 状态               | 含义                                                                   |
| ------------------ | ---------------------------------------------------------------------- |
| VERIFIED           | 本轮实际读取的项目身份、远端目录、迁移历史及基线比较结果               |
| STATIC REVIEW ONLY | 待部署 SQL、应用源码及已验证未变化的依赖定义审查；不是普通用户运行测试 |
| NOT TESTED         | 本轮未执行，不能标为云端 PASS                                          |
| BLOCKED            | 已确认的部署审批阻断项；本轮未发现此类问题                             |

## 2. 实际连接与只读证据

**VERIFIED**：显式 GET
`https://api.supabase.com/v1/projects/pcaqxezdfxofysghssyo`，实际返回：

- Name：`western-marketplace-staging`。
- Ref：`pcaqxezdfxofysghssyo`。
- Status：`ACTIVE_HEALTHY`。

只有身份完全匹配后才向该 URL 的 `/database/query` 发送元数据 SQL；
Management API 同时设置 `read_only: true`。没有使用 CLI 默认链接、枚举其他项目、
访问 Production 或调用业务 RPC。复用既有凭据读取流程，未输出或修改任何凭据。

所有远端 SQL 使用以下事务边界，并成功返回：

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '35s'; -- 补充查询为 25s
SET LOCAL lock_timeout = '3s';
SELECT ...; -- 目录、定义摘要、权限及迁移历史，无业务函数执行
ROLLBACK;
```

保留结果的两次核验时间分别为 **2026-10-20 16:05:41.520710 UTC**、
**16:06:36.194640 UTC**。两次均返回：

- `transaction_read_only = on`。
- `current_user = session_user = supabase_read_only_user`（主查询核对两者）。
- PostgreSQL `17.11`，database `postgres`（主查询）。
- `txid_current_if_assigned() IS NULL = true`。

另有前两次元数据请求已正常 ROLLBACK、只读角色检查已通过，但随后本地历史文件
比较脚本因路径处理而失败；修正仅在临时命令内完成，再次只读核对成功。
合计四次远端只读事务，未产生写入或部署请求。没有创建项目内查询脚本或结果文件。

**重要限制**：该只读管理员具有 `BYPASSRLS=true`。目录中的权限与策略只能支持
静态判断，不能替代匿名、owner、其他账号的实际授权验收；本轮没有冒充这些用户。

## 3. 迁移一致性

| 检查              | 结果                                                   | 状态     |
| ----------------- | ------------------------------------------------------ | -------- |
| 本地迁移          | 74 份；版本无重复                                      | VERIFIED |
| Staging 历史      | 73 条；版本无重复                                      | VERIFIED |
| 唯一待部署        | `202610200001_shop_analysis.sql`                       | VERIFIED |
| 未知远端版本      | 0                                                      | VERIFIED |
| 前 73 条历史行    | 逐版本整行 MD5 与既有 `b18-deploy-after.json` 完全一致 | VERIFIED |
| 前 71 份本地迁移  | SHA-256 与既有 B16 本地基线一致，漂移 0                | VERIFIED |
| B17、B18 本地源码 | 与各自已完成部署回执的批准 SHA-256 一致                | VERIFIED |
| B19 同名函数冲突  | 所有 schema 的 `pg_proc` 中同名函数数量为 0            | VERIFIED |
| B18 字段依赖      | 29 字段与 B18 部署回执一致，漂移 0                     | VERIFIED |
| 关键依赖函数      | 5 个定义摘要及 ACL 与 B18 回执一致，漂移 0             | VERIFIED |

B19 版本：`202610200001`。原始文件 SHA-256 与本地资格报告一致：

```text
622755482533ec34dc0c5e9bc696abba6f11a222e219a14e4de9393a36bbde27
```

依赖源码 SHA-256：

```text
B17 202610190007_discovery_activity_facts.sql
fabeead7852cfb7b8fa805b2afb3dca7175620d4869c88915d278c02dba731ea
B18 202610190008_shop_costs_expenses.sql
40a52d91ff5eeabf60aa724d7fa98e90da847ca092652de34365b8047933b885
```

完整远端历史行未变化，结合此前已完成的源码归档一致性证据和本轮本地源码摘要，
未发现历史漂移。本轮没有重放历史迁移，也没有重新下载历史业务图片或记录。

关键函数定义 MD5（本轮远端目录，与已有回执一致）：

| `marketplace_private` 函数                            | MD5                                |
| ----------------------------------------------------- | ---------------------------------- |
| `shop_entitlements(uuid,timestamptz)`                 | `b9a1b429b2e92b71a67da4914186d64f` |
| `completed_order_facts(uuid,timestamptz,timestamptz)` | `ad4f7a1a90da402358887888fa108e38` |
| `capture_shop_order_cost()`                           | `622b50b7ab422ec91bdf09540b03aa0d` |
| `guard_new_shop_transaction()`                        | `1329a466cf8b763abf36f6fbb06b94e8` |
| `is_western_user()`                                   | `84f968ac2b0b11a37258e4be20cfc1fb` |

## 4. 安全与依赖审查

**VERIFIED**：上述依赖 owner 均为 `postgres`，`search_path` 均为空。
B12/B17 helper、B18 capture 与 B14 guard 不向 anon/authenticated/service_role
开放 EXECUTE；`is_western_user` 按现有设计允许 authenticated 执行。
相关私有表均启用 RLS，anon/authenticated/service_role 的直接 SELECT 权限均为 false。
现有 B18 owner SELECT 策略存在，但不因本轮检查而扩大任何直接表权限。

**STATIC REVIEW ONLY**：待部署 RPC
`public.marketplace_shop_analysis(p_range text)` 为 STABLE SECURITY DEFINER，
空 search_path、关系全限定；仅 SELECT/CTE，不更新 Orders、成本、费用、事件或历史。
从 `auth.uid()`、Western 验证和真实 Shop owner 推导身份；不接受 Shop/owner/tier/time
参数。复用 B12 `canUseShopAnalytics`，拒绝无 Shop、未开始、Suspended；有效 Plus、
Pro、Trial、Grace 依据 B12 服务端时间与权益处理。没有另建会员权限规则。

SQL 显式撤销 PUBLIC、anon、authenticated、service_role 原有函数权限，再仅向
authenticated 授 EXECUTE；不改变私有表或 schema 权限。未来部署必须使用可信
`postgres` 创建身份并核验实际 owner/有效 ACL。本轮函数尚不存在，因此**不能声称
B19 的最终 owner、ACL、PostgREST 安装效果已通过验证**。

应用链路复核：

- `pages/api/shop/analysis.ts`：仅 GET、仅 `range` query，`private, no-store`。
- `lib/server/shop-analysis-repository.ts`：现有 cookie 会话客户端、
  `requireMarketplaceUser`、一次 RPC；无 service-role analytics 客户端。
- `lib/server/marketplace-auth.ts`：真实 `getUser()`、已验证 Western 邮箱。
- `lib/shop-analysis-validation.ts`：白名单 DTO、日期/金额/数组边界；过滤未知私有字段。
- `components/shops/real-shop-analysis.tsx`：身份隔离、迟到响应丢弃、权益边界重取；
  live 失败不回退 Demo。B18 ExpenseDialog 写入仍是独立原有命令，不属于分析读取路径。
- `components/shops/shop-analytics.tsx`：真实数据披露与明确 Demo 分支；不向 B15
  公共 API 注入成本或财务数据。

## 5. 计算口径与查询边界

下列均为 **STATIC REVIEW ONLY**，不是云端财务或普通用户运行验证：

- 一次查询时点、Toronto 日历边界、周一周起点；四种枚举期间；最多 366 日趋势、
  20 个产品、5 个畅销产品、5 个收入组加 Other。汇总覆盖全部符合条件的事实，
  UUID 稳定排序，不把截断列表伪称完整。未来日期为 NULL。
- B17 `completed_order_facts` 每 Order 一行，用 EXISTS 验证完成事件而不是连接放大。
  UU Pay 需 paid 和匹配 Protection 完成；external 需双方确认、无争议且未 refunded。
  Manual Sold、仅 Accept、未付款/open Order 不产生销售额。
- B18 Order 成本快照主键 `order_id`、V2 economics 主键 `order_id`，连接不放大订单。
  匹配冻结 Shop/channel/seller/Listing、capture 时间和 accepted item price。
  不用当前产品成本重建历史成本，不回填历史 Order。
- **Recorded Product Sales** 是已完成商品记录额，排除配送及保护费，不声称已收款、
  已结算或已验证外部付款。UU Pay/external 分开显示。
- NULL 成本与已知 0 不同；缺来源、币种、有效完成证据或成本时利润不可用。
  CAD 不与其他币种合并。退款订单排除额不当作实际 refund cashflow；退款处置
  不完整时不生成利润。已软删除 expense 排除，安全整数溢出拒绝。
- B17 仅记录的 authenticated Shop/Listing opens 不当作总流量、独立访客、
  promotion impressions 或广告归因。Pro 推广归因仍 unavailable，Plus 不额外锁产品统计。

**VERIFIED：索引与结构**：主查询核对 18 个相关索引，补充查询核对 7 个完成事实索引，
均 valid。存在 `shops_owner_id_key`、`account_activity_owner_time(owner_id,occurred_at,kind)`、
`shop_expenses_owner_date(shop_origin_id,expense_on,id) WHERE deleted_at IS NULL`，
cost/economics/external/protection 的 Order 主键及 `transaction_events_order`。
所需 Orders、events、activity、economics 字段存在且类型兼容。

**性能风险，不作虚假 PASS**：现有 `orders_seller` 索引是 `seller_id`，B19/B17 按
不可变 `seller_origin_id` 及完成时间筛选，没有相同前导列的现成索引。因此不能声称
Orders 扫描已由该索引优化；固定日期/结果边界也不等于扫描行数硬上限。本轮不执行
EXPLAIN ANALYZE 或真实聚合，未证明大数据量 SLA。独立运行验收需要关注计划、延迟、
并发及超时；若需要索引，另行审批，不在预检改 SQL。本轮未发现因此造成的结构冲突
或已证实的安全/财务正确性阻断。

## 6. 既有守卫与改动规模

**VERIFIED**：以下三个触发器均 `tgenabled=O`，仍连接原
`marketplace_private.guard_new_shop_transaction()`，其定义摘要未变化且继续拒绝新 Shop 交易：

- `b14_new_shop_conversation_guard` — public.conversations BEFORE INSERT。
- `b14_new_shop_offer_guard` — public.order_requests BEFORE INSERT。
- `b14_new_shop_order_guard` — public.orders BEFORE INSERT。

B18 `b18_capture_shop_order_cost` 和 `shop_order_cost_immutable` 均启用。
快照 FK 为 DELETE RESTRICT，成本可 NULL/0、CAD 及金额约束均存在并 validated。

**STATIC REVIEW ONLY**：B19 仅新增一个函数及其 ACL；0 表、0 字段、0 索引、0 触发器、
0 worker/cron/counter/materialized view、0 支付动作、0 公共财务端点。不会打开 B14。

## 7. 阻断、未验证与下一审批

**BLOCKED：无已确认的部署审批阻断项。**

以下均 **NOT TESTED**：

1. B19 部署后的函数 owner、有效 ACL、schema cache 与真实 PostgREST/API 调用。
2. 普通 owner、其他账号、匿名，以及 Plus/Pro/Trial/Grace/Suspended 云端真实会话。
3. 真实 populated 数据集的聚合对账、查询性能、并发、缓存及多设备权益变化。
4. Provider 收款、退款、settlement、payout、成熟 Protection/scheduler 和 B26。
5. 新的浏览器或本地数据库测试：本轮只复核此前资格报告，不把它们重标为 Staging PASS。

建议进入**单独的 B19 Staging Deployment 审批**，仅对应以上确切 SHA-256；部署前
再次核对目标、历史头、可信创建 owner 与无冲突。保持单迁移原子执行、原始 SQL
字节归档、一次历史登记及有界超时；发生失败或不确定结果后停止写入，只读调查。
这段是后续计划，不是本轮执行记录或部署授权。普通用户/业务写入运行验收另行授权，
不能为填图表擅自创建不可删除交易历史。

未部署 B19，未创建账号/Shop/Order/Expense，未执行支付或邮件，未修改 UI、应用、
迁移、凭据或环境，未访问 Production，未执行 Git 操作。未开始 B20 或推荐排序。

**B19 READY FOR STAGING DEPLOYMENT APPROVAL**

**B19 STAGING NOT DEPLOYED — STAGING RUNTIME ACCEPTANCE NOT PERFORMED**
