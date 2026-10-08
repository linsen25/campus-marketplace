// STATIC source contract only: no database, Realtime, Auth or network execution.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')

for (const [file, expected] of [
  [
    '202610070001_messages_text.sql',
    '2ee6cb35370c05cbc76d57fa78efd319cda24c1987cb8a5cbf5593121a3d4b7f',
  ],
  [
    '202610070002_messages_images.sql',
    'e9257f0b3121660a7db574c92cc23a557575910513e7220ae6fe60b4bc10ea18',
  ],
]) {
  assert.equal(
    crypto.createHash('sha256').update(fs.readFileSync(`supabase/migrations/${file}`)).digest('hex'),
    expected,
    `Applied baseline changed: ${file}`
  )
}

const source = fs.readFileSync('supabase/migrations/202610080001_messages_realtime.sql', 'utf8')
const sql = source.replace(/--[^\n]*/g, '')
assert.match(source, /AUTHORING ONLY: NOT APPLIED OR EXECUTED/)
assert.match(sql, /^\s*begin;/)
assert.match(sql, /commit;\s*$/)
assert.match(sql, /to_regprocedure\('realtime\.send\(jsonb,text,text,boolean\)'\)/)
assert.match(sql, /to_regprocedure\('realtime\.topic\(\)'\)/)
assert.match(sql, /c\.relrowsecurity/)
assert.match(sql, /has_table_privilege\('authenticated', 'realtime\.messages', 'SELECT'\)/)
assert.match(sql, /pg_publication_tables[\s\S]*pubname = 'supabase_realtime'/)
assert.match(sql, /tablename in \('conversations','messages','message_images','image_message_submissions'\)/)
assert.doesNotMatch(sql, /alter\s+publication|create\s+publication|replica\s+identity|create\s+table|alter\s+table|grant\s|storage\./i)
assert.doesNotMatch(sql, /before\s+(insert|update)|after\s+delete|prepare_text_message|marketplace_send_text|marketplace_finalize_image_message/i)

const functions = [...sql.matchAll(/create or replace function marketplace_private\.(\w+)\(\) returns trigger\s+language plpgsql security definer set search_path = '' as \$\$([\s\S]*?)end; \$\$;/g)]
assert.deepEqual(functions.map((m) => m[1]), ['notify_message_realtime', 'notify_conversation_realtime'])
for (const [, name, body] of functions) {
  assert.match(body, /join auth\.users u on u\.id = members\.id/, `${name}: recipients must be current verified users`)
  assert.match(body, /u\.email_confirmed_at is not null/)
  assert.match(body, /pg_catalog\.lower\(u\.email\) ~ '\^\[\^\[:space:\]@\]\+@uwo\[\.\]ca\$'/)
  assert.match(body, /'messages_changed', 'marketplace:messages:' \|\| recipient\.id::text, true\)/)
  assert.match(body, /exception when others then[\s\S]*SQLSTATE=%[\s\S]*return new;/)
  assert.doesNotMatch(body, /raise exception|sqlerrm|new\.content|storage_path|previewUrl|jsonb_build_object\([^;]*'unread|to_jsonb\(new\)|row_to_json/i)
  const payload = body.match(/jsonb_build_object\(([\s\S]*?)\),\s*'messages_changed'/)[1]
  assert.deepEqual([...payload.matchAll(/'([^']+)'/g)].map((m) => m[1]), [
    'conversationId', 'role', 'scope', name === 'notify_message_realtime' ? 'history' : 'list',
  ])
}
assert.match(functions[0][2], /from public\.conversations c[\s\S]*c\.buyer_id[\s\S]*c\.seller_id[\s\S]*c\.id = new\.conversation_id/)
assert.match(functions[1][2], /new\.buyer_last_read_sequence = old\.buyer_last_read_sequence then continue/)
assert.match(functions[1][2], /new\.seller_last_read_sequence = old\.seller_last_read_sequence then continue/)
assert.match(sql, /revoke all on function marketplace_private\.notify_message_realtime\(\),\s*marketplace_private\.notify_conversation_realtime\(\) from public, anon, authenticated, service_role;/)
assert.match(sql, /create trigger messages_realtime_signal after insert on public\.messages/)
assert.match(sql, /create trigger conversations_realtime_signal after insert or update on public\.conversations/)
assert.equal([...sql.matchAll(/create trigger/g)].length, 2)

const policies = [...sql.matchAll(/create policy (\w+) on realtime\.messages\s+([\s\S]*?);/g)]
assert.equal(policies.length, 5)
assert.match(policies[0][2], /for select to authenticated/)
for (const body of [policies[0][2], policies[1][2]]) {
  assert.match(body, /extension = 'broadcast'/)
  assert.match(body, /topic = 'marketplace:messages:' \|\| \(select auth\.uid\(\)\)::text/)
  assert.match(body, /topic = \(select realtime\.topic\(\)\)/)
  assert.match(body, /marketplace_private\.is_western_user\(\)/)
}
assert.match(policies[1][2], /as restrictive for select to public/)
assert.match(policies[1][2], /auth\.role\(\)\) = 'authenticated'[\s\S]*else false end\s*else true end/)
for (const operation of ['insert', 'update', 'delete']) {
  const policy = policies.find(([, name]) => name.endsWith(`${operation}_fence`))
  assert.match(policy[2], new RegExp(`as restrictive for ${operation} to public`))
  assert.match(policy[2], /coalesce\(topic, ''\) not like 'marketplace:messages:%'/)
}
assert.match(policies.find(([, name]) => name.endsWith('update_fence'))[2], /using[\s\S]*with check/)
assert.deepEqual(
  [...sql.matchAll(/drop policy if exists (\w+)/g)].map((m) => m[1]),
  policies.map((m) => m[1])
)
assert.doesNotMatch(sql, /drop\s+(table|schema|publication)|delete from|update\s+public\.|insert into\s+public\./i)
console.log('PASS STATIC Realtime contract: unchanged TEXT/IMAGE hashes; hosted capability/publication gates; private recipient-derived minimal Broadcast signals; namespace read/write fences; hardened optional triggers; no publication, Storage or baseline changes. SQL NOT executed; hosted RLS/Broadcast/frontend verification PENDING.')
