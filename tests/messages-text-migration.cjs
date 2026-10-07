// STATIC source-contract inspection only. No PostgreSQL, Supabase or SQL execution.
// Passing does not prove SQL syntax, RLS behavior, FK cascades or concurrent transactions.
const assert = require('node:assert/strict')
const fs = require('node:fs')

const file = 'supabase/migrations/202610070001_messages_text.sql'
const source = fs.readFileSync(file, 'utf8')
const sql = source.replace(/--[^\n]*/g, '').toLowerCase()
const block = (start, end) => {
  const from = sql.indexOf(start)
  assert(from >= 0, 'Missing contract: ' + start)
  const to = sql.indexOf(end, from + start.length)
  assert(to > from, 'Missing end marker: ' + end)
  return sql.slice(from, to)
}
const functionBody = (name) => block('create function ' + name + '(', 'end; $$;')
const conversations = block('create table public.conversations (', 'create table public.messages (')
const messages = block('create table public.messages (', 'create index conversations_buyer_activity')
const find = functionBody('public.marketplace_find_or_create_conversation')
const send = functionBody('public.marketplace_send_text')
const read = functionBody('public.marketplace_mark_conversation_read')
const prepare = functionBody('marketplace_private.prepare_text_message')
const activity = functionBody('marketplace_private.apply_text_message_activity')
const guard = functionBody('marketplace_private.protect_conversation_identity')

assert.match(source, /NOT APPLIED or executed/)
assert.match(sql, /^\s*begin;/)
assert.match(sql, /commit;\s*$/)
assert.equal((sql.match(/create table /g) || []).length, 2)
for (const table of ['conversations', 'messages']) {
  assert(sql.includes('alter table public.' + table + ' enable row level security;'))
}
assert.match(conversations, /listing_origin_id uuid not null/)
assert.match(conversations, /listing_id uuid references public\.listings\(id\) on delete set null/)
assert(!/references public\.listings\(id\) on delete cascade/.test(conversations))
for (const role of ['buyer', 'seller']) {
  assert(conversations.includes(role + '_id uuid references public.profiles(id) on delete set null'))
  assert(conversations.includes(role + '_last_read_sequence between 0 and last_message_sequence'))
  assert(guard.includes('new.' + role + '_last_read_sequence < old.' + role + '_last_read_sequence'))
}
assert.match(conversations, /constraint conversations_identity unique \(listing_origin_id, buyer_id, seller_id\)/)
assert.match(conversations, /buyer_id <> seller_id/)
for (const field of ['title', 'price_cents', 'currency', 'category']) {
  assert(conversations.includes('listing_' + field + '_snapshot'))
  assert(guard.includes('new.listing_' + field + '_snapshot := source.' + field))
}
assert(guard.includes('new.buyer_id is distinct from auth.uid()'))
assert(guard.includes('new.seller_id is null'))
assert(guard.includes('source.seller_id is distinct from new.seller_id'))
assert(guard.includes('new.listing_origin_id is distinct from new.listing_id'))
assert(guard.includes('select 1 from public.listings'))
assert(guard.includes('select 1 from public.profiles'))
assert.match(sql, /conversations_updated before update[\s\S]*execute function marketplace_private\.touch_updated_at\(\)/)

assert.match(messages, /conversation_id uuid not null references public\.conversations\(id\) on delete cascade/)
assert.match(messages, /sender_id uuid not null,/)
assert(!messages.includes('references auth.users'))
for (const column of ['client_message_id uuid not null', 'sequence bigint not null', 'created_at timestamptz not null']) {
  assert(messages.includes(column))
}
assert.match(messages, /type in \('text', 'image'\)/)
assert.match(messages, /messages_text_phase_only check \(type = 'text'\)/)
assert.match(messages, /content text not null/)
assert.match(messages, /char_length\(content\) between 1 and 2000/)
assert(messages.includes('content = marketplace_private.trim_message_text(content)'))
assert(sql.includes("'^[[:space:]]+|[[:space:]]+$'"))
assert.match(messages, /unique \(conversation_id, sequence\)/)
assert.match(messages, /unique \(conversation_id, sender_id, client_message_id\)/)

