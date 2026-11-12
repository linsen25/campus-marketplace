# UU B32 Resale V3 Release Tree

Date: 2026-11-09
Branch: `b30-staging-acceptance-20261024`
HEAD: `9c11796033b6ed9b2f3f3e6e917c28010f042bb4`
B32 project: `giqdwyiupslpfhstbtqf`

This manifest describes the dirty Release Candidate tree. It does not claim
that the worktree has been committed, pushed, merged, or deployed.

## A. Formal source and configuration to retain

- Resale/Order UI and navigation: the modified `components/home/**`,
  `components/listings/**`, `components/ui/skeleton.module.css`,
  `hooks/use-order-flow.ts`, and `pages/listings/[id].tsx` files shown by
  `git status --short`.
- Payment UI: `components/home/payment-unavailable-dialog.tsx` and
  `components/payments/**`.
- Domain and API implementation: modified `lib/listing-*`, `lib/listings-api.ts`,
  `lib/meeting-location.ts`, `lib/messages-realtime.ts`, `lib/offer-*`,
  `lib/offers-api.ts`, `lib/order-*`, `lib/page-slide.ts`,
  `lib/transaction-preferences.ts`, `lib/interac-email.ts`,
  `lib/western-buildings.ts`, `lib/server/**`, `lib/supabase/listing-mapper.ts`,
  `pages/api/orders/[[...segments]].ts`, `pages/api/interac/**`, and
  `pages/api/stripe/account-session.ts`.
- Types: `types/listing.ts`, `types/meeting-location.ts`, `types/offer.ts`, and
  `types/order.ts`.
- B32 isolation: `.env.b32.test.local.example`, `scripts/dev-b32.cjs`,
  `scripts/stop-b32.cjs`, `next.config.js`, `.gitignore`, `package.json`, and
  `package-lock.json`.
- CI: `.github/workflows/database-qualification.yml`. Its existing B31
  allowlist remains intentionally isolated; the RC offline suite is an
  additional static step, not a replacement for B31 qualification.
- Acceptance records: `docs/B32-RESALE-TRANSACTION-AUDIT.md`,
  `docs/B32-RESALE-V3-ACCEPTANCE.md`, `docs/B32-RESALE-V3-RC-REPORT.md`, and
  this manifest.

`docs/BUSINESS-V1-TASK-BREAKDOWN.md` predates this RC slice and must receive a
separate content review before staging; it must not be included merely because
it is modified.

## B. Stable automated tests to retain

- Offline RC entry point: `tests/b32-resale-v3-rc.cjs`.
- Full real-browser entry point: `tests/b32-browser-transaction-e2e.cjs`.
  It now requires `B32_E2E_CREATE_FIXTURES=1` and an isolated localhost origin,
  preventing accidental fixture creation during ordinary test runs.
- Real B32 receipt gate/idempotency: `tests/b32-interac-011-http-regression.cjs`.
- Real B32 outsider/anonymous privacy: `tests/b32-interac-privacy-diagnostics.cjs`.
- Build: `tests/b32-interac-build.cjs` exposed as `npm run build:b32`.
- Migration/security: `tests/interac-email-verification.cjs`,
  `tests/interac-payment-state.cjs`, `tests/interac-settings.cjs`,
  `tests/interac-completion-history-static.cjs`,
  `tests/resale-verified-transaction-access.cjs`, and
  `tests/resale-order-projection-guards.cjs`.
- Shared regressions: `tests/listing-contact-reuse.cjs`,
  `tests/meeting-location.cjs`, `tests/order-domain-api.cjs`,
  `tests/order-payment-ui.cjs`, and existing modified Order/Listing/Stripe
  static suites shown by Git status.
- Stripe readiness: `tests/b32-stripe-readiness-readonly.cjs` retrieves only
  the explicitly supplied Test account and platform Account. It performs no
  create, update, link, session, PaymentIntent, refund, transfer, or payout.

The real browser suite creates four fresh legal Listings only when explicitly
enabled. It must not run in a generic PR job or against a shared environment.

## C. Diagnostic or one-off continuation scripts

Keep locally until the RC commit is reviewed, but do not stage these as the
maintained E2E interface unless a reviewer decides otherwise:

