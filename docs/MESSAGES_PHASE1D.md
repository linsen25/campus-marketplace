# Messages Phase 1D — full staging acceptance

**PASS, 2026-10-07. STAGING ONLY. Production was not modified.**
No Realtime, durable IMAGE backend, database migration changes, commit or push.

## Environment and authentication

The harness confirmed that the sole CLI-linked project was
`western-marketplace-staging`, ref `pcaqxezdfxofysghssyo`, before every fixture run.
The ignored `.env.staging.local` was checked against that exact HTTPS project URL.
The local Next app at `http://localhost:3100` was started with
`npm run dev:staging -- -p 3100`. The launcher supplies the two public Supabase env
values to the child process before normal Next env loading; `.env.local` remains
unchanged. Messages also rejects non-staging targets before creating a client.
An anonymous request to the running guarded API returned 401, confirming the
runtime gate was open for staging rather than returning the non-staging 503.
The query observer independently pinned every recorded upstream URL to staging.
No credentials/cookies/keys were printed or saved in result artifacts.

Seller A, Buyer B and Outsider C were disposable confirmed Western Auth identities
with real profiles/password identities, initialized administratively through a
pinned staging Management API transaction. Browser contexts independently logged
in through the existing application's password/session API. Re-login was exercised
through the actual UI. Validation, RLS and RPCs were not weakened/replaced. Final
Seller display identity used the maximum valid **20-character** username. Email
signup/delivery is not an acceptance claim: confirmation was fixture setup.

## Acceptance scenarios and results

`tests/messages-e2e-staging.cjs` performs these real workflows. Successful data
requests use the running API and hosted database, not demo/local message state.
Only the deliberate failure cases intercept browser transport.

