// STATIC source-contract checks only: no SQL execution, network, Storage or database connection.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')

const baseline = fs.readFileSync(
  'supabase/migrations/202610070001_messages_text.sql'
)
assert.equal(
  crypto.createHash('sha256').update(baseline).digest('hex'),
  '2ee6cb35370c05cbc76d57fa78efd319cda24c1987cb8a5cbf5593121a3d4b7f',
  'Applied Phase 1 SQL must remain byte-for-byte unchanged'
)
const source = fs.readFileSync(
  'supabase/migrations/202610070002_messages_images.sql',
  'utf8'
)
const sql = source.replace(/--[^\n]*/g, '').toLowerCase()
assert.match(source, /AUTHORED ONLY\. NOT APPLIED or executed/)
assert.match(sql, /^\s*begin;/)
assert.match(sql, /commit;\s*$/)
const section = (start, end) => {
  const from = sql.indexOf(start)
  const to = sql.indexOf(end, from + start.length)
  assert(from >= 0 && to > from, `Missing source section: ${start}`)
  return sql.slice(from, to)
}
const fn = (name) => section(`function ${name}(`, 'end; $$;')
const tables = [...sql.matchAll(/create table ([\w.]+)/g)].map(
  (item) => item[1]
)
assert.deepEqual(tables, [
  'public.image_message_submissions',
  'public.message_images',
  'marketplace_private.chat_image_cleanup',
])
assert.match(
  sql,
  /values \('chat-images','chat-images',false,3145728,array\['image\/jpeg','image\/png','image\/webp'\]\)/
)
assert.doesNotMatch(
  sql,
  /listing-images|supabase_realtime|create publication|alter publication|create extension|create policy.*public read/
)
assert.doesNotMatch(
  sql,
  /(?:delete from|update|alter table|insert into) storage\.objects/
)
assert.doesNotMatch(
  sql,
  /create or replace function public\.(marketplace_send_text|marketplace_mark_conversation_read|marketplace_find_or_create_conversation)/
)

const submissions = section(
  'create table public.image_message_submissions',
  'alter table public.messages'
)
assert.match(
  submissions,
  /references public\.conversations\(id\) on delete cascade/
)
assert.match(submissions, /jsonb_array_length\(manifest\) between 1 and 4/)
assert.match(
  submissions,
  /unique \(conversation_id,sender_id,client_message_id\)/
)
assert.match(submissions, /state in \('pending','finalized','abandoned'\)/)
assert.doesNotMatch(
  submissions,
  /references (auth\.users|public\.profiles)|sequence|last_message_at/
)

const images = section(
  'create table public.message_images',
  'create table marketplace_private.chat_image_cleanup'
)
assert.match(images, /references public\.messages\(id\) on delete cascade/)
assert.match(images, /position between 1 and 4/)
assert.match(images, /unique \(message_id,position\)/)
assert.match(images, /storage_path text not null unique/)
assert.match(images, /size_bytes between 1 and 3145728/)
assert.match(
  images,
  /mime_type in \('image\/jpeg','image\/png','image\/webp'\)/
)
assert.match(images, /sha256 text not null/)
assert.doesNotMatch(images, /preview_url|public_url|signed_url|caption/)
assert.match(
  sql,
  /type = 'text' and content is not null and image_count is null/
)
assert.match(sql, /char_length\(content\) between 1 and 2000/)
assert.match(sql, /content = marketplace_private\.trim_message_text\(content\)/)
assert.match(
  sql,
  /type = 'image' and content is null and image_count is not null and image_count between 1 and 4/
)

const prepare = fn('public.marketplace_prepare_image_message')
assert.match(prepare, /for update/)
assert.match(prepare, /jsonb_array_length\(p_images\) not between 1 and 4/)
assert.match(
  prepare,
  /array\['original_name','mime_type','size_bytes','sha256'\]/
)
assert.match(prepare, /image_id := gen_random_uuid\(\)/)
assert.match(
  prepare,
  /target\.id::text \|\| '\/' \|\| submission_id::text \|\| '\/' \|\| image_id::text/
)
assert.match(prepare, /old_input is distinct from normalized/)
assert.match(prepare, /errcode = '23505'/)
assert.doesNotMatch(
  prepare,
  /insert into public.messages|update public.conversations|update public.image_message_submissions/
)