- `tests/b32-browser-interac-accept-continue.cjs`
- `tests/b32-browser-navigation-diagnose.cjs`
- `tests/b32-browser-order-diagnose.cjs`
- `tests/b32-browser-order-refresh-verify.cjs`
- `tests/b32-browser-session-diagnose.cjs`
- `tests/b32-browser-transaction-continue.cjs`
- `tests/b32-fulfillment-http-check.cjs`
- `tests/b32-interac-history-diagnostic.cjs`
- `tests/b32-interac-new-fixtures.cjs`
- `tests/interac-completion-history-db.cjs` (depends on a local ignored PGlite
  runtime under test artifacts and is not CI-portable as currently written)

`tests/stripe-setup-live.cjs` is a legacy provider qualification script with
mutation/maintenance behavior. It is not the read-only readiness command and
must not be run during RC verification.

## D. Local-only material excluded from release

- `.env.local`, `.env.staging.local`, `.env.b32.test.local`
- `tests/artifacts/**`, including browser sessions and credentials
- `.next/**`, `.next-b32*/**`, `coverage/**`, `*.tsbuildinfo`
- Browser screenshots, network traces, generated logs, local PGlite runtime,
  and other evidence stored below the ignored artifact tree

These files were not deleted. `.gitignore` now explicitly excludes
`.env.b32.test.local` and all `.next-b32*` build directories.

## Migration 004-011 fingerprint

| Logical migration | Remote version | Local SHA-256 |
| --- | --- | --- |
| 004 | `20261108043416` | `380f56b5483b58bb2e8a01fc8047b764747883491fd2f9d3c7765bfd9c4a8abf` |
| 005 | `20261108043423` | `2050e29c2be87aa963678286ff9fd90d12e8f762b221b57a5f475b401b8ab5e7` |
| 006 | `20261108043732` | `7f2185f9cf45456b5c0842fe6d7077980aeb97c7dd9d309ed46eae1830c721a3` |
| 007 | `20261108095042` | `014e3f2b1d59143846cc78e3342d6b82d6b6b1ca9b805805e18d52326a2f07dc` |
| 008 | `20261108095049` | `865c58f5dac1b522153d2a23d03691d74dbd06c9582ddc09531b849b4f3c0ec8` |
| 009 | `20261108185655` | `d3784572549938f7c07f4e55d75d6fd63d725dd625b867219430336cada7cc76` |
| 010 | `20261109035046` | `34b0ef0f6a2a701c323faaaa86d8a8c5936b22e8e6a5103cb8f64db023fa8713` |
| 011 | `20261109183845` | `420ddae07c08e139b9394fbe17a6f14582349b4a834c7c00b2f37d5f0b6989cb` |

The remote versions above are the independently verified B32 history already
recorded in the acceptance report. This release-tree task did not replay,
repair, or modify migrations 004-011.

## Stripe next-stage readiness

Read-only Test API evidence for Connected Account
`acct_1UZHAEA2nyuq0CM5`:

- country `CA`, business type `individual`;
- `details_submitted=true`, `charges_enabled=true`, `payouts_enabled=false`;
- `individual.verification.proof_of_liveness` is both currently due and past
  due; `disabled_reason=requirements.past_due`;
- requested `transfers` capability is active;
- Payment, refund, transfer, and transfer-approval feature switches remain
  disabled in B32.

The local binding review also found one correct platform binding and one stale
self-platform binding for the same Connected Account. Do not delete or choose
between them manually. The next Stripe phase must first make configured-platform
selection deterministic and reconcile the stale row through an audited,
idempotent ownership check.

Minimum complete Stripe phase:

1. Seller manually completes Stripe-hosted proof of liveness; reconcile from
   the Account API and signed `account.updated`, never from UI progress alone.
2. Resolve the duplicate binding deterministically without recreating the
   Connected Account; re-run cross-user, duplicate-binding, and lease tests.
3. Require authoritative Seller readiness immediately before PaymentIntent
   creation and keep all current disabled gates fail-closed.
4. In Test mode only, create one idempotent CAD PaymentIntent for a legal
   accepted `uu_pay` Order and verify the official Payment Element flow.
5. Verify signed, duplicate, delayed, and out-of-order webhook reconciliation;
   no client response may set Paid.
