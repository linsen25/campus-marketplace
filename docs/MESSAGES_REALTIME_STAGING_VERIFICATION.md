# Messages Phase 3B hosted staging verification

Verified 2026-10-08 against **western-marketplace-staging**,
`pcaqxezdfxofysghssyo`. **STAGING ONLY. PRODUCTION NOT MODIFIED.**
Backend: **DEPLOYED TO STAGING / HOSTED REALTIME AUTH/DELIVERY VERIFIED**.
Frontend Realtime: **NOT INTEGRATED**. Production Realtime: **NOT DEPLOYED**.
No commit or push. [Project status](PROJECT_STATUS.md) and
[Phase 3A contract](MESSAGES_REALTIME_DESIGN.md) describe the rollout boundaries.

## Migration and hosted compatibility

The linked project identity was checked before every hosted operation. History
contained the six Phase 1/2 versions before application. Explicit staging
`db push --dry-run --skip-vault` proposed only
[202610080001_messages_realtime.sql](../supabase/migrations/202610080001_messages_realtime.sql),
with no seeds or roles. Application succeeded without SQL edits, repair or retry
of a failed migration. History afterward contains all seven versions:
202609290001, 202610030001, 202610040001, 202610050001, 202610070001,
202610070002 and 202610080001.

SHA-256 of the unchanged Realtime SQL:
`5d16a4638eb2f2ac9f697e994f8a9ed9f91d9dd79034939426e8b8f55380499a`.

