# B18 Staging Read-Only Preflight

**B18 READY FOR STAGING DEPLOYMENT APPROVAL**

本轮结论仅表示可以进入独立部署审批，不表示已经部署或完成云端运行验收。
检查时间：2026-10-20 02:37:03–02:38:05 UTC（本地 2026-10-19 晚间）。
本轮只新增本报告；未修改应用、UI、迁移、其他文档、环境文件或 Git 状态。

## 1. 状态定义

| 状态               | 本报告中的含义                                                                |
| ------------------ | ----------------------------------------------------------------------------- |
| VERIFIED           | 本轮实际读取的项目身份、数据库目录、历史记录或聚合结果支持该结论。            |
| STATIC REVIEW ONLY | 由本地代码、待部署 SQL 或已部署函数定义审查得出，不能替代普通用户运行时验证。 |
| NOT TESTED         | 本轮未执行，不得记为通过。                                                    |
| BLOCKED            | 已发现的阻断项；本轮未发现部署审批阻断项。                                    |

## 2. 环境、实际连接与只读边界

**VERIFIED**：复用已有安全凭据读取方式，通过 Management API 直接 GET：

`https://api.supabase.com/v1/projects/pcaqxezdfxofysghssyo`

实际响应严格匹配：

- 项目名：`western-marketplace-staging`。
- Project Ref：`pcaqxezdfxofysghssyo`。
- SQL 只向同一显式目标的 `/database/query` 发送，Management API 请求同时设置
  `read_only: true`；没有使用 CLI 默认 linked 项目，没有枚举其他项目。
- 数据库：`postgres`；PostgreSQL：`17.11`。
- 两次查询的 `current_user` 和 `session_user` 都是
  `supabase_read_only_user`；`transaction_read_only` 都返回 **`on`**。
- 第二次目录核验中 `txid_current_if_assigned() IS NULL` 返回 true。

