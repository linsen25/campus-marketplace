// Static contract checks for 202610260008.  A live PostgreSQL execution is
// intentionally out of scope here; this verifies the migration's explicit
// function identity manifest and the historical definitions it targets.
const assert = require('node:assert/strict')
const fs = require('node:fs')

const migration = fs.readFileSync(
  'supabase/migrations/202610260008_verified_account_core_permissions.sql',
  'utf8'
)
const sourceFiles = [
  '202610030001_marketplace_usernames.sql',
  '202610070001_messages_text.sql',
  '202610070002_messages_images.sql',
  '202610130001_notifications_domain.sql',
  '202610150004_notification_delivery_foundation.sql',
  '202610160001_notification_inbox_management.sql',
  '202610160002_notification_preferences.sql',
  '202610190006_shop_favorites.sql',
  // This later migration is authoritative for the two conversation targets.
  '202610260004_verified_shop_contact_seller.sql',
]
const source = sourceFiles
  .map((file) => fs.readFileSync(`supabase/migrations/${file}`, 'utf8'))
  .join('\n')

const targets = [
  ['public', 'marketplace_confirm_username', 'text'],
  ['public', 'marketplace_change_username', 'text'],
  ['marketplace_private', 'protect_conversation_identity', ''],
  ['marketplace_private', 'prepare_text_message', ''],
  ['public', 'marketplace_find_or_create_conversation', 'uuid'],
  ['public', 'marketplace_send_text', 'uuid,uuid,text'],
  ['public', 'marketplace_mark_conversation_read', 'uuid,bigint'],
  ['marketplace_private', 'guard_image_submission', ''],
  ['marketplace_private', 'lock_image_submission', 'uuid'],
  ['public', 'marketplace_prepare_image_message', 'uuid,uuid,jsonb'],
  [
    'public',
    'marketplace_record_verified_chat_image',
    'uuid,uuid,uuid,uuid,text',
  ],
  ['public', 'marketplace_finalize_image_message', 'uuid'],
  ['public', 'marketplace_abandon_image_message', 'uuid'],
  ['public', 'marketplace_expire_image_submissions', 'integer'],
  ['public', 'marketplace_notifications', 'timestamptz,uuid'],
  ['public', 'marketplace_mark_notification_read', 'uuid'],
  ['public', 'marketplace_mark_all_notifications_read', ''],
  ['public', 'marketplace_mutate_notifications', 'uuid[],text'],
  ['public', 'marketplace_notification_preferences', ''],
  ['public', 'marketplace_set_notification_preference', 'text,boolean'],
  ['public', 'marketplace_favorite_shops', 'jsonb'],
  ['public', 'marketplace_shop_favorite_states', 'uuid[]'],
  ['public', 'marketplace_set_shop_favorite', 'uuid,boolean'],
]
const previouslyConverted = new Set([
  'marketplace_private.protect_conversation_identity()',
  'public.marketplace_find_or_create_conversation(uuid)',
])

const manifestBlock = migration.match(
  /from \(values(.*?)\) v\(signature,expected\)/s
)
assert(manifestBlock, '008 must contain an explicit signature manifest')
const manifest = [
  ...manifestBlock[1].matchAll(/\('([^']+)'\s*,\s*(\d+)\)/g),
].map((match) => ({ signature: match[1], expected: Number(match[2]) }))
assert.equal(manifest.length, targets.length)
assert.equal(
  new Set(manifest.map((item) => item.signature)).size,
  targets.length
)

for (const [schema, name, args] of targets) {
  const escapedSchema = schema.replace(/[.]/g, '\\.')
  const declaration = new RegExp(
    `create(?: or replace)? function\\s+${escapedSchema}\\.${name}\\s*\\(([^)]*)\\)`,
    'gi'
  )
  const matches = [...source.matchAll(declaration)]
  const sourceMatch = matches.at(-1)
  assert(sourceMatch, `historical definition missing: ${schema}.${name}`)
  const signature = `${schema}.${name}(${args.replaceAll(' ', '')})`
  const entry = manifest.find(
    (item) => item.signature.replaceAll(' ', '') === signature
  )
  assert(entry, `008 manifest missing: ${signature}`)
  const start = sourceMatch.index
  const next = source
    .slice(start + 1)
    .search(/\ncreate(?: or replace)? function\s/i)
  const body = source.slice(start, next < 0 ? undefined : start + 1 + next)
  assert(
    /set search_path\s*=\s*''/i.test(body),
    `${schema}.${name} must retain a fixed search_path`
  )
  const oldCount = (
    body.match(/marketplace_private\.is_western_user\(\)/g) || []
  ).length
  const occurrences = (
    body.match(/marketplace_private\.is_verified_user\(\)/g) || []
  ).length
  if (oldCount > 0) {
    assert.equal(occurrences, 0, `${schema}.${name} source is already migrated`)
    assert.equal(entry.expected, oldCount)
    console.log(
      `PASS ${schema}.${name}(${args}): expected legacy predicates=${oldCount}`
    )
  } else {
    if (previouslyConverted.has(signature)) {
      assert(
        occurrences > 0,
        `${schema}.${name} has no legacy predicate but must retain the verified predicate`
      )
      console.log(
        `PASS ${schema}.${name}(${args}): already converted; verified predicate present`
      )
    } else {
      assert.equal(entry.expected, 0)
      assert.equal(
        occurrences,
        0,
        `${schema}.${name} unexpectedly gained a verified predicate`
      )
      console.log(
        `PASS ${schema}.${name}(${args}): no legacy predicate; no replacement required`
      )
    }
  }
}

assert.match(migration, /changed := changed \+ 1/)
assert.match(migration, /changed = 0/)
assert(!migration.includes('grant execute'))
assert(!migration.includes('revoke all'))
console.log(
  'PASS 008 static identity, replacement, ACL and search_path contract (database NOT TESTED)'
)
