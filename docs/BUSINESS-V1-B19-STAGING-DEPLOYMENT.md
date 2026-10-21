# B19 Staging deployment verification

Target: `western-marketplace-staging` / `pcaqxezdfxofysghssyo` only.
Date: 2026-10-20. Authorized scope: single migration, then read-only verification.

Approved source: `202610200001_shop_analysis.sql` (version `202610200001`).
SHA-256: `622755482533ec34dc0c5e9bc696abba6f11a222e219a14e4de9393a36bbde27`.
Original bytes: 11702. No source/migration/UI/environment changes.

## Before deployment

At 16:13:03.533499 UTC, explicit-target Management API identity matched Staging.
Read-only metadata transaction returned `supabase_read_only_user`,
`transaction_read_only=on`, then ROLLBACK. Local 74 migrations, remote 73;
B19 is the only pending version. Previous 73 complete history rows match the B18
deployment receipt. Existing 245 functions, relations, columns, constraints,
policies, indexes, triggers, effective B18 permissions, event triggers and default
ACL metadata show no drift from that receipt. Three B14 guards remain enabled.
Historical local source hashes match their previously verified baselines.

Two earlier read-only requests were rejected by Management API input validation
before SQL execution because PowerShell serialized a file-backed string as an
object. Explicit string serialization corrected the request; no write had been
attempted. This does not alter migration or application code.

## Verified execution package

- One BEGIN/COMMIT transaction; lock timeout 5s, statement timeout 60s.
- Original SQL execution text retained, with only transaction controls,
  precondition checks and one migration-history INSERT added around it.
- Original full SQL bytes archived via Base64 decode into history `statements[1]`.
- Source transport hash and removal of wrapper insertions both reproduce the
  approved source exactly. No JavaScript replacement-string SQL embedding.
- Atomic guard requires postgres creator, unchanged 73-row history and absent
  B19 function/version; archive SHA-256 checked before COMMIT.
- Execution package SHA-256:
  `bcaae40acd626f6052d234e984c393d4810bcabfad4f4bdcc719b9b3df1f454f`.
- Expected installed function body SHA-256:
  `3597717f35f513d9078b717141c4421b2f23b6820fab3de4f13d8c2b7fb36de7`.

## Transaction outcome

**PASS — one write request returned successfully.** The verified package was sent
only to the explicitly checked Staging Management API `/database/query`, with
`read_only=false`. The original SQL and exactly one history registration committed
in the same transaction. No migration replay, retry, backfill or business DML.
The final pre-write read-only check again compared all prior history/schema
metadata immediately before submission and passed.

The initial attempt to launch a long inline command was rejected by Windows
process creation (OS 206), before a process or HTTP write request existed. The
same verified Base64 package was then placed in a task-owned system temporary
file, decoded and its package hash rechecked before the **single actual HTTP
write request**. A local create-once attempt marker prevents accidental repeat
submission. These operational files contain SQL/attempt metadata, no credentials;
no project source file was used as a transport file.

## Post-deployment read-only verification

At **16:16:21.415602 UTC** and **16:17:11.506210 UTC**, explicit-target read-only
transactions returned `transaction_read_only=on`, role
`supabase_read_only_user`, and no assigned XID, then ROLLBACK. The role has
`BYPASSRLS=true`; this is administrator metadata evidence, not ordinary-user
runtime authorization. No new analytics RPC was executed.

| Check                                | Result                                                                                                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local/applied history                | **PASS — 74/74**                                                                                                                                                  |
| B19 history registration             | **PASS — exactly 1**, name `shop_analysis`                                                                                                                        |
| Source archive                       | **PASS — one statement, byte-identical** to all 11702 original bytes                                                                                              |
| Archived source SHA-256              | **PASS — approved `62275548…6bbde27`** (full value above)                                                                                                         |
| Previous 73 complete history records | **PASS — every version/row MD5 unchanged**                                                                                                                        |
| Installed function body SHA-256      | **PASS — exact expected `3597717f…b36de7`** (full value above)                                                                                                    |
| Function signature/result            | **PASS — `public.marketplace_shop_analysis(p_range text)`, jsonb, non-set**                                                                                       |
| Language/volatility                  | **PASS — plpgsql, STABLE (`provolatile=s`)**                                                                                                                      |
| Ownership/security                   | **PASS — postgres, SECURITY DEFINER, empty search_path**                                                                                                          |
| Function ACL                         | **PASS — `{postgres=X/postgres,authenticated=X/postgres}`**                                                                                                       |
| Effective EXECUTE                    | **PASS — authenticated true; anon/service_role false; PUBLIC false**                                                                                              |
| Previous functions                   | **PASS — all 245 complete definitions/ownership/ACL metadata unchanged**                                                                                          |
| Function count                       | **PASS — 245 → 246; only B19 added**                                                                                                                              |
| Other checked metadata               | **PASS — relations, columns, constraints, policies, indexes, triggers, effective B18 table permissions, event triggers, default ACL and prerequisites unchanged** |
| B14 guards                           | **PASS — all three enabled `O`, same trigger definitions and guard function**                                                                                     |
| PostgREST reload mechanism           | **PASS — existing `pgrst_ddl_watch` / `pgrst_drop_watch` enabled and unchanged**; actual API/schema-cache request not tested                                      |