两次远端 SQL 都采用以下显式事务包络，返回成功，末尾均执行 `ROLLBACK;`：

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '45s';
SELECT ...; -- 目录、定义、历史及聚合查询，无业务 RPC
ROLLBACK;
```

没有远端 INSERT、UPDATE、DELETE、DDL、迁移、Accept、scheduler、支付或邮件操作。
查询中的事务局部 timeout 不修改持久配置。

**重要权限限制**：该只读管理员角色的 `rolbypassrls = true`。
本轮所有管理员目录／数据读取只证明实际状态和静态兼容性，**不能证明普通
owner、其他用户或匿名用户的运行时授权正确**。未冒充用户，未调用 B18 RPC。

## 3. 迁移一致性

**VERIFIED**：

| 项目                   | 结果                                                             |
| ---------------------- | ---------------------------------------------------------------- |
| 本地迁移文件数         | 73                                                               |
| Staging 已部署版本数   | 72                                                               |
| 远端未知版本           | 0                                                                |
| 本地重复版本／顺序冲突 | 未发现；B18 排在 B17 之后                                        |
| 唯一待部署项           | `202610190008_shop_costs_expenses.sql`                           |
| 远端 B18 历史行        | 不存在                                                           |
| 72 条远端历史行        | 两次本轮快照均与此前 B17 部署后回执的整行 MD5 一致，无历史行漂移 |
| B17                    | `202610190007_discovery_activity_facts.sql` 已部署               |

源码一致性证据链：

- 71 个 B16 及以前本地迁移 SHA256 与此前已验证的本地基线全部一致。
- 此前 B16 源码／归档检查记录 `nameOrSourceDrift=[]`；本轮远端原有历史行
  及本地源码均未改变，复用这份已完成的对应关系检查，不重新执行迁移。
- B17 本地文件与远端归档为字节一致，其 SHA256 同为：
  `fabeead7852cfb7b8fa805b2afb3dca7175620d4869c88915d278c02dba731ea`。
- 部分旧 CLI 归档按 statements 数组保存，语句末尾分号不包含在各数组元素中。
  因此直接用换行拼接归档再与原文件逐字节比较会产生序列化差异，不能把这种
  差异认作新漂移。本报告不声称所有旧归档都与原文件逐字节一致；采用上述
  已验证对应关系、未变的源码哈希和完整远端历史行哈希进行复核。

本轮待审批的 B18 文件 SHA256：

`40a52d91ff5eeabf60aa724d7fa98e90da847ca092652de34365b8047933b885`

没有改写历史迁移、历史归档或版本登记。

## 4. 新对象与依赖

**VERIFIED**：B18 所用的以下 relation/index/type、函数名的所有 overload 及触发器名
均未发现现有对象冲突，不能把此结果误写成这些 B18 对象已经安装。

**STATIC REVIEW ONLY**：实际待部署对象为：

| 私有表                                          | 新字段数 | 用途                            |
| ----------------------------------------------- | -------- | ------------------------------- |
| `marketplace_private.shop_product_costs`        | 8        | 当前私有商品成本                |
| `marketplace_private.shop_expenses`             | 13       | 可编辑／软删除经营费用          |
| `marketplace_private.shop_order_cost_snapshots` | 8        | 新 Order 首次创建时的不可变成本 |
| 总计                                            | **29**   | 不向现有 public 表新增成本字段  |

五个函数：

1. `marketplace_private.shop_expense_data`。
2. `public.marketplace_shop_product_cost`。
3. `public.marketplace_shop_expenses`。
4. `marketplace_private.capture_shop_order_cost`。
5. `marketplace_private.protect_shop_order_cost`。

两个触发器：`b18_capture_shop_order_cost`、`shop_order_cost_immutable`。
另有一个 active expense 日期／ID 索引、三条 owner SELECT policy。

**VERIFIED**：

- `shops`、`listings`、`orders` 被引用字段的 uuid/text/jsonb/timestamptz 类型匹配。
  `shops.owner_id` 有已验证唯一约束；`orders.id` 有已验证主键，可作为新 FK 目标。
- `auth.uid()`、`marketplace_private.is_western_user()`、`sha256(bytea)`、
  `convert_to(text,name)`、`hashtextextended(text,bigint)`、
  `pg_advisory_xact_lock(bigint)` 均存在。
- B17 的来源列、约束及 `account_activity_attribute_source` 触发器存在，RLS 已启用。
- 本轮读取的 7 个相关既有函数，包括 Accept、Western 校验、B14 guard 和 B17
  函数，其定义 MD5 与 B17 部署后回执一致。
- 7 个既有 event trigger 的定义哈希及启用状态与此前回执一致，未出现新增依赖。

## 5. 安全审查

以下均为 **STATIC REVIEW ONLY**，部署后必须重新读取真实 ACL／owner 验证：

- 三张新表显式开启 RLS；向 PUBLIC、anon、authenticated、service_role 撤销
  所有直接表权限。owner SELECT policy 不等于授予普通用户原始表读取权限。
- 五个函数均设置空 `search_path` 并撤销上述角色的默认 EXECUTE；仅两个公开
  owner RPC 向 authenticated 授予 EXECUTE。
- 两个公开 RPC 和捕获函数使用 SECURITY DEFINER；DTO helper 和不可变保护
  函数为 INVOKER。必须由可信迁移身份创建，保持与现有 `postgres` owner 模式一致。
  本轮未创建对象，不能把未来 owner 标为已验证。
- 远端实际 `public`/`marketplace_private` schema 不允许 anon/authenticated CREATE，
  可信 postgres 具有所需 CREATE 权限。已审阅默认 ACL，迁移末尾显式撤权覆盖相关
  普通角色默认授权；部署后仍需核验最终效果。
- 每次 RPC 根据 `auth.uid()` 和真实 `auth.users` 的已验证 Western 邮箱判定身份；
  Shop 由 `shops.owner_id` 查询，不接受客户端指定 owner/Shop。
- 成本写入核对 Listing seller、Shop channel、CAD；费用读取和写入同时限定真实
  owner 与 Shop。匿名、跨用户的预期拒绝属于设计结论，不是本轮用户会话实测。
- 私有快照没有加入 public Listing、Order JSON、Shop directory、Favorites 或
  Messages DTO；没有扩大 Buyer／其他 Order participant 的数据权限。

## 6. 数据兼容性与事务语义

**VERIFIED（仅管理员只读聚合，不是运行时权限验证）**：

| 只读检查                                            | 结果 |
| --------------------------------------------------- | ---- |
| Shop 行数                                           | 0    |
| Shop Listing 行数                                   | 0    |
| Shop snapshot Order 行数                            | 0    |
| 重复 Shop owner                                     | 0    |
| 非 CAD Listing                                      | 0    |
| Order 必填来源 UUID／CAD／accepted_at 异常          | 0    |
| 本轮读取的 Orders/Listings/B17 constraints 未验证项 | 0    |

**STATIC REVIEW ONLY**：

- 本次创建全新空表，不对现有业务行新增 CHECK、不 backfill、不改历史 Order。
  新 FK 指向现有 Orders 主键，没有迁移旧成本或清洗旧数据的步骤。
- 成本 bigint 范围 `0..9007199254740991`，可为 NULL；NULL／缺失表示 Unknown，
  明确 0 为已知零成本。费用必须为正整数分，currency 固定 CAD。
  客户端用 BigInt 解析／格式化，API 使用安全整数检查，不静默舍入。
- 费用日期在服务端按 Toronto 自然日检查；三类费用、description 长度及输入键
  有 API/SQL 双层限制。列表使用日期／UUID 游标、20 条结果加一条 lookahead。
- 创建 UUID 和初次请求 digest 防重复；revision CAS 防止 stale edit/delete。
  软删除保留记录并排除 active list，重试不会复活 tombstone。
- Order AFTER INSERT 触发器与原 Accept 属于同一数据库事务；捕获失败会使事务
  失败。Listing-first 锁与当前成本操作协调；Order 主键快照及现有 Accept replay
  防止重复捕获。没有异步补写，没有改 Accept RPC。
- 不可变触发器拒绝快照 UPDATE/DELETE；以后改当前成本不改旧快照，未知成本
  不会在以后自动补为已知。历史 Order 不触发新 INSERT capture。
- Suspended 私有管理只要求真实 owner，不依赖公开 membership eligibility；
  不授予公开发布或交易能力。

**VERIFIED**：以下三个 B14 BEFORE INSERT 触发器均为 `tgenabled='O'`，共用
`guard_new_shop_transaction()`，其函数定义对 Shop Listing 明确抛出 42501：

- `b14_new_shop_conversation_guard`。
- `b14_new_shop_offer_guard`。
- `b14_new_shop_order_guard`。

因此当前 **新 Shop 交易入口保持关闭，守卫保持启用**。未通过实际 Accept 测试，
也未关闭任何守卫。B18 本地原子性测试属于先前独立本地证据，不算本轮云端通过。

## 7. UI／API／RPC 一致性

**STATIC REVIEW ONLY**：

- `types/shop-costs.ts`、`lib/shop-costs.ts`、`lib/shop-costs-api.ts`、
  `lib/server/shop-costs-repository.ts` 与两个 `/api/shop` 路由的参数／返回字段匹配。
  SQL 的 `expense_on/category` 显式投影为 DTO 的 `on/kind`。
- API 复用真实会话 `getUser()`、Western 校验及现有同源写入检查；数据库再次核验。
  现有 server client 使用公开 key + 用户会话，不需要把 service-role key 交给浏览器。
- 前端没有直接访问三张私有表，走共享请求层 → API → 窄 RPC。
  返回 DTO 明确选字段，不包含内部 owner/digest；错误不暴露原始 SQL 内容。
- 私有响应 no-store，现有 PWA NetworkOnly 规则包含 `/api/shop`。
- Manage Products 仅在真实 Shop 管理区域接线成本／费用；Resale 与 Demo 商品不注入
  真实成本入口。未修改 B15/B16 公共查询及 Favorites 权限。
- Shop Analysis 仍调用 demo fixture/local state，通过 `onAdd` 使用 Demo ExpenseDialog；
  真实费用区通过 `onSave` 调 owner API。两者没有合并，未实现 B19 聚合。
- 未发现 B18 修改 B17 producer、Settings、Market 布局或交易状态机。
  本轮只读检查，没有重新跑浏览器、构建或会写入测试夹具的测试。

## 8. 风险、阻断及未完成验收

**BLOCKED：无已发现的部署审批阻断项。**

以下为 **NOT TESTED**，不可写成 Staging PASS：

1. B18 部署后的真实表／列／函数／触发器、owner、ACL 和 RLS 最终安装效果。
2. 普通 owner、其他账号及匿名的真实 API/RPC 读写权限；管理员 BYPASSRLS 查询不能代替。
3. 真实费用／成本跨刷新、重新登录、Suspended 会话持久化及客户端缓存行为。
4. 云端 stale edit/delete、并发、响应丢失、软删除重试与分页行为。
5. 真实 Shop Order 首次 Accept 的成本捕获、回滚和并发；当前 B14 阻止该入口，
   不得为 B18 验收擅自解除。保留至单独批准的交易任务。
6. 部署后的 UI 运行回归；本轮仅复核源码及此前本地验收文档。

风险边界：Staging 当前零 Shop 数据，无法借现有数据证明 populated Shop runtime。
未来临时测试数据写入、不可变快照或保留型费用记录的清理／留存必须单独批准，
不可先创建再假定能够删除。建表和 Orders 新触发器会涉及短暂 DDL 锁，部署审批应
约定 lock/statement timeout、单迁移原子执行和失败停止策略。

## 9. 单独部署审批建议

建议进入单独的 **B18 Staging Deployment** 审批，仅限上面 SHA256 对应的
`202610190008_shop_costs_expenses.sql`；不建议批量应用迁移。

部署时重新确认同一项目、迁移头和无对象冲突，由可信身份执行；事务内原子登记
原始迁移归档。部署后只读核验实际 owner/ACL/RLS、函数定义、触发器、历史保持、
B14 拒绝入口仍有效及 schema cache。新费用／账户／Listing 测试另行明确授权。
本报告不是部署授权，不自行提交任何部署请求。

## 10. 可复核证据与本轮操作清单

以下临时查询／回执位于操作系统 `%TEMP%`，未写入项目测试目录，不含凭据：

- `b18-preflight-readonly.sql`、`b18-preflight-metadata.json`。
- `b18-preflight-integrity.sql`、`b18-preflight-integrity.json`。
- 复用之前的 `b16-preflight-local-baseline.json`、`b16-preflight-comparison.json`、
  `b17-deploy-after.json` 和 `b17-deployment-verification.json` 作为历史证据，不改写它们。

两份实际 SQL 的 SHA256：

```text
b18-preflight-readonly.sql
5284025e8ffcfd46b4550f6487b1f937dcadcce51a0fbb031e84bc2d0591188e
b18-preflight-integrity.sql
36c81bd553ba276800a6105c5430c8d8c26aa184bc41696ba1d0597a647f7012
```

远端成功只读事务 2 次，均 `transaction_read_only=on`，均正常 ROLLBACK；
业务 RPC 执行 0 次。未部署 B18，未执行迁移、数据库写入、用户测试、邮件、支付或
scheduler，未访问 Production，未修改 UI、环境文件或 Git 状态，未启动 B19。

**B18 READY FOR STAGING DEPLOYMENT APPROVAL**

**B18 STAGING NOT DEPLOYED**

**B18 STAGING RUNTIME ACCEPTANCE NOT PERFORMED**

**B19 NOT STARTED**
