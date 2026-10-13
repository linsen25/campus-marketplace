const fs = require('node:fs'),
  assert = require('node:assert/strict'),
  path = require('node:path'),
  ts = require('typescript'),
  crypto = require('node:crypto')
const file = 'supabase/migrations/202610110001_order_payout_gate.sql'
const sql = fs.readFileSync(file, 'utf8')
const functions = [
  'marketplace_private.mutate_order_request',
  'public.marketplace_accept_order_request',
  'public.marketplace_record_financial_capability',
]
function extract(s, n) {
  return s
    .match(
      new RegExp(
        'create (?:or replace )?function ' +
          n.replaceAll('.', '\\.') +
          '\\([\\s\\S]*?end; \\$\\$;'
      )
    )[0]
    .replace(/^create (?:or replace )?function/, 'create or replace function')
}
const previous = fs.readFileSync(
    'supabase/migrations/202610100002_order_accept.sql',
    'utf8'
  ),
  fin = fs.readFileSync(
    'supabase/migrations/202610100003_financial_capabilities.sql',
    'utf8'
  )
for (const n of functions) {
  const revised = extract(sql, n)
    .replace(
      "  if p_action in ('create','replace') then perform marketplace_private.require_seller_payout_ready(actor); end if;\n",
      ''
    )
    .replace(
      '  perform marketplace_private.require_seller_payout_ready(r.seller_id);\n',
      ''
    )
    .replace(
      ' perform marketplace_private.lock_financial_capability(p_user_id,p_capability);\n',
      ''
    )
  assert.equal(
    revised,
    extract(n.includes('financial') ? fin : previous, n),
    'Only expected function insertion allowed'
  )
}
assert(
  !/create table|alter table|add column|insert into public\.(profiles|listings)|update public\.order_requests set status='(?:cancelled|expired)'[^\n]*where true/i.test(
    sql
  )
)
assert(
  sql.includes("'marketplace:financial:'||p_user_id::text||':'||p_capability")
)
assert(sql.includes("current_status is distinct from 'ready'"))
assert(sql.includes("errcode='P0001'"))
assert(sql.includes('for update;'))
for (const n of functions.slice(0, 2)) {
  const s = extract(sql, n)
  assert(s.indexOf('return result;') < s.indexOf('require_seller_payout_ready'))
  assert(
    s.indexOf('require_seller_payout_ready') <
      s.indexOf('from public.listings where')
  )
}
for (const [f, h] of [
  [
    '202610100001_order_requests.sql',
    '5fae29019242fe24af2491805d06dd513051311e25811306387d7b0788dd775f',
  ],
  [
    '202610100002_order_accept.sql',
    'b1473cc9ac9330e535e6a9eaa8efebd2f66c895d904bb13e3429a862c0f47d02',
  ],
  [
    '202610100003_financial_capabilities.sql',
    'ad437a1b2f40324c2bae4932dfc444027d525b757216352bbc694970ff921e6f',
  ],
])
  assert.equal(
    crypto
      .createHash('sha256')
      .update(fs.readFileSync('supabase/migrations/' + f))
      .digest('hex'),
    h
  )
const cache = new Map(),
  actor = '11111111-1111-4111-8111-111111111111',
  other = '22222222-2222-4222-8222-222222222222'
let calls = [],
  error = { code: 'P0001', message: 'seller_payout_not_ready' }
const client = {
  rpc: async (name, args) => {
    calls.push({ name, args })
    return { data: null, error }
  },
}
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full)
  const m = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (n) => {
      if (n === '@/lib/supabase/server')
        return { createMarketplaceClient: () => client }
      if (n === '@/lib/server/marketplace-auth')
        return {
          requireMarketplaceUser: async () => ({ id: actor }),
          requireSameOriginWrite: () => {},
        }
      return n.startsWith('@/') ? load(n.slice(2) + '.ts') : require(n)
    },
    m,
    m.exports
  )
  cache.set(full, m.exports)
  return m.exports
}
const ref = 'pcaqxezdfxofysghssyo'
process.env.APP_ENV = 'staging'
process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${ref}.supabase.co`
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'e30.' +
  Buffer.from(JSON.stringify({ role: 'anon', ref })).toString('base64url') +
  '.test'
const handler = load('pages/api/order-requests/[[...segments]].ts').default
async function invoke(segments) {
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v
    },
    status(n) {
      this.statusCode = n
      return this
    },
    json(v) {
      this.data = v
      return this
    },
  }
  await handler(
    {
      method: 'POST',
      query: { segments },
      headers: {},
      body: {
        conversationId: actor,
        clientActionId: actor,
        terms: {},
        sellerId: other,
        payoutReady: true,
      },
    },
    res
  )
  return res
}
;(async () => {
  for (const segments of [[], [actor, 'replace'], [actor, 'accept']]) {
    calls = []
    const r = await invoke(segments)
    assert.equal(r.statusCode, 409)
    assert.equal(r.data.code, 'seller_payout_not_ready')
    assert(r.data.error.includes('seller needs to update'))
    assert(!JSON.stringify(r.data).includes('last4'))
    assert(!JSON.stringify(calls).includes(other))
    assert(!JSON.stringify(calls).includes('payoutReady'))
  }
  error = { code: 'P0001', message: 'provider_ref_sensitive' }
  const r = await invoke([])
  assert.equal(r.statusCode, 503)
  assert(!r.data.error.includes('sensitive'))
  console.log(
    'PASS minimal function changes, original hashes, lock/idempotency ordering, stable 409 domain error, safe API privacy and ignored client seller/readiness fields'
  )
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
