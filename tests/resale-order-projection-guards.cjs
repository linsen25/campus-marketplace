const fs = require('fs')

const sql = fs.readFileSync(
  'supabase/migrations/202611090010_resale_verified_order_projection_guards.sql',
  'utf8'
)

for (const signature of [
  'public.marketplace_order_economics(uuid)',
  'public.marketplace_order_meetup_history(uuid)',
  'public.marketplace_campus_payment_state(uuid)',
]) {
  if (!sql.includes(`'${signature}'`))
    throw new Error(`missing projection allowlist entry: ${signature}`)
}

if (!sql.includes('marketplace_private.is_verified_user()'))
  throw new Error('projection migration lacks verified-user replacement')
if (!sql.includes('after_acl aclitem[]'))
  throw new Error('projection metadata ACL comparison is missing its declaration')
if (!sql.includes('Offer validator baseline drifted'))
  throw new Error('offer validator fail-closed baseline check missing')
if (!sql.includes('location is null and revision = 0 and status = \'confirmed\''))
  throw new Error('nullable initial meetup location invariant missing')
if (!sql.includes('alter column location drop not null'))
  throw new Error('migration does not resolve the historical NOT NULL conflict')
if (!sql.includes('marketplace_private.validate_meetup(jsonb,timestamptz)'))
  throw new Error('strict meetup proposal validator baseline missing')
if (!sql.includes("marketplace_private.seed_order_meetup()"))
  throw new Error('order meetup seed baseline check missing')
if (!sql.includes("marketplace_private.protect_meetup_revision()"))
  throw new Error('meetup revision protection baseline check missing')
if (sql.includes('new_fragment text'))
  throw new Error('migration must not make offer location mandatory')
if (/update\s+public\.(orders|order_meetup_revisions)/i.test(sql))
  throw new Error('migration must not rewrite historical orders or meetup rows')
if (!sql.includes("marketplace_private.validate_offer_terms(jsonb,timestamptz)"))
  throw new Error('offer validator signature missing')

const ordersService = fs.readFileSync('lib/server/orders-service.ts', 'utf8')
if (!ordersService.includes('r.location == null ? null : String(r.location)'))
  throw new Error('order projection must preserve an unset meetup location as null')
for (const file of [
  'components/home/order-meetup.tsx',
  'components/home/order-stage-details.tsx',
  'components/home/agreement-card.tsx',
]) {
  const source = fs.readFileSync(file, 'utf8')
  if (!source.includes('To be arranged'))
    throw new Error(`${file} lacks the unset-location presentation`)
}

console.log('PASS projection read guards, nullable meetup invariant, and To be arranged presentation review')
