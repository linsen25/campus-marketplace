const fs = require('fs')

const source = fs.readFileSync(
  'components/payments/stripe-account-onboarding.tsx',
  'utf8'
)
const panel = fs.readFileSync(
  'components/payments/stripe-flow-panel.tsx',
  'utf8'
)
const settings = fs.readFileSync(
  'components/home/financial-settings.tsx',
  'utf8'
)
const server = fs.readFileSync('lib/server/stripe-setup.ts', 'utf8')

for (const marker of [
  'setOnLoadError',
  'setOnLoaderStart',
  'setOnExit',
  'setOnStepChange',
  'Waiting for Stripe verification',
  'Complete verification in the Stripe window to continue.',
  '60 * 1000',
  "colorPrimary: '#7c3aed'",
  'buttonPrimaryColorBackground',
  'colorSecondaryText',
  'data-stripe-onboarding-timeline',
  'onboardingPhases',
  'sessionRequest',
  'return (await loadSession()).clientSecret',
  "from '@stripe/connect-js/pure'",
  "error.message.includes('already being updated')",
  'colorSecondaryText',
  'Verify your identity with Stripe',
  'Option 1 — Photo ID + selfie',
  'Option 2 — Photo ID + proof of address',
  'Stripe determines which verification options are available.',
]) {
  if (!source.includes(marker))
    throw new Error(`missing onboarding lifecycle marker: ${marker}`)
}
for (const marker of [
  'Exit verification?',
  'You can return later to continue any outstanding steps with Stripe.',
  'preventScrimClose',
  'confirmClose',
  '>Stay<',
  '>Exit<',
]) {
  if (!panel.replace(/\s+/g, '').includes(marker.replace(/\s+/g, '')))
    throw new Error(`missing safe exit marker: ${marker}`)
}
if (!settings.includes('data-stripe-identity-status'))
  throw new Error('Settings must render the trusted identity status projection')
for (const marker of [
  'Action required',
  'Submitted / Pending review',
  'Ready',
  'Unable to refresh',
]) {
  if (!settings.includes(marker))
    throw new Error(`missing Settings verification status: ${marker}`)
}
if (!server.includes('stripeIdentityVerification'))
  throw new Error('server must project Stripe identity requirements')
if (
  settings.includes('pending_verification') ||
  settings.includes('currently_due')
)
  throw new Error(
    'raw Stripe requirements must not be projected to the browser'
  )
if (source.includes('stripe-account-onboarding.complete'))
  throw new Error('onboarding must not rely on an undocumented custom event')
if (source.includes('connect?.logout()'))
  throw new Error('component disposal must not sign the connected account out')
if (!source.includes("'/api/stripe/reconcile'"))
  throw new Error(
    'completion must be confirmed by the server reconciliation endpoint'
  )

console.log('stripe onboarding lifecycle checks passed')
