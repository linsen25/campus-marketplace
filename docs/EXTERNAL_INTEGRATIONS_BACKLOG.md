# External integrations backlog

Checkpoint scope: **PROVIDER-INDEPENDENT / DOMAIN BACKEND COMPLETE**.
External services are intentionally deferred. No provider has been selected.
**REAL-MONEY PAYMENT NOT YET INTEGRATED.** Interfaces are not operational provider integrations.

| Integration | Current backend foundation | What is still missing | Why deferred | Future decision required | Suggested integration boundary | Blocks checkpoint? |
| --- | --- | --- | --- | --- | --- | --- |
| Payment | Frozen integer-cent economics; shared attempt/state authority; staging resolver; idempotency and concurrency guards | Real charges, verified webhooks, reconciliation and refund execution | Explicit provider deferral | Provider, tax/processing treatment and refund policy | Server adapter in `lib/server/payment-provider-boundary.ts`; verified events into trusted resolution | No |
| Payout | Completed/no-case eligibility; capability/status projection; Seller fee CA$0 | Provider onboarding, execution and reconciliation | Explicit provider deferral | Provider and operational payout rules | Authorized server payout adapter consuming frozen economics and eligibility | No |
| Maps/Places | Coarse Delivery area and meetup location fields; immutable accepted snapshots | Search, geocoding, maps, distance/routing | Backend terms do not require Maps | Provider, privacy and location UX | Input assistance only; accepted server terms remain authority | No |
| Email notifications | Persisted notifications, recipients, priority, read state, deep links, coalescing and reminders | Outbound delivery, provider retries and delivery tracking | Domain records are separate from delivery | Provider, consent/preferences and delivery policy | Durable notification IDs through a server delivery adapter | No |
| Push notifications | Same durable notification domain | Device registration, delivery, retries and preferences | Explicit channel deferral | Platform/provider and permission UX | Authorized per-recipient delivery adapter | No |
| Hosted media cleanup executor | 24h orphan TTL, bounded candidates, deletion lease/reclaim, bind/delete exclusion and local/manual staging worker | Hosted scheduling/operations for Storage deletion | Accepted external/ops deferral | Hosting, credentials, monitoring and execution budget | Existing `sweepOrderSnapshotMedia` via a staging-guarded server worker | No |
| Carrier integration | Tracking metadata; staging trusted Delivered boundary; independent Buyer Confirm Received | Verified carrier feed/webhooks and live sync | No carrier selected; tracking strings are not possession authority | Carrier/provider and event verification | Verified adapter into trusted possession authority | No |
| Image processing/CDN, if needed | Existing listing upload and private immutable order media/signing flows | Any additional external transformation/CDN service | No additional service requirement established | Whether needed, retention/privacy and provider | Existing upload/signing boundary without weakening private access | No |
| Dispute/refund external/admin layer | One unresolved Protection case holds completion and payout; case remains resolution-required | Authorized adjudication, refund policy and execution/audit operations | Product policy/provider decisions deferred | Evidence, resolution, appeal and refund allocation rules | Authorized audited case-resolution boundary; no automatic invented verdict | No |

**PRIVATE MEDIA CLEANUP DOMAIN: COMPLETE**

**HOSTED MEDIA CLEANUP EXECUTOR: DEFERRED EXTERNAL/OPS INTEGRATION**

The local worker path exists; this checkpoint does not claim it is a deployed,
continuously running hosted service. The hosted minute cron handles transaction
due-work only. Scheduled notification records do not imply email/push delivery.

Future frontend/UX: Agreement Card, Maps input assistance, Notifications feed/Bell,
Browse/Search polish and general frontend polish. Delivery editor wiring must
collect the accepted coarse area; it must not invent a default area.

See [backend qualification and migration hashes](BACKEND_COMPLETION_STAGING.md).

Deferred handoff UI: **Add real local QR rendering for the existing authoritative
handoff QR payload.** No QR package or scanning is introduced in the current UI
pass. The reserved neutral QR area and real six-digit fallback appear only for
the Buyer at the authoritative Paid handoff stage, never for Courier. The area
does not contain a fake QR pattern or visible raw QR token.
