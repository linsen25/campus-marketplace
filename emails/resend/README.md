# Resend transactional templates

This directory is the version-controlled source for UU's Resend templates.
Run `node scripts/sync-resend-templates.cjs` from the repository root to create
or update the four templates by stable alias, then publish them. The script uses
the already-authenticated Resend CLI and never reads or writes an API key.

The required sender configuration is environment-only:

- `EMAIL_FROM`: current sender; initially `Usual & Unusual <onboarding@resend.dev>`.
- `RESEND_PRODUCTION_FROM_EMAIL`: a deployment-time reminder only; leave unset until a verified UU domain exists, then set `EMAIL_FROM` to that verified sender.
- `RESEND_REPLY_TO`: leave unset until a real monitored mailbox exists.
- `RESEND_EMAIL_ENABLED`: delivery gate; must remain disabled outside an explicitly enabled environment.
- `RESEND_TEST_RECIPIENT`: required for the Resend test sender; it must be the account-authorized address.

These are Resend templates, whose placeholders use `{{{NAME}}}`. They are not
Supabase Auth templates. Supabase must continue to generate and validate signup
and recovery tokens; any future Auth integration must map its trusted token or
recovery link into a Resend variable without storing, generating, or validating
credentials in Resend.

All values inserted into the order template must be HTML-escaped by the trusted
server-side sender before being passed as Resend template variables. URLs must
be server-generated same-origin HTTPS (or the explicitly allowed localhost
development origin), not client-provided.
