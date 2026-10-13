# Reusable staging demo data

> **CURRENT STAGING V1 / historical implementation reference.**
> The approved [Marketplace V2 product contract](MARKETPLACE_V2_PRODUCT_CONTRACT.md)
> supersedes conflicting future product rules in this document. Current V1 code,
> applied-state records and historical transaction facts remain unchanged.
> V2 implementation has NOT started. Check the V2 contract before further V1
> feature expansion; this notice authorizes no implementation or data operation.

This workflow populates the **real** hosted western-marketplace-staging database
(`pcaqxezdfxofysghssyo`) for visual inspection. It adds no React mock arrays,
schema changes, Orders or Payments. Production configuration/data is untouched.

## Commands

### Preserve demo users/messages and reset transactions only

For the current Phase A–F schema, use this separate, narrowly scoped tool:

```powershell
node scripts/staging-demo-reset-transactions.cjs audit
node scripts/staging-demo-reset-transactions.cjs reset
```

The full `demo:cleanup:staging` command below removes identities, listings and
messages; it is **not** a transaction-only reset. The reset tool keeps the four
canonical accounts, six listings, Favorites, conversations, ordinary TEXT/IMAGE
messages and Storage objects. It deletes only canonical Request/Order/event/command
records and their account capability rows, restores all six listings to AVAILABLE,
and clears reservation ownership. Unset capabilities are represented by absent rows.
No new transaction or financial test state is created.

The reset fails closed on a different staging URL/environment, mismatched server
demo markers, unrelated participants, or a changed deployed FK/column/trigger graph.
Deletion occurs in one locked transaction, with FK checks kept active and only the
audited deletion/inventory guards temporarily disabled and restored before commit.
Retained/unrelated rows are checked by full-row hashes within the transaction;
listing content is checked separately, excluding status/reservation/update time.
There is no production access, migration, broad CASCADE or source behavior change.

Exact before/after record IDs and schema evidence are stored only in ignored
`tests/artifacts/staging-demo/transaction-reset-result.json`. Local credentials and
the seed manifest remain ignored and intact. Historical test journals referring to
deleted transactions are obsolete evidence; do not use them to recreate fixtures
or run automatic Accept/payment tests during the clean manual-test baseline.

On 2026-10-11 the authorized reset removed 8 Requests, 3 expired Orders, 21 events,
13 commands and 1 capability row. All became zero; all 6 listings became AVAILABLE.
The formerly protected Monitor Request was included in this explicit authorization.
All 19 ordinary messages and the durable image metadata were preserved.

Read-only checks in independent Buyer A / Seller B staging browser contexts passed
at the real `localhost:3000` app: Monitor history and Request events empty, Purchases
and Sales empty, both Settings capabilities Unset, and no old View Order. Seller B
can enter Send Order Request and sees the expected payout-setup gate; Buyer A has
no seller action. Deleted Order detail endpoints return the existing 403
anti-enumeration response and no Order data. No Request, Accept, financial simulator,
or capability write occurred. Messaging read acknowledgements were intercepted
during this check to preserve the original conversation watermarks.

From the repository root, with Node 24, installed npm dependencies and the existing
authenticated Supabase CLI available:

```powershell
npm run demo:seed:staging
npm run demo:cleanup:staging
```

The fixed project name/ref and anon/service-role credential claims are checked
before mutation. There is no target override. An inherited `APP_ENV` other than
staging is rejected; the script does not load production `.env.local`. Commands
explicitly name the staging ref and do not change the repository's linked project.
Only authorized staging admin API calls create/delete disposable identities;
email_confirm=true avoids signup/resend/email delivery. No SMTP settings change.

The CLI's existing secure authentication supplies staging keys in memory. Seed
also prepares the ignored `.env.staging.local` for the existing IMAGE server flow;
its service-role value is never printed, public-prefixed or committed. Access/refresh
tokens are never saved. The temporary API process runs
the existing application against staging on an ephemeral loopback port; it exits
after the seed, so no staging API server has to be running beforehand.