6. Verify B31 buyer receipt and 48-hour release protection before any transfer
   eligibility. Refund, transfer, and payout creation remain disabled until
   their own approval and tests.

## Commit readiness

The tree is technically verifiable but is **not yet ready for one undifferentiated
commit**. It is ready for a reviewed staging pass after:

1. stage A and B only, explicitly excluding C and D;
2. review `docs/BUSINESS-V1-TASK-BREAKDOWN.md` separately;
3. split Resale V3, Stripe UI/setup groundwork, migrations, tests, and docs into
   reviewable commit slices without changing file contents;
4. review the migration filenames/remote mapping in this manifest;
5. preserve the verification results below when staging the final slices.

## Verification results

| Check | Result | Evidence |
| --- | --- | --- |
| TypeScript | PASS | `tsc --noEmit` exited 0 |
| ESLint | PASS | full `next lint`; no warnings or errors |
| B32 production build | PASS | optimized Next.js build exited 0 using the isolated B32 build script and disabled payment/refund/transfer switches |
| Resale V3 offline RC | PASS | 11 suites via `npm run test:b32:resale-v3:offline` |
| Workflow syntax | PASS | `database-qualification.yml` parsed with `js-yaml` |
| Migration 004-011 manifest | PASS | all eight local files exist; hashes are recorded above against the independently verified remote version map |
| `git diff --check` | PASS | exit 0; Windows line-ending notices only |
| Sensitive literal scan | PASS | no real credential-shaped literal in tracked/unignored files; matches in two Stripe tests are explicitly named Synthetic fixtures |
| Ignore coverage | PASS | local/staging/B32 env, browser credentials, test artifacts, and `.next-b32*` are ignored |
| Stripe readiness read | PASS/BLOCKED | read-only Test API retrieval passed; payout readiness is blocked by proof of liveness |

Build warnings are non-blocking but retained as P2 cleanup: one existing
autoprefixer `start` compatibility warning, outdated Browserslist data, and the
ConnectJS SSR side-effect notice. The latter can be removed later by evaluating
the package's pure loader import; it did not fail static generation.

The current expanded status has 148 paths: 84 tracked modifications, 64
untracked files, and no staged changes. The exact selective staging manifest is
`docs/B32-RESALE-V3-RC-FILES.txt`: 134 candidate paths in five non-overlapping
review slices and 14 explicitly excluded diagnostic/separate-review paths.

## Stripe binding and protected-payment preparation

Read-only provider evidence confirms that the Connected Account metadata
`uu_binding` identifies the correct B32 platform binding. The duplicate was
created historically under a self-platform configuration; uniqueness is scoped
by `(user, kind, platform, mode)`, so the different platform value admitted a
second row. Current runtime setup resolves the platform from the Test key and
verifies it with `accounts.retrieve(null)`, so a browser cannot choose the
Connected Account or platform.

Migration `20261109190000_stripe_binding_reconciliation.sql` was independently
deployed to B32 as remote version `20261109213247`. It adds a service-only,
provider-metadata-anchored reconciliation. It retains the stale row and setup
operations, marks it superseded, clears only its lease, records an immutable
audit row, and excludes superseded rows from setup, capabilities, webhook,
PaymentIntent, Transfer, and payout-notification selection. Cross-user owner
conflicts fail closed. Local SHA-256:
`beefec034a515f64c5a8ee2baab12498469ea88da3594bffe98ae67dd7fdba30`.

The PaymentIntent adapter now matches the existing separate-charges-and-
transfers design: the charge remains on the platform, the frozen seller account
is bound through immutable metadata, and `on_behalf_of` must be absent. Seller
recipient readiness (`details_submitted`, `payouts_enabled`, active `transfers`,
matching country) is rechecked even when reusing an existing Intent. Signed
webhook reconciliation still retrieves Stripe state and B31 still prevents a
Transfer before participant receipt plus the 48-hour protection period.

The live service-role acceptance verified the Stripe Test platform, Connected
Account, confirmed Auth Seller, and `uu_binding` metadata before invoking the
RPC. The first result superseded exactly one stale self-platform Binding; the
same request then returned zero. The canonical row stayed active and the stale
platform lookup returned null. The audit insert is transactionally coupled to
the successful supersession. No historical row was deleted.