| Scenario | Result and evidence |
| --- | --- |
| Seller creates/publishes | **PASS.** Seller created five available listings through Create Listing UI, including category, subcategory, condition, place, description and a real JPEG. Actual upload/finalize responses supplied canonical IDs, images and publication times. Listing-created UI was captured. |
| Marketplace → Messages | **PASS.** Buyer opened each actual listing page and used Contact Seller. Home opened the correct UUID/Buying destination; DTO listing ID/title, Seller identity and selected history matched. |
| Duplicate identities | **PASS.** Repeat Contact Seller reopened the same conversation and Buyer retained exactly five. Second listing produced a different UUID. Outsider contacting the fifth listing produced its own distinct conversation with the same Seller. |
| Two independent users | **PASS.** Buyer UI sent “Hello seller”; Seller's already-open page did not receive realtime delivery. After reload Seller saw the message and unread state, opened/read it and replied “Hi buyer”. Buyer refresh retrieved the reply. Canonical history had sequences 1/2, correct senders and times; outgoing/incoming bubble colors were exactly #007AFF/#775497. |
| Buying/Selling roles | **PASS.** Authenticated API responses placed Buyer under Buying, Seller under Selling, with empty opposite roles. Destination switches restored independent lists/selection without demo rows. |
| Actual activity sorting | **PASS.** Sends in listing-index order 3,1,4,2,0 produced canonical order 0,2,4,1,3. Recent three, +N/expanded list and mobile full list matched backend order. No product sorting code was changed. |
| Deterministic tie | **PASS.** Two existing disposable conversations temporarily received the same activity timestamp through administrative test instrumentation. Backend and actual desktop list used UUID ascending; original times were restored before further sends. No message/identity/trigger/schema was changed. This is controlled tie coverage, not a normal user write permission. |
| Refresh/reopen/leave | **PASS.** At each width, a UI send remained after browser reload. Switching conversations and leaving Messages for Favorites then returning restored canonical histories. |
| Logout/re-login | **PASS.** Actual Settings Log out confirmation led to Welcome; API history became 401. Actual password login UI restored the same persisted conversation/messages. No demo data appeared. |
| Retry/idempotency | **PASS.** First browser send really committed, then its response was replaced with 503. Retry retained the same client UUID and returned the same server message ID. There was one durable row and one reconciled bubble; text typed during retry remained. |
| Input boundaries | **PASS.** Whitespace-only Send disabled; edge whitespace trimmed, internal newline retained; exactly 2000 characters accepted; 2001 rejected with recoverable text and no durable row. Enter, Shift+Enter, native/tracked IME guards, real double-click, repeated Enter, pending click and new-draft retention passed. IME checks waited for idle, so the pending guard could not hide an IME failure. |
| Read/unread | **PASS.** Both viewers saw incoming unread and own exclusion. Opening acknowledged rendered history, cleared only that viewer/conversation, preserved another conversation's unread and did not alter activity. Refresh retained read state. Backend boundaries/monotonic behavior remain verified by Phase 1B/1C too. |
| Sold listing | **PASS.** Owner's actual Mark as sold UI changed an existing listing. Both existing participants reopened and sent TEXT; prior history/snapshot remained. Outsider's new find/create request was rejected. A buyer may see snapshot-only “unavailable” live context because existing Marketplace RLS hides sold rows. |
| Deleted listing | **PASS.** Owner's actual Delete UI removed another listing. Both participants continued TEXT. Nullable live ID and exact original title/4500-cent price/Home & Dorm category survived. View Listing displayed a graceful deleted-listing snapshot, without invalid navigation. |
| Outsider tampering | **PASS.** Detail, history, read and send for Buyer's conversation returned 404 to Outsider. Direct Home URL tampering showed an access error with zero message DOM rows. Hidden controls were not the security boundary. |
| Invalid session | **PASS.** Removing session cookies caused history/send 401. Reloaded UI required sign-in and displayed no messages. Real logout was tested separately. Wall-clock token expiry and refresh-token rotation were not artificially claimed. |
| IMAGE regression | **PASS.** Attachment slide opened while original history DOM/IDs remained mounted. Both empty and selected-image Send stayed disabled with no-upload copy. A valid local JPEG selection caused zero listing-image/Storage writes. Cancel preserved exact selected chat/history and scroll after the defect fix below. |
| 390/430/1280/1536 | **PASS.** Full lists/recent rail, +N/expansion, unread dots, longest legal name, long title, 2000-character/long messages, header/composer, forward/reverse mobile slides, Buying/Selling switches, scrolling, refresh and attachment containment passed. Screenshots were inspected; mobile bottom navigation remained clear. Existing 320 ms slide implementation is unchanged. |
| Error UX | **PASS.** Send failure used real-commit/lost-response injection. Separate list/history/mark-read 503 injections showed existing-style feedback and recovered through Retry. The final test waited for each real successful retry response, rather than treating disappearance of an error as proof. No fake durable messages were added; new drafts were safe. |
| Browser runtime | **PASS.** No page runtime errors across the independent contexts/flows. |

## Defect fixed and harness corrections

**One product bug was found and fixed:** when history had been scrolled to 100,
attachment cancel jumped to the bottom (7150). `MessagesChat` previously passed
`active=false` to MessageHistory during attachment mode, so cancel invoked its
inactive-to-active bottom-scroll behavior. History now retains the real chat's
active lifecycle and temporarily receives no read callback while attachments are
mounted. The normal surface remains inert/hidden through the existing mechanism.
Only these two props changed; header, slide timing, gallery, composer and backend
code were not redesigned/refactored. All four widths now retain the exact saved
scroll and identical message IDs on cancel. TypeScript and scoped ESLint passed.

Harness findings were distinguished from product defects:

- Cleanup initially called Storage remove while listing_images still referenced
  files. The existing publication policy deliberately excludes those rows, and
  remove returned no error but omitted all five files. The harness now deletes
  disposable conversations/listings first, keeps Auth users alive, removes files
  through the normal authenticated owner Storage API and asserts every requested
  path was returned, then deletes users. The initial five leftover files were
  recovered/removed through that same normal API, not raw metadata deletion or a
  policy bypass. All later runs cleaned automatically.
