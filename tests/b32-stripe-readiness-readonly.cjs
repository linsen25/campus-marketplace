// Read-only Stripe Test-mode readiness snapshot. This script only retrieves
// the platform and an explicitly supplied connected account.
const fs = require('node:fs')
const assert = require('node:assert/strict')
const Stripe = require('stripe')

const parse = (text) =>
  Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=')
        return [
          line.slice(0, index).trim(),
          line
            .slice(index + 1)
            .trim()
            .replace(/^['"]|['"]$/g, ''),
        ]
      })
  )

const values = parse(fs.readFileSync('.env.b32.test.local', 'utf8'))
const connectedAccount = process.argv[2]
const expectedBinding = process.argv[3]

assert.equal(
  values.NEXT_PUBLIC_SUPABASE_URL,
  'https://giqdwyiupslpfhstbtqf.supabase.co',
  'B32 Supabase isolation mismatch'
)
assert.equal(values.B32_SUPABASE_PROJECT_REF, 'giqdwyiupslpfhstbtqf')
assert.match(values.STRIPE_SECRET_KEY || '', /^sk_test_/)
assert.match(values.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '', /^pk_test_/)
assert.match(values.STRIPE_PLATFORM_ACCOUNT_ID || '', /^acct_/)
assert.match(
  connectedAccount || '',
  /^acct_/,
  'Pass the Test connected account ID as argv[2]'
)
assert.match(
  expectedBinding || '',
  /^[0-9a-f-]{36}$/i,
  'Pass the canonical binding ID as argv[3]'
)
for (const key of [
  'STRIPE_ORDER_PAYMENTS_ENABLED',
  'STRIPE_ORDER_REFUNDS_ENABLED',
  'STRIPE_ORDER_TRANSFERS_ENABLED',
  'STRIPE_ORDER_TRANSFERS_CREATE_APPROVED',
]) {
  assert.notEqual(values[key], 'true', `${key} must remain disabled`)
}

const stripe = new Stripe(values.STRIPE_SECRET_KEY, {
  apiVersion: values.STRIPE_API_VERSION || undefined,
})

const requirementSummary = (account) => ({
  currentlyDue: account.requirements?.currently_due || [],
  pastDue: account.requirements?.past_due || [],
  pendingVerification: account.requirements?.pending_verification || [],
  disabledReason: account.requirements?.disabled_reason || null,
})

;(async () => {
  const [platform, account, accountV2] = await Promise.all([
    stripe.accounts.retrieve(values.STRIPE_PLATFORM_ACCOUNT_ID),
    stripe.accounts.retrieve(connectedAccount),
    stripe.v2.core.accounts.retrieve(connectedAccount, {
      include: ['configuration.recipient', 'requirements', 'identity'],
    }),
  ])
  assert.equal(platform.id, values.STRIPE_PLATFORM_ACCOUNT_ID)
  assert.equal(account.id, connectedAccount)
  assert.notEqual(
    account.id,
    platform.id,
    'Connected account cannot be the platform account'
  )
  assert.equal(
    account.metadata?.uu_binding,
    expectedBinding,
    'Connected account metadata does not identify the canonical binding'
  )
  // Account objects do not expose `livemode` on every Stripe API version.
  // The credential prefix is the authoritative fail-closed mode check here;
  // assert the field too when the selected API version returns it.
  if (typeof platform.livemode === 'boolean')
    assert.equal(platform.livemode, false)
  if (typeof account.livemode === 'boolean')
    assert.equal(account.livemode, false)

  console.log(
    JSON.stringify(
      {
        mode: 'test',
        platformAccountId: platform.id,
        connectedAccountId: account.id,
        country: account.country || null,
        businessType: account.business_type || null,
        detailsSubmitted: account.details_submitted,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        requirements: requirementSummary(account),
        capabilities: account.capabilities || {},
        recipientCapabilities:
          accountV2.configuration?.recipient?.capabilities?.stripe_balance ||
          {},
        minimumDeadline:
          accountV2.requirements?.summary?.minimum_deadline?.status || null,
        payoutDestinations: (account.external_accounts?.data || [])
          .filter((entry) => entry.object === 'bank_account')
          .map((entry) => ({
            currency: entry.currency,
            defaultForCurrency: entry.default_for_currency,
            status: entry.status,
            hasLast4: Boolean(entry.last4),
          })),
        controller: account.controller || null,
        metadataKeys: Object.keys(account.metadata || {}).sort(),
        canonicalBindingMetadataMatches: true,
      },
      null,
      2
    )
  )
})().catch((error) => {
  console.error(
    error?.type || error?.name || 'StripeError',
    error?.code || '',
    error?.message || ''
  )
  process.exitCode = 1
})