const lock = fn('marketplace_private.lock_image_submission')
assert(
  lock.indexOf('from public.conversations') < lock.lastIndexOf('for update')
)
assert.match(lock, /actor uuid := auth.uid\(\)/)
assert.match(lock, /submission.sender_id <> actor/)
assert.match(
  lock,
  /target.buyer_id is distinct from actor and target.seller_id is distinct from actor/
)
const receipt = fn('public.marketplace_record_verified_chat_image')
assert.match(receipt, /auth.role\(\) is distinct from 'service_role'/)
assert.match(receipt, /submission.sender_id is distinct from p_actor_id/)
assert.match(receipt, /p_sha256 is distinct from item->>'sha256'/)
assert.match(receipt, /o.id = p_object_id for share/)
assert.match(
  receipt,
  /object.metadata->>'mimetype' is distinct from item->>'mime_type'/
)
assert.match(
  receipt,
  /object.metadata->>'size' is distinct from item->>'size_bytes'/
)
const objects = fn('marketplace_private.assert_image_objects')
assert.match(
  objects,
  /verified_objects->>\(item->>'id'\) is distinct from object.id::text/
)
assert.match(objects, /for share/)
assert.match(objects, /expires_at <= clock_timestamp\(\)/)
const allocate = fn('marketplace_private.prepare_text_message')
assert.match(allocate, /new.sequence := target.last_message_sequence \+ 1/)
assert.match(
  allocate,
  /new.created_at := greatest\(clock_timestamp\(\),target.created_at,target.last_message_at \+ interval '1 microsecond'\)/
)
assert.match(allocate, /elsif new.type = 'image'/)
assert.match(allocate, /submission.client_message_id <> new.client_message_id/)
assert.match(
  allocate,
  /perform marketplace_private.assert_image_objects\(submission\)/
)
assert.match(
  allocate,
  /new.content := marketplace_private.trim_message_text\(new.content\)/
)

const finalize = fn('public.marketplace_finalize_image_message')
assert(
  finalize.indexOf("submission.state = 'finalized'") <
    finalize.indexOf('insert into public.messages')
)
assert.match(
  finalize,
  /select \* into result from public.messages m where m.id = submission.id/
)
assert(
  finalize.indexOf('assert_image_objects') <
    finalize.indexOf('insert into public.messages')
)
assert.match(finalize, /'image',null,jsonb_array_length\(submission.manifest\)/)
assert.match(finalize, /insert into public.message_images/)
assert.match(finalize, /set state = 'finalized'/)
const count = fn('marketplace_private.check_message_image_manifest')
assert.match(count, /parent.type = 'text' and amount <> 0/)
assert.match(count, /amount <> parent.image_count/)
assert.match(count, /first_slot is distinct from 1::smallint/)
assert.match(count, /last_slot is distinct from parent.image_count/)
assert.equal((sql.match(/deferrable initially deferred/g) || []).length, 2)
const immutable = fn('marketplace_private.guard_message_image')
assert.match(immutable, /tg_op = 'delete' and not exists/)
assert.match(immutable, /sent image records are immutable/)
assert.match(immutable, /submission.state <> 'pending'/)

for (const operation of ['read', 'insert', 'delete', 'update'])
  assert.match(
    sql,
    new RegExp(
      `chat_images_no_client_${operation} on storage.objects as restrictive`
    )
  )
for (const table of [
  'public.image_message_submissions',
  'public.message_images',
  'marketplace_private.chat_image_cleanup',
])
  assert(sql.includes(`alter table ${table} enable row level security`))
assert.match(
  sql,
  /grant select on public.image_message_submissions, public.message_images to authenticated/
)
assert.doesNotMatch(
  sql,
  /grant (insert|update|delete|all)[\s\S]*?to authenticated/
)
assert.match(
  sql,
  /image_submissions_author_read[\s\S]*?sender_id = \(select auth.uid\(\)\)/
)
assert.match(sql, /message_images_participant_read[\s\S]*?from public.messages/)
const declarations = [
  ...sql.matchAll(/create(?: or replace)? function ([\w.]+)\(/g),
]
for (const declaration of declarations) {
  const body = fn(declaration[1])
  assert.match(body, /security definer set search_path = ''/)
  const revokeAt = sql.lastIndexOf('revoke all on function')
  assert(
    sql.slice(sql.indexOf('revoke all on function')).includes(declaration[1]),
    'Function missing explicit revoke'
  )
  assert(revokeAt > declaration.index)
}
const abandon = fn('public.marketplace_abandon_image_message')
assert(
  abandon.indexOf("submission.state = 'finalized'") <
    abandon.indexOf("set state = 'abandoned'")
)
const queue = fn('marketplace_private.queue_conversation_chat_images')
assert.match(queue, /from public.message_images/)
assert.match(queue, /from public.image_message_submissions/)
assert.match(
  sql,
  /conversations_queue_chat_image_cleanup before delete on public.conversations/
)
assert.match(
  fn('public.marketplace_expire_image_submissions'),
  /limit p_limit for update skip locked/
)
const ack = fn('public.marketplace_ack_chat_image_cleanup')
assert.match(ack, /from public.message_images/)
assert.match(ack, /from storage.objects/)
assert.match(ack, /interval '10 minutes'/)
assert.match(
  sql,
  /marketplace_record_verified_chat_image\(uuid,uuid,uuid,uuid,text\),[\s\S]*?to service_role;/
)
console.log(
  'PASS STATIC Phase 2 IMAGE source contract: unchanged TEXT baseline, private bucket, reservations, verified receipts, atomic ordered manifests, nonce/sequence, immutable children, RLS/grants and cleanup. SQL NOT executed; hosted Storage/security/races remain unverified.'
)