## Accounts and credentials

| Role     | Username      | Useful view                                        |
| -------- | ------------- | -------------------------------------------------- |
| Seller A | Demo_seller_a | Selling, Nike conversations with both Buyers       |
| Seller B | Demo_seller_b | Selling, monitor and sold textbook history         |
| Buyer A  | Demo_buyer_a  | Marketplace, Favorites, three Buying conversations |
| Buyer B  | Demo_buyer_b  | Different Favorites, own Nike negotiation          |

Open `tests/artifacts/staging-demo/credentials.json` **locally** to retrieve each
synthetic email/password. Do not paste or screenshot its contents into chat,
documentation or Git. The script requires that path to be Git-ignored before
creating it; files use private mode where supported and inherit local Windows
filesystem permissions. Keep the workspace private to your user account.
No real person's identity, inbox, photo or production record is used.

The deterministic system marker is `campus-marketplace-staging-demo-v1`, stored
in server-controlled Auth app_metadata, with a separate role marker. Synthetic
email addresses are UWO-shaped solely to exercise the existing verified-domain
rules; no messages are sent to those addresses. Do not test password recovery or
email sending with these fixtures.

## Dataset

| Seller | Listing           |  CAD | Initial state |
| ------ | ----------------- | ---: | ------------- |
| A      | MacBook Air M2    | $750 | AVAILABLE     |
| A      | Nike Dunk Low     |  $80 | AVAILABLE     |
| A      | Desk Lamp         |  $25 | AVAILABLE     |
| B      | PS5 Controller    |  $55 | AVAILABLE     |
| B      | Calculus Textbook |  $40 | SOLD          |
| B      | 24-inch Monitor   | $120 | AVAILABLE     |

Titles carry `[DEMO]`; descriptions contain the dataset/key marker and explicitly
identify a synthetic demonstration. Categories/subcategories use the real taxonomy.
Generated decodable PNG product illustrations go through the real listing-image
reservation/upload/finalize flow. MacBook has two images, other listings one.
These are illustrations, not product photography or genuine offers.

Buyer A initially favorites MacBook, Nike and Monitor; Buyer B favorites Nike and
Lamp. Real Favorites APIs enforce the same ownership/publication rules as the UI.

Four real conversations exercise:

- Buyer A ↔ Seller A, Nike: size discussion, durable IMAGE close-up and a newest
  incoming Seller reply; unread for Buyer A.
- Buyer B ↔ Seller A, the **same Nike listing**: availability and $70/$80 discussion;
  a separate identity/history, unread for Buyer B.
- Buyer A ↔ Seller B, Monitor: cable discussion; incoming unread for Seller B.
- Buyer A ↔ Seller B, Textbook: both participants mark it read, then Seller B marks
  the listing sold. Its historical conversation remains usable.

Messages use the actual authenticated conversation/TEXT/read APIs. The IMAGE uses
prepare → upload → verified receipt → finalize, not direct database message inserts.
Images are generated in memory, with no personal/photo fixtures stored in Git.
Activity ordering uses natural sequential database timestamps; durable timestamps
are not rewritten. No Order Request, RESERVED or PAID state is seeded.

## Repeatability and recovery

Running seed twice retains one dataset and does not reset read state. User roles,
listing descriptions and original listing/participant identities allow recovery
after an interrupted seed. Stable client message UUIDs make TEXT/IMAGE retries
idempotent. `state.json` tracks progress locally; it contains no sessions.

A complete dataset is verified before being reused. If you deliberately change its
initial inventory, cleanup/reseed restores a baseline rather than overwriting your
visual-exploration state. If local credentials were lost, seed can reset passwords
only for the server-marked disposable identities; it cannot recover other accounts.

