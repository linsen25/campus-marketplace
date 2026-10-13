const fs = require('node:fs')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const sql = fs.readFileSync(
  'supabase/migrations/202610110004_offer_protocol_isolation.sql',
  'utf8'
)
assert(/begin;[\s\S]*commit;\s*$/.test(sql))
for (const field of [
  'protocol_version',
  'sender_user_id',
  'recipient_user_id',
]) {
  assert(sql.includes(`add column ${field}`))
  assert(
    sql.indexOf(`add column ${field}`) <
      sql.indexOf('update public.order_requests set protocol_version=1')
  )
  assert(
    sql.indexOf('update public.order_requests set protocol_version=1') <
      sql.indexOf(`alter column ${field} set not null`)
  )
}
assert(
  sql.includes(
    'sender_user_id=seller_origin_id,recipient_user_id=buyer_origin_id'
  )
)
assert(
  sql.includes(
    "if r.protocol_version<>1 then raise exception 'V1_PROTOCOL_REQUIRED'"
  )
)
assert(
  sql.includes(
    "if old_request.protocol_version<>1 then raise exception 'V1_PROTOCOL_REQUIRED'"
  )
)
assert(sql.includes('order_requests_conversation_one_active'))
assert(
  !/where status='active'.*protocol_version\s*=/.test(
    sql.split('\n').find((x) => x.startsWith('create unique index'))
  )
)
assert(sql.includes('values(1,new_id,c.id,l.id'))
assert(sql.includes('ACTIVE_PROPOSAL_PROTOCOL_CONFLICT'))
assert(sql.includes('if new.protocol_version<>1 then return new; end if;'))
assert(
  sql.includes("protocol_version=1 and status='active' and request_expires_at")
)
assert(sql.includes('where r.conversation_id=c.id and r.protocol_version=1'))
assert(sql.includes('r.id=e.request_id and r.protocol_version=1'))
assert(sql.includes("to_jsonb(new) - array['status'"))
assert(
  !/drop table|drop column|rename to|grant (insert|update|delete)|create function public\.marketplace_.*offer/i.test(
    sql
  )
)
// Immutable pre-A1 migration checksums; no ignored credentials/artifacts needed.
const old = [
  [
    'supabase/migrations/202610100001_order_requests.sql',
    '5fae29019242fe24af2491805d06dd513051311e25811306387d7b0788dd775f',
  ],
  [
    'supabase/migrations/202610100002_order_accept.sql',
    'b1473cc9ac9330e535e6a9eaa8efebd2f66c895d904bb13e3429a862c0f47d02',
  ],
  [
    'supabase/migrations/202610100003_financial_capabilities.sql',
    'ad437a1b2f40324c2bae4932dfc444027d525b757216352bbc694970ff921e6f',
  ],
  [
    'supabase/migrations/202610110001_order_payout_gate.sql',
    '9d3c8894cfcbe9c0c8a9ad5daa33936c26c5eb3ec7d4e6f8bef64c201b997294',
  ],
  [
    'supabase/migrations/202610110002_order_financial_state.sql',
    '2ccaecae40e39699ca5ade46dbe2fb92c79cbc638135189a7cccaf24c8758c92',
  ],
  [
    'supabase/migrations/202610110003_order_cancellation.sql',
    '43b98b5424874e54be4b9f8497e029afed9f06c395f9f5375b96ba03b5ae2992',
  ],
  [
    'supabase/migrations/202609290001_marketplace.sql',
    '3a5248cf90352c101a800d7ac8d68752562fb7d6fe31e29f6b9ad6f819ed1d8c',
  ],
  [
    'supabase/migrations/202610030001_marketplace_usernames.sql',
    '8d9c0b6f204e1aac645b8f6547be86471617c6c89aa6ad7a98c2b6d07fadaecf',
  ],
  [
    'supabase/migrations/202610040001_marketplace_taxonomy.sql',
    '1014e032d151f89f77c2d9c4280cfccb20f9ea310d3038b2f691410eb4bb75b3',
  ],
  [
    'supabase/migrations/202610050001_marketplace_publication_favorites.sql',
    'a015181a6ac26eb8910703dfb613d68c6e1339c515b223ccb3200c84ca4a1b46',
  ],
  [
    'supabase/migrations/202610070001_messages_text.sql',
    '2ee6cb35370c05cbc76d57fa78efd319cda24c1987cb8a5cbf5593121a3d4b7f',
  ],
  [
    'supabase/migrations/202610070002_messages_images.sql',
    'e9257f0b3121660a7db574c92cc23a557575910513e7220ae6fe60b4bc10ea18',
  ],
  [
    'supabase/migrations/202610080001_messages_realtime.sql',
    '5d16a4638eb2f2ac9f697e994f8a9ed9f91d9dd79034939426e8b8f55380499a',
  ],
  [
    'supabase/migrations/202610090001_auth_pending_username.sql',
    'e94bbdb229c65bd14bb55017fdd36e9e9a755f57dc53c2a8b6568e491a7c2c8d',
  ],
]
for (const [file, hash] of old)
  assert.equal(
    crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    hash,
    file
  )
console.log(
  'A1 static: additive backfill, hard guards, immutable identity, shared Active index, filtered V1 history, old migrations unchanged: PASS'
)