Hosted preflight confirmed `realtime.messages` already had RLS and authenticated
SELECT, platform `realtime.send`/`realtime.topic` existed, and application functions
could be created in `marketplace_private`. No application function/table was
created in `realtime`; RLS was not enabled again on the managed table. Clients used
`config: { private: true }`. Installed supabase-js/realtime-js/auth-js are 2.117.2;
SSR is 0.12.7. The hosted restrictions match the official
[Realtime authorization guidance](https://supabase.com/docs/guides/realtime/authorization).

Post-test catalog comparisons verified 39 original application functions,
65 constraints, 18 original triggers, 26 application/Storage policies, original
grants and bucket configuration unchanged. The two new postgres-owned SECURITY
DEFINER helpers have empty search_path, revoked PUBLIC/anon/authenticated/service-role
execution and exact authored bodies. The two new triggers are enabled; five
Realtime policies implement own-topic SELECT plus restrictive namespace read/write
fences. Fault-injection bodies were restored and matched the authored source.

No application table was added to any publication and no Postgres Changes stream
was enabled. Original managed Realtime function definitions remain unchanged.
On first successful WebSocket initialization, Supabase itself created managed
`realtime.authorize`, owned by `supabase_realtime_admin`, and five daily message
partitions (October 7–11) in its built-in Broadcast publication. These are platform
bootstrap objects, not application SQL or application publication changes.

## Real authenticated delivery and authorization

The reusable opt-in [hosted test](../tests/messages-realtime-staging.cjs) used
disposable confirmed Western Seller A, Buyer B and Outsider C, independent normal
Auth API cookie sessions, user JWTs and separate actual WebSocket connections.
An isolated staging-configured local app ran on port 3107; the normal app and its
environment file were not changed. Server credentials, JWTs and cookies stayed in
memory. No final frontend subscription/session bridge was implemented.

The completed run `4fb0cafe` passed all 19 result groups. Each participant held one
private channel on `marketplace:messages:<Auth UUID>` and joined its own topic.
Nine joins were rejected with no leaked events: cross-user in both directions,
Outsider to each participant, guessed UUID, suffixed/traversal-style malformed
topics, anonymous credentials and invalid-signature JWT.

Normal listing and Messages HTTP APIs established the conversation. Buyer TEXT,
Seller TEXT and complete IMAGE prepare/upload/receipt/finalize each persisted and
delivered history/list invalidations to both participants, with zero Outsider
events. IMAGE bytes were real generated JPEG data; ordinary API-authorized signed
bytes were fetched and decoded. IMAGE persistence was not inserted directly.

Application payloads contain only `conversationId`, `role` (buying/selling) and
`scope` (history/list). Hosted `realtime.send` additionally supplies an `id` UUID.
The test checked all four fields and excluded content, emails, user names, image
paths, signed URLs, tokens and privileged capabilities. Provider `id` is transport
metadata, not canonical message identity. Reader watermark updates emitted only
reader list invalidation, without adding a read-receipt feature.

An own-topic private client publish returned `error`; namespace INSERT/UPDATE/DELETE
policies deny client authority. A public channel with the same topic string could
join and publish under current global settings, but its messages never reached
private recipients. Private channel mode remains mandatory.

## Cold start, failure isolation and lifecycle

Before any successful test WebSocket, run `21d6ad49` verified **zero managed message
partitions** before and after normal TEXT and complete IMAGE sends. Both committed
with contiguous sequences, canonical history and readable signed image bytes.
Missing-partition Broadcast warnings did not abort persistence. The complete later
run repeated no-client persistence with five already initialized partitions; this
warm repeat is separate evidence, not a second zero-partition test. This observed
behavior matches the documented
[Broadcast partition warning](https://supabase.com/docs/guides/troubleshooting/realtime-warn-sending-broadcast-message).

The first own-topic join attempt failed without sufficient captured diagnostics
to prove its cause. An independent diagnostic with SDK default transport and
explicit setAuth succeeded; repeated joins then passed without SQL changes. We
do not claim a proven root cause for that initial join failure.

Controlled staging failure injection added an exception immediately before
realtime.send inside each helper's existing protected block, scoped to the exact
disposable conversation. Normal TEXT and full IMAGE persisted while delivering
zero signals. Original helper definitions were restored in finally and catalog
comparison verified restoration. No managed function or global service setting
was changed. Ordinary notification exceptions are best-effort; this test does
not prove immunity to every database-wide failure, cancellation or resource limit.

Rapid TEXT/TEXT/IMAGE/TEXT preserved canonical contiguous message sequences and
produced eight signals per participant, zero for Outsider. Signal counts/order are
observations, not correctness requirements; future clients must coalesce/refetch.
Sold and then deleted listings still allowed historical TEXT/IMAGE persistence,
participant delivery and signed-image access through the existing APIs.

Real Auth token refresh followed by realtime.setAuth retained authorized delivery.
Normal API logout plus explicit channel removal left zero owned channels and
unauthenticated API access. Invalid JWTs could not join. A correctly signed user
JWT was **not held until natural expiry**; that specific expiry case is unverified.
Logout does not promise immediate global invalidation of copied access JWTs.

Disposable Buyer deletion nullified the live participant reference. Its already
connected cached channel received no subsequent Seller events because publishers
derive current recipients; new joins with its old JWT were rejected. Surviving
Seller retained send/read/signing and delivery. This verifies publisher-side
revocation despite cached join permissions, not instantaneous removal of every
socket or bearer token. The existing Seller-owned-listing account-deletion
constraint is unchanged. Future frontend lifecycle/generation gates still need
implementation and browser verification.

## Settings, logs, cleanup and local checks

Read-only staging Management API settings showed Realtime not suspended,
admin_suspended_at null, presence_enabled false and private_only null. Limits:
200 concurrent users, 100 events/second, 100 channels/client, 100 joins/second.
Successful private joins and the public same-name test establish the observed
channel behavior; null private_only is not interpreted as an explicit enable flag.
No Dashboard/global settings were changed. Production rollout must recheck its
own settings and maintain private:true and receive-only namespace policies.

Bounded final one-hour aggregate log inspection found:

| Source | Events | Broadcast warnings | Partition mentions | Optional-trigger skip logs | Authorization-related mentions |
| --- | ---: | ---: | ---: | ---: | ---: |
| postgres_logs | 50 | 10 | 11 | 8 | 3 |
| realtime_logs | 82 | 0 | 2 | 0 | 0 |

Counts overlap and are not a claim that all messages were errors or that every
authorization mention was unexpected. Cold missing-partition warnings and scoped
fault-injection skip logs were observed alongside successful canonical sends.
Intentional rejected joins were exercised; the initial join failure is disclosed
above. No production logs were accessed, raw secret-bearing logs were printed or
global logging settings changed. Linked staging DB lint returned no schema errors.

Each run cleaned its fixtures. An early listing-status assertion expected 200
instead of the API's actual 201; its orphan listing and users were explicitly
recovered using only that run's identifiers, and the test expectation corrected.
A later payload assertion was updated for the platform's added UUID. These were
harness corrections, not application or migration fixes.

Final scoped residue checks returned zero Auth users, profiles, listings,
conversations/messages, IMAGE submissions, cleanup queue entries and chat objects.
Conversation cascade removed message_images/receipts; Storage deletion was verified
through object lookup, and scoped cleanup acknowledgements removed queue residue.
Diagnostic Auth users were also removed. The private chat-images bucket and Phase
1/2 infrastructure remain. Platform-retained transient Broadcast records/partitions
are not canonical test fixtures and were not destructively purged.

The isolated app stopped. Generated images were memory-only; no credential,
session or JWT files were written. Temporary sanitized results, SQL probes,
catalog snapshots and runtime folders under ignored tests/artifacts/messages-phase3b
were removed after this report was recorded. Only reusable source/static tests and
documentation remain alongside the migration.

Final local checks passed: TypeScript, focused ESLint, TEXT and IMAGE API/environment
guard tests, image/presentation/conversation tests, all Phase 1/2/3 migration static
tests, documentation links and git diff --check. Runtime, dependencies and Phase
1/2 migrations match checkpoint 74d832d. Global GlideSelect.jsx lint parser debt
remains pre-existing and unchanged. A production build was not required in this
backend-only phase; no deployment occurred.

Remaining limits: natural valid-signature JWT expiry, final browser Realtime
integration/coalescing/reconnect/session teardown, long-duration stress and
production Realtime are not verified here. **PHASE 1 TEXT PRESERVED. PHASE 2 IMAGE
PRESERVED. REALTIME BACKEND VERIFIED ON STAGING. FRONTEND REALTIME NOT INTEGRATED.**
