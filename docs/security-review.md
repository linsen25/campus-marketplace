# Canonical Supabase security review

Reviewed against `uqhyjpjiznpgomuizfqe` on 2026-11-13. This is a review record,
not a remote schema change.

## Expected private-table notice

The Supabase advisor reports 64 `RLS Enabled No Policy` informational findings
in `marketplace_private`. These tables are intentionally private operational
state: RLS is enabled and browser roles have no direct table grants. Access is
through reviewed SECURITY DEFINER RPCs only. Do not add blanket policies merely
to silence the advisor.

## Anonymous SECURITY DEFINER warning

The advisor reports five anonymous-executable SECURITY DEFINER functions:

- public shop directory/detail/product projections;
- username-availability validation;
- `rls_auto_enable()`.

The shop and username functions have fixed empty search paths and return
intentionally public, bounded projections. `rls_auto_enable()` has a fixed
`pg_catalog` path and is an event-trigger function; it should nevertheless be
reviewed before launch to determine whether public EXECUTE can be revoked
without affecting DDL tooling. That is a candidate minimal migration, not an
automatic Phase 4 change.

## Authenticated SECURITY DEFINER warnings

The remaining advisor warnings are authenticated RPCs for participant-scoped
messages, offers, orders, fulfillment, shop actions, payment state, and UWO
badge projection. Their use of SECURITY DEFINER is intentional because client
roles cannot access private operational tables directly. Each must retain a
fixed search path and explicit `auth.uid()`, verified-user, participant, and
state checks. The existing canonical qualification suite is the regression
baseline; new RPCs require a matching positive and cross-account negative test.

## Before enabling integrations

Review any proposed new migration for owner, ACL, search path, and RLS changes.
Worker/cron and Stripe configuration are not enabled in this phase. No advisor
warning was suppressed or remediated remotely here.
