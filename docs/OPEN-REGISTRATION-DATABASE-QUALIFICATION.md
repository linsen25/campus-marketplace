# Open Registration Database Qualification

## Scope

The database authority is intentionally split by business boundary:

- `is_verified_user()` — confirmed login email for Profile, Resale, Messages,
  Notifications, Favorites, media and product-scoped contact.
- `is_uwo_email_verified()` — optional UWO identity projection only; it does
  not grant Shop approval or financial authority.
- `is_shop_approved()` — durable Shop application approval fact.
- `is_shop_operator()` — current Shop operation eligibility; this remains a
  separate rule until Paid Launch policy explicitly resolves approval versus
  membership entitlement precedence.
- `is_western_user()` — retained for Offer, Order, Payment, Refund, Transfer,
  Payout and other legacy financial boundaries. Do not replace it globally.

When changing a permission rule, inspect the RPC, trigger, table policy,
Storage policy, Realtime policy and any notification projector for that domain.
Do not infer final state from an old migration file; inspect the final Catalog
after applying the complete chain.

## Reproducible entry

The approved CI entry is `.github/workflows/database-qualification.yml`.
It starts a disposable Supabase Local Stack, runs the complete migration chain
with `supabase db reset --local`, executes
`tests/sql/notification-filtered-assertions.sql`, and runs the static regression
`tests/notification-filtered-permission.cjs`. The stack is stopped with
`--no-backup` in an `always()` cleanup step.

The same job then runs
`tests/sql/permissions-008-009-assertions.sql`, which creates disposable
confirmed/unconfirmed users and checks username confirmation, notification
filtering, message send/read, Shop Favorites and cross-account rejection under
the `authenticated` and `anon` roles. Fixtures are wrapped in a transaction
and rolled back.

The workflow uses no Staging/Production URL, service key, user data or mailbox.
It is not triggered from this workspace. The current Windows environment did
not run the database lane; PostgreSQL execution remains **NOT TESTED**. The
local Supabase CLI help probe was blocked by its telemetry temp-file permission
error, so the exact `db psql` flag is intentionally left to CI verification
and must not be treated as locally validated.

Pure PostgreSQL/Supabase-local checks cover migration application, function
definitions, ACL and SQL policies. Storage API uploads, Realtime delivery,
real Auth confirmation, real accounts and real email delivery require separate
integration/browser lanes and must not be reported as database PASS.

## Maintenance convention

New permission changes should prefer directly reviewable explicit function
definitions and complete signatures. Dynamic Catalog rewrites are allowed only
when they fail closed on missing, overloaded or drifted definitions and include
per-function assertions.
