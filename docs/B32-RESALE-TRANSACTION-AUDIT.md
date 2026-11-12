# B32 Resale V3 Transaction Audit

## Scope

This audit covers the confirmed-email Resale path from Listing → Offer → Order →
payment-mode-specific handover/completion. Western/UWO identity remains a
separate capability and is not used as a prerequisite for ordinary Resale.
Stripe readiness, PaymentIntent, B31 protection, refund, dispute and payout
guards remain unchanged.

## Findings

| Area                           | Evidence                                                                                                                                      | Classification                                   | Resolution                                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Offer/Order core               | Migration 202610260011 already converts the explicit Offer/Order allowlist to `is_verified_user()` while retaining ownership and state checks | Correct                                          | Kept unchanged                                                                                                  |
| Order snapshot media           | `marketplace_prepare_order_media` in 202610120003 still required a confirmed `@uwo.ca` actor                                                  | P1, reproducible with a confirmed B32 Seller     | Forward migration 202611080009 replaces only this identity predicate with confirmed Auth identity               |
| External exchange and handover | Final definitions in 202610160005/202610150003/202610140002 retained `is_western_user()`                                                      | P1, blocks non-UWO Direct/Interac completion     | Forward migration 202611080009 converts the explicit transaction entry-point allowlist to `is_verified_user()`  |
| Server environment             | `requireOrderRequestEnvironment` and snapshot storage only accepted legacy Staging                                                            | P1, B32 API could not reach the transaction path | Server checks now accept only legacy Staging or the exact B32 project ref; service-role claims remain validated |
| UWO-only capabilities          | UWO verification, identity badge, Western-only capabilities and Shop authority remain separate                                                | Required boundary                                | No global predicate replacement                                                                                 |

## Forward migration

`supabase/migrations/202611080009_resale_verified_transaction_access.sql`

The migration uses an explicit `regprocedure` allowlist and rewrites only
legacy identity predicates in the final function definitions, including the
shared participant lock used by External/Interac completion and cancellation.
It fails closed if a listed function is absent or a rewritten definition still
contains a Western-only guard.
Ownership, participant, listing, media, payment, agreement, cancellation,
handover, payout and financial checks are preserved from the existing bodies.
It does not modify Migrations 004–008 or Migration 011.

## Tests

- `tests/resale-verified-transaction-access.cjs`: static allowlist and guard checks.
- Existing Interac, B31 and B32 tests remain the regression suite.
- Remote application and dual-account completion require the B32 project and
  authenticated test sessions; no remote migration was executed by this audit.

## Remaining acceptance

The B32 remote project still needs the forward migration applied through the
approved Supabase migration channel before non-UWO Direct/Interac Order E2E can
complete. Until then, remote Order creation remains blocked by the old media
predicate. Stripe `uu_pay` remains correctly blocked when Seller Readiness is
not ready; no PaymentIntent or funds operation is created by that block.