Concurrent local seed/cleanup commands are blocked by operation.lock. If a process
was forcibly killed, verify the PID in that file is no longer running before
removing **only** the stale `tests/artifacts/staging-demo/operation.lock` and retrying.
Ordinary failures release the lock. API/CLI errors are sanitized and never print
credential values; partial fixtures remain recoverable rather than being duplicated.

## Local visual inspection

Keep production `.env.local` unchanged. The existing ignored `.env.staging.local`
must contain the staging public URL/key and staging service-role key for IMAGE.
The staging launcher checks their project binding; missing/mismatched configuration
must be corrected locally without pasting secrets into chat.

```powershell
npm run demo:dev:staging
```

This project-guarded viewer uses a separate ignored build cache and port 3112,
so it can coexist with a production-configured local frontend. Stop it with Ctrl+C
before seed/cleanup; the operation lock protects concurrent demo operations.
The existing `npm run dev:staging -- -p 3112` is also available when other Next
servers are stopped, but it shares the normal build cache.

Use **http://localhost:3112** consistently for these accounts. Sign in normally
with Buyer A from the local credentials file, then open:

- Marketplace: `/listings` (five available demo items; other staging items may also exist).
- Favorites: `/home?section=favorites`.
- Buying Messages: `/home?section=messages&destination=buying`.
- Seller listings: `/home?section=my-listings` (includes the SOLD textbook for Seller B).
- Selling Messages: `/home?section=messages&destination=selling`.

For simultaneous Buyer/Seller views, use a normal browser window for Buyer A and
an Incognito/private window for Seller A, or separate browser profiles/browsers.
Normal tabs in one profile share cookies; multiple Incognito windows also commonly
share their private session. Ports are not separate cookie identities. Do not mix
localhost and 127.0.0.1 and expect the same login session.

Opening a conversation advances its rendered read watermark through normal UI
behavior; unread indicators will change during exploration. Seed again does not
undo those reads. Cleanup/reseed gives a fresh initial unread layout.

## Cleanup boundaries

Stop demo browsing/uploads before cleanup. The command discovers ownership from
server-controlled Auth markers, not arbitrary UUIDs in a local credential file.
It removes only those identities and their listings, Favorites, conversations,
TEXT/IMAGE children, submissions/receipts and Storage objects. New activity made
using disposable demo accounts is also disposable.

If an unrelated user has contacted a demo account or favorited a demo listing,
cleanup **refuses** to cascade-delete that unrelated user's data. Review that case
separately; do not broaden the cleanup predicate or delete unrelated staging users.

Before deleting parent records, exact owned Storage paths are journaled in marked
Auth app_metadata for interrupted-cleanup recovery. Storage deletion uses the
Storage API, never raw Storage DML. Only the exact demo cleanup-queue paths whose
objects and references are gone are removed administratively; the normal worklist
and reconciliation window for unrelated data remain untouched. The journal holder
is deleted last. Local credentials/state are removed after verified cleanup.
Existing buckets, migrations, policies and unrelated staging fixtures remain.

## Verification (2026-10-09)

Hosted seed, repeat seed, scoped cleanup and reseed passed against the fixed staging
project. Cleanup verified zero owned fixture residue before reseeding. The final
dataset remains available: four identities, six listings (five AVAILABLE, one SOLD),
seven listing images, five Favorites, four conversations and one durable IMAGE.
Completed seed reuse preserves identities and counts without resetting read state.
Interrupted listing-image uploads were resumed without duplicate listings.

Independent authenticated headless browser contexts passed Buyer A's Marketplace,
Favorites and mobile Buying list (390px), plus Seller A's Selling history (1280px)
and a decoded durable IMAGE. Requests were restricted to the local staging viewer
and the staging Supabase origin; no mocked transport, production requests,
screenshots or session dumps were used. Temporary browser-check code was removed.

Offline guard checks (`node tests/staging-demo.cjs`), focused ESLint, documentation
links and `git diff --check` passed. No application functionality, migration,
dependency, production environment or Orders/Payments implementation changed.