Migration 012 is deployed, but the remaining Protected Payment code is still
Stripe groundwork rather than accepted Resale V3 payment functionality. Keep
all money-movement gates disabled until official proof of liveness and a real
Test PaymentIntent/signed-webhook E2E pass.

## Selective staging dry run

`git add -n` completed for the first version of all five batches with no index
change: 58 core source paths, 13 database paths, 31 Stripe groundwork paths,
19 stable test paths, and 12 config/document paths. The subsequently added
exact manifest is the thirteenth config/document path. `git diff --cached`
remains empty. No Commit, Push, Merge, or deployment was performed.

## 2026-11-11 RC freeze reconciliation

This section supersedes the path counts above, which predate the completed
Stripe Test payment, B31, operational-case, receipt-authority, and Scheduler
work. It remains a review manifest, not a staging operation.

- Working tree: branch `b30-staging-acceptance-20261024`, base
  `9c11796033b6ed9b2f3f3e6e917c28010f042bb4`; 92 tracked modifications and
  70 untracked files (Git porcelain coalesces the six untracked
  `components/payments/` files, so it reports 63 untracked paths).
- Candidate files: 162 in total: 89 production/configuration files, 15
  immutable migration files, 36 maintained tests, and 6 RC/acceptance
  documents. Sixteen files remain explicitly separate-review/diagnostic:
  `docs/BUSINESS-V1-TASK-BREAKDOWN.md`, `tests/stripe-setup-live.cjs`, the
  six `tests/b32-browser-*-diagnose|continue` scripts, the three Interac/
  fulfillment diagnostics, the B32 binding reconcile helper, both local
  PGlite diagnostic tests, and the sidebar/onboarding browser evidence
  scripts. They must not enter the RC without an individual promotion review.
- `tests/artifacts/b32/stripe-real-payment/` contains 20 ignored local files:
  nine resource- and credential-coupled scripts, three SQL deployment or
  verification snippets, three JSON results, three PNG screenshots, and two
  logs. None is a release candidate file. A future reusable test must be
  promoted into `tests/` only after removing fixed resource IDs, localhost
  assumptions, credentials, and mutation behavior.

### 013 / 014 deployed fingerprint

| Logical migration | Local file | Remote version | Local SHA-256 |
| --- | --- | --- | --- |
| 013 | `20261111001147_operational_case_null_provider_start.sql` | `20261111001406` | `1a9f1d9f09d77f82d4d800ec9cd827a3253ccd086d2075624c8fdce21ac2efda` |
| 014 | `20261111002000_b32_stripe_payment_receipt_authority.sql` | `20261111080417` | `89c94a48e94e93bce5f259a4c009f6f50b9e0c633077a0d5972508314b434b2c` |

The B32 remote migration history lists both versions and no duplicate local
filename exists. Remote function inspection confirms that 013 uses the
NULL-safe `coalesce(..., false)` operational-case predicate, and that 014
keeps `marketplace_private.protect_order()` as `SECURITY DEFINER` with its
empty fixed `search_path` and postgres-only ACL while accepting only the B32
service-role project ref. Supabase migration history records version/name, not
source-file hashes; the hashes above are therefore local release fingerprints,
while the function/metadata inspection is the remote equivalence evidence. The
B32 ref in 014 is deliberately environment-specific. Another environment must
use a new, separately reviewed migration against that environment's baseline;
014 must never be edited or replayed.

### Scheduler and deployment guard

The existing worker remains the only executor. `GET /api/stripe/worker`
accepts only a distinct, at-least-32-character `CRON_SECRET`; `POST` retains
the separate `STRIPE_WORKER_SECRET`. The B32 example now declares both and
`scripts/dev-b32.cjs` clears inherited `CRON_SECRET` alongside the other B32
settings, preventing a local `.env.local` value from selecting an unintended
schedule credential. This does not enable recovery, payments, refunds,
transfers, transfer approval, or payouts.

Current targeted verification: TypeScript, targeted ESLint, B32 production
build, receipt-authority static test, Stripe setup/worker runtime tests,
operational-recovery static test, payment and transfer static tests, isolated
native PostgreSQL payment and transfer tests, and `git diff --check` all pass.
The B32 build used Test-mode environment validation and forced payment,
refund, and transfer gates to `false`; its remaining Browserslist/autoprefixer
messages are non-blocking warnings.