- Playwright's ordinary click waits for aria-disabled to clear, so a “rapid” click
  was initially a legitimate later submission of the new draft. Forced pending
  pointer actions and real double-click events correctly exercise the guard.
- Role queries exclude aria-hidden history during attachment mode. The mounted
  DOM assertion now uses the history's DOM locator, preserving accessibility.
- A proposed 24-character fixture name was correctly rejected; actual username
  limit is 20. That setup transaction rolled back with no users left. The final
  suite used the legitimate maximum without changing validation.

No genuine Messages database-contract defect was found. The verified migration
and migration history were not edited.

## Performance observation, no optimization

For five Buying conversations with live listings, the final warm HTTP list samples
were **286, 263, 255 ms** (median **263 ms**). A pass-through observer invoked the
unchanged Pages handler using the real browser session and counted **21 PostgREST
query requests plus 1 Auth request**: one conversation query, then four enrichment
queries per conversation (counterpart profile, latest message, unread count, live
listing with embedded profile/image fields). The observed handler sample was
**405 ms**, after TypeScript loader setup was excluded from its timer. This counts
upstream query requests, not internal PostgreSQL statements or a query-plan profile.

This bounded N+1 structure is real, but the measured five-conversation workflow
showed no immediate small-volume usability problem. No optimization or new SQL
migration was justified/performed. Observe higher normal volumes before proposing
a separately reviewed batch query; this suite does not claim 50-row load testing.

## Artifacts, checks and cleanup

Ignored local artifacts: `tests/artifacts/messages-phase1d/results.json`, five
listing-publication PNGs, list/chat/attachment PNGs for all four widths, and
`deleted-listing-snapshot.png`. The final JSON records the successful scenarios,
query observation and cleanup counts. Earlier harness/product failures are
documented above; final artifacts represent the last successful run.

To rerun, start the dedicated staging server, set `PLAYWRIGHT_MODULE` to the local
playwright-core installation and `BROWSER_EXECUTABLE` to Chrome, then run
`node tests/messages-e2e-staging.cjs` with the authorized staging CLI login/link.
The harness checks the environment again before writes. Fixture password SQL is
temporary and deleted; browser cookie state is never saved to artifacts.

Checks passed: hosted full E2E; TypeScript `--noEmit --incremental false`; scoped
ESLint; local Messages API target/auth/CSRF/cursor guard test; shared conversation,
message presentation and image tests; documentation links and repository diff check.

Final cleanup: **users=0, listings=0, messages=0, Storage objects=0** for the scoped
fixtures; conversations were explicitly removed first, allowing message cascade.
Actual physical listing files were removed through Storage API, not just SQL
metadata. Temporary credential/query files were deleted. No fixture accounts,
files, synthetic message rows or altered tie activity remain.

## Files changed and production blockers

- `components/home/messages-chat.tsx`: attachment cancel scroll fix (two props).
- `tests/messages-e2e-staging.cjs`: real user workflow/acceptance harness.
- `docs/MESSAGES_PHASE1D.md`: this report.
- `docs/PROJECT_STATUS.md`: Phase 1D pass, after final verification/cleanup.
- Ignored screenshots/results only; `.env.local` and migrations unchanged.

Production remains a separate rollout: review/authorize the production migration
chain and deployment, choose/review how to open the intentional staging-only API
gate, validate production auth/config/operations and monitor normal data volume.
Do not infer production authorization from this pass. Email delivery/signup,
wall-clock expiry/rotation, broad load testing and production operations are not
proved here. Realtime and durable IMAGE/storage/backend work remain future phases.

**STAGING ONLY · PRODUCTION NOT MODIFIED · NO REALTIME · NO DURABLE IMAGE BACKEND ·
NO COMMIT · NO PUSH.**
