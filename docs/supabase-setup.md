# Phase 4: Supabase setup

The marketplace now uses Supabase PostgreSQL, email authentication, and Storage.
The retail homepage, catalog, Product routes, and Algolia remain separate and unchanged.
No service-role key is needed. Do not add one to this application's environment.

Status (2026-09-30): the owner reports local live verification against cloud
Supabase passed, including OTP, CRUD, images, restart persistence, and ownership.
Development email delivery uses Gmail SMTP. These instructions remain the setup
and regression checklist; see [Project Status](PROJECT_STATUS.md) for current progress.

**TODO BEFORE PUBLIC LAUNCH:** Replace Gmail SMTP with a transactional email provider
using an owned domain, such as Resend, Postmark, SES, or Brevo. Verify deliverability
to @uwo.ca accounts before launch. Keep this TODO until configured and tested.

## 1. Create a project

1. Create a project at https://supabase.com/dashboard. Choose a region and save the
   database password privately. This app does not need the database password.
2. Wait for the project to finish provisioning. Use a dedicated new project: the
   migration restricts this project's Auth users to Western email addresses.
3. From the project's Connect dialog or Settings → API, copy the project URL and
   public **anon** key (or public publishable key). Never use `service_role` or a
   secret key in either variable below.
4. Append these values to your existing `.env.local`, preserving all Algolia entries:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY
   ```

   `.env.sample` documents the variables. `.env.local` is ignored by Git.
   Restart Next.js after changing them. Set the same values in your deployment's
   environment **before building**, so Next Image knows the project hostname.

## 2. Apply the schema and RLS

Open SQL Editor → New query, paste the complete contents of
[`supabase/migrations/202609290001_marketplace.sql`](../supabase/migrations/202609290001_marketplace.sql),
and run it once. It runs in a transaction; fix any error before retrying. For CLI
users, the same file is a standard versioned Supabase migration. It creates:

- `profiles`: auth UUID, public display name, timestamps. No public email.
- `listings`: seller UUID, marketplace fields, integer CAD cents, timestamps,
  generated search text, and constraints matching the Listing model.
- `listing_images`: up to six unique numbered slots per listing, object path,
  owner, publication state, and timestamps.
- A public `listing-images` Storage bucket limited to JPEG/PNG/WebP and 3 MiB.
- RLS and column grants. Anonymous visitors read listings. Only confirmed
  `@uwo.ca` users create listings or modify their own rows. Seller IDs, IDs,
  timestamps, and image paths cannot be supplied or overwritten by users.

The application never uses a service-role client; authenticated database calls
carry the user's session and remain subject to RLS. Public read policies include
sold listings, while the browse page explicitly filters for available listings.

## 3. Configure email authentication

1. In Authentication → Sign In / Providers, enable Email, email confirmation, and
   new-user signup. Disable anonymous signup, phone, and unused OAuth providers.
2. Under Authentication → Hooks, enable **Before User Created**, select the
   PostgreSQL function `public.before_western_user_created`. The migration grants
   execution only to `supabase_auth_admin`.
3. The migration also installs an Auth-table email guard. It blocks non-`@uwo.ca`
   signup and confirmed email changes to other domains even if a caller bypasses
   this app. RLS checks the current confirmed Auth email, not editable user metadata.
4. Configure custom SMTP under Authentication → Email/SMTP **before live auth
   verification**. The project owner reports that new Supabase Free projects cannot
   customize Auth email templates with default SMTP. This earlier blocker was
   resolved using Gmail SMTP for development; the UI expects an Email OTP code.
5. Under Email Templates, update **Magic link or OTP** (also called **Magic Link**)
   and **Confirm signup** to include `{{ .Token }}` and display
   an email code rather than requiring a redirect link:

   ```html
   <h2>Marketplace sign-in code</h2>
   <p>Enter this code in the marketplace: {{ .Token }}</p>
   <p>If you did not request it, ignore this message.</p>
   ```

6. Test delivery to a real `@uwo.ca` mailbox and confirm the email includes the OTP
   code before proceeding with live authentication verification.
7. Keep Auth rate limits enabled. Set a suitable short OTP expiration, such as
   10 minutes, and use the default six-digit token configuration. The UI accepts
   6–10 digits. Use Supabase's cooldown before requesting another email.
8. Under URL Configuration, set Site URL to `http://localhost:3000` locally and
   your exact HTTPS application origin in production. This code-entry flow has
   no callback route and needs no wildcard redirect allowlist. Remove unused
   redirect URLs; do not allow arbitrary origins.

`/auth/sign-in` requests and verifies codes through same-origin Next.js API routes.
New profiles get the submitted display name or `Western member`; this name is not
an identity credential. Session tokens stay in HTTP-only SameSite cookies, refreshed
on authenticated server requests. Sign Out clears this browser's session. User
identity is verified with `auth.getUser()`, not a client-supplied seller ID.
Product language says **Western email verified**, not verified student.

