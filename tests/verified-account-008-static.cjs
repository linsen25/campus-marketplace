// Static contract checks for 202610260008.  A live PostgreSQL execution is
// intentionally out of scope here; this verifies the migration's explicit
// function identity manifest and the historical definitions it targets.
const assert = require('node:assert/strict')
const fs = require('node:fs')

const migration = fs.readFileSync(
  'supabase/migrations/202610260008_verified_account_core_permissions.sql',
  'utf8'
)
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
const baselineExpected = new Map([
  ...targets.map(([schema, name, args]) => [
    `${schema}.${name}(${args.replaceAll(' ', '')})`,
    previouslyConverted.has(`${schema}.${name}(${args.replaceAll(' ', '')})`)
      ? 0
      : name === 'marketplace_notifications'
      ? 2
      : [
          'marketplace_record_verified_chat_image',
          'marketplace_finalize_image_message',
          'marketplace_abandon_image_message',
          'marketplace_expire_image_submissions',
        ].includes(name)
      ? 0
      : 1,
  ]),
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
  const signature = `${schema}.${name}(${args.replaceAll(' ', '')})`
  const entry = manifest.find(
    (item) => item.signature.replaceAll(' ', '') === signature
  )
  assert(entry, `008 manifest missing: ${signature}`)
  assert.equal(entry.expected, baselineExpected.get(signature))
  if (previouslyConverted.has(signature)) {
    assert.equal(entry.expected, 0)
    console.log(
      `PASS ${signature}: already converted before 008; expected old predicates=0`
    )
  } else {
    console.log(
      `PASS ${signature}: baseline expected old predicates=${entry.expected}`
    )
  }
}

assert.match(migration, /changed := changed \+ 1/)
assert.match(migration, /changed = 0/)
assert(!migration.includes('grant execute'))
assert(!migration.includes('revoke all'))
console.log(
  'PASS 008 static identity, replacement, ACL and search_path contract (database NOT TESTED)'
)