for (const body of [find, send, read, prepare]) {
  assert(body.includes('auth.uid()'))
  assert(body.includes('is_western_user()'))
  assert(body.includes('security definer set search_path ='))
}
assert(find.includes('where l.id = p_listing_id for share'))
assert(find.includes("source.published_at is null or source.status <> 'available'"))
assert(find.includes('source.seller_id = actor'))
assert(find.includes('on conflict on constraint conversations_identity do nothing'))
assert(find.includes('source.id,source.id,actor,source.seller_id'))
assert(find.indexOf("source.status <> 'available'") < find.indexOf('insert into public.conversations'))

assert(send.includes('where c.id = p_conversation_id for update'))
assert(send.includes('target.buyer_id is distinct from actor and target.seller_id is distinct from actor'))
assert(send.includes('m.sender_id = actor and m.client_message_id = p_client_message_id'))
assert(send.includes('result.content is distinct from clean'))
assert(send.indexOf('return result;') < send.indexOf('insert into public.messages'))
assert(send.includes("values (target.id,actor,p_client_message_id,'text',clean)"))
assert(!send.includes('public.listings')) // Existing sold/deleted conversations remain sendable.
assert(!prepare.includes('public.listings'))
assert(prepare.includes('new.sender_id is distinct from actor'))
assert(prepare.includes('for update'))
assert(prepare.includes('new.sequence := target.last_message_sequence + 1'))
assert(prepare.includes('new.created_at := greatest(clock_timestamp()'))
assert(prepare.includes("target.last_message_at + interval '1 microsecond'"))
assert(prepare.includes("new.type is distinct from 'text'"))
assert(prepare.includes('char_length(new.content) not between 1 and 2000'))
assert(activity.includes('last_message_sequence = new.sequence'))
assert(activity.includes('last_message_at = new.created_at'))
for (const role of ['buyer', 'seller']) {
  assert(activity.includes('case when c.' + role + '_id = new.sender_id'))
  assert(activity.includes('greatest(c.' + role + '_last_read_sequence, new.sequence)'))
  assert(read.includes('greatest(target.' + role + '_last_read_sequence, p_through_sequence)'))
}
assert(read.includes('p_through_sequence > target.last_message_sequence'))
assert(read.includes('m.sequence = p_through_sequence'))
assert(read.includes('m.sequence > watermark and m.sender_id <> actor'))
assert(!read.includes('set last_message_at'))

const policies = sql.match(/create policy[\s\S]*?;/g) || []
assert.equal(policies.length, 2)
assert(policies.every(p => p.includes('for select to authenticated')))
assert(policies[0].includes('buyer_id = (select auth.uid()) or seller_id = (select auth.uid())'))
assert(policies[1].includes('from public.conversations c where c.id = conversation_id'))
assert(sql.includes('revoke all on public.conversations, public.messages from public, anon, authenticated'))
assert(sql.includes('grant select on public.conversations, public.messages to authenticated'))
assert(!/grant\s+(insert|update|delete|all)\b/.test(sql))
assert(sql.includes('messages_immutable before update or delete'))
assert(sql.includes("raise exception 'sent messages are immutable.'"))
assert(sql.includes('revoke all on function public.marketplace_find_or_create_conversation(uuid)'))
assert(sql.includes('grant execute on function public.marketplace_find_or_create_conversation(uuid)'))
assert.equal((sql.match(/security definer set search_path = ''/g) || []).length, 7)
assert(!sql.includes('execute immediate'))
for (const index of ['conversations_buyer_activity', 'conversations_seller_activity', 'conversations_live_listing', 'messages_history']) {
  assert(sql.includes('create index ' + index))
}
assert(!/create (table public\.message_images|policy[^;]*storage\.objects)|insert into storage\.|alter publication/.test(sql))
console.log('PASS STATIC Messages TEXT migration contract: tables/FKs/identity, TEXT checks, locks/idempotency, watermarks, RLS/grants, immutable messages, indexes and hardened RPC source. SQL NOT executed; runtime/concurrency behavior NOT proven.')
