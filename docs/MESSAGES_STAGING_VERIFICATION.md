# Messages Phase 1B hosted staging verification

Verified 2026-10-07. **STAGING ONLY; NOT deployed to production.**

## Target and migration application

`supabase projects list` confirmed `western-marketplace-staging` was the sole linked
project. `campus-marketplace` was unlinked and was not queried or changed. Staging
reports PostgreSQL 17.11.0.003. No production connection URL or application .env
credentials were used by the test harness.

Before push, migration list showed these local versions with empty remote entries:

| Version | Migration |
| --- | --- |
| 202609290001 | marketplace |
| 202610030001 | marketplace_usernames |
| 202610040001 | marketplace_taxonomy |
| 202610050001 | marketplace_publication_favorites |
| 202610070001 | messages_text |

`supabase db push --linked --dry-run` listed exactly these five migrations in order,
with no seeds/roles or unexpected files. The explicitly authorized linked staging
push applied all five successfully. The subsequent migration list showed matching
local/remote values for all five. No migration repairs, database reset, SQL corrections
or migration-file changes were made. The Messages file's original NOT APPLIED header
records its authoring checkpoint; this report supersedes that deployment status
for staging only. No clean-reset/reapply was performed: the complete chain was
applied successfully to previously unapplied staging, without deleting its history.

## Real SQL behavior and authorization method

[messages-text-staging.sql](../tests/messages-text-staging.sql) uses the CLI's linked
Management API query facility. It creates actual confirmed @uwo.ca rows in the hosted
auth.users table with usernames, exercising the real profile-creation trigger.
Admin-only listing/image metadata fixtures satisfy the real manifest/publication
workflow. Storage fixtures are SQL metadata only; no physical image files are uploaded.

Participant operations execute with `SET LOCAL ROLE authenticated` and test JWT
claims. The suite asserts current_user/auth.uid and queries the real RLS-protected
tables; no mock schemas, policy replacements or service-role reads are used to prove
participant access. These are database-role/claim tests, not GoTrue password-login or
HTTP API tests. Admin contexts are explicitly separate for fixture setup, deliberate
mutation attempts, account/listing removal and the conversation cascade test.
The entire single-session suite ends with ROLLBACK, leaving no users/listings/objects
or temporary test functions. It passed all 13 reported grouped assertions:

- Find/create returns canonical participants/source identity/DB snapshot/zero initial
  state; repeat returns the same ID; another listing gets a distinct conversation.
- Self-contact, unpublished and sold listing entry are rejected.
- First Hello persists at sequence 1 and updates canonical activity/sender read state.
  Edge whitespace is trimmed; internal newline retained; 2000 accepted; empty,
  spaces/newline/tab/null and 2001 characters rejected without consuming sequence.
- Alternating sends yield 1,2,3; a separate conversation starts at 1.
- Exact retry returns the same durable message; different content with the same
  nonce is rejected. Retrying after a new incoming message does not advance read state.
- Actual buyer/seller SELECT succeeds; outsider sees zero unrelated rows; Buyer B
  cannot see Buyer C's separately created conversation/history.
- Normal authenticated INSERT/UPDATE/DELETE on both tables is denied. A forged sender
  cannot bypass the RPC through a direct insert; RPC outputs use authenticated sender.
- Read acknowledgment advances only viewer, never backward; negative/null/out-of-range
  boundaries rejected. An explicitly temporary privileged sequence gap proves an
  in-range nonexistent boundary is rejected, then that artificial change rolls back.
- Mixed-sender unread counts exclude own messages, and own send produces no own unread.
  Read updates do not change last_message_at/activity ordering.
- Both participants continue reading/sending after sold; another buyer cannot create.
- Real listing deletion plus identity trigger leaves listing_id null, original UUID,
  snapshot and history intact; both existing participants still read/send.
- Deleting a buyer Auth account cascades its profile removal and SET NULL participant
  FK without erasing chat. Surviving seller still reads/sends. Deleting the seller
  while owned listings remain is blocked by the pre-existing listings seller FK;
  no account-deletion redesign was made.
- Administrative conversation deletion successfully cascades messages through the
  immutable-message trigger. Privileged direct message UPDATE/DELETE while the
  parent exists is rejected. Snapshot rewrite, live listing reassignment and buyer/
  seller reassignment are rejected; permitted live title/price edits do not change
  snapshots. Existing taxonomy immutability rejects live category edits.

## Real independent-session concurrency

[messages-text-staging-concurrency.cjs](../tests/messages-text-staging-concurrency.cjs)
checks CLI project name/link before mutation and pins the verified staging ref on
queries. It commits separate fixtures, opens two PostgreSQL sessions and observes
the first session's actual granted message-table transaction lock before launching
the second send. Backend PIDs must differ and the second request must wait. This is
not Promise.all over a serialized in-memory engine or sequential calls.

Final complete harness run:

| Case | First / second sequence | Rows afterward | Second database wait |
| --- | --- | --- | --- |
| Same client_message_id | 1 / 1, same message UUID | 1 | 10.720540 seconds |
| Different client_message_id | 2 / 3, distinct message UUIDs | 3 total | 10.823778 seconds |

Both runs confirmed unique sequence count and last_message_sequence matched the
durable row count. The first deliberate transaction holds its locks for 15 seconds
to make genuine overlap/waiting observable; this is test instrumentation, not an
application delay. No code/SQL changes to the Messages migration were needed.

## Harness findings and cleanup

The installed CLI requires `--linked` together with `--project-ref`; this was fixed
in the test wrapper before fixture creation, not in application code.

Initial concurrency cleanup failed because hosted Storage's `storage.protect_delete`
rejects raw metadata deletion. That cleanup transaction rolled back completely.
The real guard definition was inspected read-only; it supports the transaction-local
`storage.allow_delete_query=true` opt-in. Because these objects were SQL-only fixture
metadata, cleanup now uses that setting solely inside its scoped cleanup transaction.
No global configuration, Storage policy or physical file deletion bypass was added.
The leftover fixtures were then removed; the complete harness was rerun successfully
with automatic cleanup. Final checks report zero fixture users, conversations,
listings, messages and storage.objects rows. No migration history was removed.

## Checks and boundaries

- Hosted full migration application and post-push migration history: passed.
- Hosted authenticated-role SQL behavior suite: passed.
- Hosted independent-session concurrency and scoped cleanup: passed.
- `supabase db lint --linked`: results=[]; **No schema errors found**.
- Static migration source test, test ESLint, TypeScript and diff/link checks: passed.

No production mutations, /api/messages routes, frontend persistence, fixture removal
from the UI, IMAGE persistence, private chat bucket or Realtime changes. No Git commit
or push. This proves the tested staging database behaviors, not production readiness,
frontend/API integration, email delivery or Storage HTTP upload behavior.