## 4. Storage and uploads

The migration creates the bucket and policies; do not add permissive public write
policies in the dashboard. Confirm the bucket's 3 MiB limit and JPEG/PNG/WebP
allowlist in Storage settings. Bucket reads are public because marketplace photos
are public; they must not contain private documents.

The app sends one raw image per request to a Next.js API route. It checks the
session, listing ownership, byte count, MIME type, and file signature. It reserves
a database slot before uploading, and publishes the reference only after upload
succeeds. SQL constraints enforce at most six slots even for concurrent requests.
Storage RLS permits inserts only at a reserved path belonging to that user/listing.
Paths are `user UUID/listing UUID/image UUID`; files cannot overwrite existing objects.
The browser never directly queries a table or receives a service-role credential.

Create/edit saves text first, then processes photos. On an upload failure the text
listing remains saved, the form reports the failure, and retry reuses its ID to avoid
duplicate listings. Failed uploads attempt to remove their reservation and object.

Deletion removes the database listing first (cascading image references), then
attempts Storage cleanup using the owner's session. A network/storage failure can
leave an orphan public object; deletion is not rolled back. Concurrent upload and
deletion can also leave an orphan because database and Storage operations are not
one transaction. Server logs identify detected cleanup failures and
the listing UUID needing cleanup. In Storage, locate that user's/listing's folder
and delete it through the dashboard or Storage API **after confirming the listing
row no longer exists**. Do not delete rows directly from `storage.objects`.
Interrupted uploads can leave pending (`ready=false`) slots. After confirming no
upload is in progress, remove any associated object through Storage, then remove
that pending `listing_images` row in the dashboard. No background cleanup worker
is included in this phase. Previously downloaded images cannot be recalled.

## 5. Run locally and deploy

Use Node.js **22 or newer** (the current Supabase SDK requirement; tested with 24).
Run `npm install`, then `npm run dev`. Visit `/listings`, sign in with a real Western
mailbox, and create a listing. Production must use HTTPS. Session-bearing pages,
API calls, and their Next page-data requests are excluded from PWA runtime caches;
the existing retail caching behavior is retained. Sign-in/out performs a full
navigation to discard client-side page caches.

PostgreSQL and Storage persist independently of the Next.js server. Restarting
Next.js or using multiple instances does not reset listings. Existing Phase 1
fixtures are not imported or assigned to invented auth users. The unused memory adapter,
seller, notice, and obsolete persistence documentation were removed after live verification;
there is no automatic fallback to them when configuration or Supabase is unavailable.

## 6. Verification

Run TypeScript and scoped ESLint for Phase 4 files. The ordinary production build
still encounters pre-existing CRLF/Prettier errors outside this phase; the diagnostic
command is `npm run build -- --no-lint`. Do not use that command to hide new errors.

The SQL security regression test uses a separate PGlite PostgreSQL runtime with
stand-ins for Supabase's Auth and Storage tables. It exercises the actual migration,
constraints, privileges, and RLS without any project credentials:

```powershell
npm install --prefix "$env:TEMP/pwa-phase4-db-tests" @electric-sql/pglite --no-save --ignore-scripts
$env:PGLITE_MODULE = "$env:TEMP/pwa-phase4-db-tests/node_modules/@electric-sql/pglite"
node tests/marketplace-security.cjs
node tests/marketplace-domain.cjs
node tests/marketplace-session.cjs
```

Before treating the hosted integration as accepted, verify with two real test
Western accounts and an incognito/public session:

1. Non-Western signup fails; a Western mailbox receives a code; wrong/expired
   codes fail; the correct code signs in and survives a page refresh.
2. Public browsing works, Post Listing/My Listings redirect to Sign In, and
   unauthenticated API writes return 401.
3. Account A creates a listing, edits it, and sees it in My Listings. Account B
   can read it but cannot edit/sell/delete it, including direct API requests.
4. Upload JPEG/PNG/WebP files; reject SVG, mismatched bytes, files over 3 MiB,
   and a seventh image. Verify public photo rendering and owner-only deletion.
5. Mark sold: public default results exclude it, My Listings retains it.
6. Restart Next.js: records and photos remain. Delete: listing/detail/edit become
   unavailable and object cleanup succeeds (or follow the cleanup procedure above).
7. Sign out, then sign in as B on the same browser: A's management data must not
   reappear from a PWA or router cache. Check offline behavior too.

The session contract test mocks the Auth network transport; it verifies cookie
flags, refresh rotation, and sign-out handling, not actual email delivery or JWT
validation by the hosted service. The production HTTP checks without configuration
verify explicit 503 setup errors and rejected writes, not hosted CRUD success.

These live email/session/Storage checks cannot be certified without a configured
Supabase project and access to test mailboxes.

## References

- [Supabase passwordless email / OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless)
- [Supabase cookie-based server clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Before User Created hook](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook)
- [Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
