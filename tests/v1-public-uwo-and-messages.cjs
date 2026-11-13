const assert = require('node:assert/strict')
const fs = require('node:fs')

const migration = fs.readFileSync(
  'supabase/migrations/20261112063440_v1_public_uwo_badge_and_verified_messages.sql',
  'utf8'
)

assert.match(migration, /add column if not exists uwo_email_verified boolean/i)
assert.match(migration, /uwo_email_verifications v/i)
assert.match(migration, /guard_public_uwo_badge/i)
assert.match(migration, /UWO badge is derived from verified identity/i)
assert.doesNotMatch(migration, /marketplace_uwo_identity_badge/i)
assert.doesNotMatch(migration, /grant execute on function public\.marketplace_/i)
assert.match(migration, /marketplace_private\.is_verified_user\(\)/)
assert.match(migration, /conversations_participant_read/i)
assert.match(migration, /messages_participant_read/i)
assert.match(migration, /buyer_id = \(select auth\.uid\(\)\)/i)
assert.match(migration, /seller_id = \(select auth\.uid\(\)\)/i)
assert.match(migration, /before_owner.*before_security_definer.*before_config.*before_acl/s)
assert.match(migration, /metadata changed unexpectedly/i)

const listingMapper = fs.readFileSync('lib/supabase/listing-mapper.ts', 'utf8')
const messageRepository = fs.readFileSync(
  'lib/server/supabase-messages-repository.ts',
  'utf8'
)
assert.match(listingMapper, /uwo_email_verified\?: boolean/)
assert.match(listingMapper, /uwoEmailVerified: true/)
assert.match(messageRepository, /select\('id,display_name,uwo_email_verified'\)/)
assert.doesNotMatch(messageRepository, /marketplace_uwo_identity_badge/)

console.log(
  'PASS public derived UWO badge and verified participant conversation/message static guards'
)