Full installed `pg_get_functiondef` SHA-256 (canonical PostgreSQL definition,
different from original file/body hashes by design):
`a53192fc4601976c1f6293e75e44dce12fd70de13a8dde692c718547a118333c`.

A supplemental metadata SELECT initially had a missing closing parenthesis;
the two diagnostic attempts failed SQL parsing. Correcting only the temporary
read-only query produced the final result above. No migration/application change
or additional write request was made. No verification failure was hidden or
repaired by altering installed business logic.

## Installed business/security definitions — static evidence only

The actual installed body matches the approved, locally qualified SQL exactly.
The following checks are **PASS for installed definitions / STATIC REVIEW ONLY**,
not a claim of real financial accuracy or end-user runtime behavior:

- Identity derives from `auth.uid()`, verified-Western helper and owned Shop;
  no caller-supplied owner/Shop/tier/clock. SECURITY DEFINER's explicit owner check
  remains necessary; RLS alone is not claimed to protect this privileged function.
  Existing private RLS/table access restrictions are unchanged.
- B12 `shop_entitlements` remains unchanged: effective Plus/Pro/Trial/Grace and
  Suspended authority reused; no new membership/paywall system.
- B17 completion and activity definitions remain unchanged. One Order per fact,
  EXISTS completion evidence, and unique cost/economics joins prevent event
  multiplication. Authenticated opens are not total traffic, unique visitors or
  promotion attribution. Pro promotion remains unavailable without collected facts.
- Sales require eligible completion, frozen Shop/Listing/seller provenance, CAD
  and accepted item price corroboration; manual Sold, Accept alone and unpaid/open
  Orders create no revenue. UU Pay and external exchange are distinguished.
- B18 frozen costs, not current product cost, drive COGS. NULL differs from zero;
  absent cost/source/currency/valid fact or uncertain refund disposition makes
  profit unavailable. No currency conversion or fabricated refund cashflow.
- Reporting uses trusted server time and Toronto boundaries, four enumerated
  periods, at most 366 daily points / 20 products / 5 best sellers / 6 distribution
  groups, with complete aggregate remainder and stable ordering.
- Read path is STABLE and contains SELECT/CTE only. No new tables, counters,
  indexes, triggers, workers, cron jobs, payment actions or public financial access.

## Existing data and verification scope

Before/after whole-row ordered digests and counts match exactly for:

| Relation                 | Rows | MD5 unchanged                      |
| ------------------------ | ---- | ---------------------------------- |
| public.orders            | 5    | `c46abd2954821430e0ee9741a945ab60` |
| public.listings          | 7    | `f5aca5c5431c880d7e11af9b8b1aa5d3` |
| public.shops             | 0    | `d41d8cd98f00b204e9800998ecf8427e` |
| public.listing_favorites | 4    | `ed17abd4029535d4d3aba3d49d2d1cfc` |

Final B18 private product costs, expenses and Order cost snapshots each contain
0 rows. No such business records were created. This is bounded verification of
the listed relations and installed SQL, not an assertion that every unrelated
table in the database was byte-audited. No historical business mutations observed
within this scope. The only intended data write was migration-history registration.

## Deferred and exclusions

**NOT TESTED**: real owner/anonymous/cross-account API calls, real cloud
Plus/Pro/Trial/Grace/Suspended sessions, populated financial reconciliation,
refund/Protection/scheduler behavior, provider payment/settlement/payout, browser
runtime, multi-device cache/entitlement transitions and B26 Shop transactions.
Administrator BYPASSRLS metadata checks do not replace these tests.

The `seller_origin_id` query-index concern stays deferred pending real performance
evidence. No index was added, no EXPLAIN ANALYZE or aggregate runtime was executed,
and no performance SLA is claimed. No unexpected complexity or new security issue
was found in the installed definition and metadata verification.

Only this deployment report was added/updated in the project. Earlier qualification
and preflight reports describe their respective historical milestones and were not
rewritten. No source/UI/credentials/environment changes, Next.js deployment,
Production access, financial/mail actions or Git mutation. B20 and Recommendation
& Ranking have not started. Stop here; no runtime testing is authorized by this
deployment result.

**B19 STAGING MIGRATION DEPLOYED — READ-ONLY VERIFIED**
