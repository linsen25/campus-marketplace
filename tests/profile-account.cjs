const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

class ListingApiError extends Error {
  constructor(message, status) { super(message); this.status = status }
}
const source = ts.transpileModule(fs.readFileSync('pages/api/profile/account.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText
const calls = []
let denied = false
const client = { from: table => { calls.push(['from', table]); return {
  select: fields => { calls.push(['select', fields]); return {
    eq: (key, id) => { calls.push(['eq', key, id]); return {
      single: async () => ({ data: { username: 'CampusMember' }, error: null }),
    } },
  } },
} } }
const moduleExports = { exports: {} }
const dependencies = {
  '@/lib/listing-validation': { ListingApiError },
  '@/lib/server/marketplace-auth': { requireMarketplaceUser: async value => {
    assert.equal(value, client)
    if (denied) throw new ListingApiError('Log in with your Western email to continue.', 401)
    return { id: 'authenticated-owner', email: 'member@uwo.ca', email_confirmed_at: '2026-10-04', created_at: '2026-10-01', secret: 'must-not-return' }
  } },
  '@/lib/supabase/server': { createMarketplaceClient: () => client },
}
new Function('require', 'exports', source)(name => dependencies[name], moduleExports.exports)
const handler = moduleExports.exports.default
const response = () => ({
  headers: {}, setHeader(key, value) { this.headers[key] = value },
  status(code) { this.code = code; return this }, json(body) { this.body = body; return this },
})
;(async () => {
  let res = response()
  await handler({ method: 'GET' }, res)
  assert.equal(res.code, 200)
  assert.deepEqual(res.body, { username: 'CampusMember', email: 'member@uwo.ca', emailVerified: true, createdAt: '2026-10-01', nextUsernameChangeAt: null })
  assert.deepEqual(calls, [['from', 'profiles'], ['select', 'username'], ['eq', 'id', 'authenticated-owner']])
  assert.equal(res.headers['Cache-Control'], 'private, no-store')
  denied = true
  calls.length = 0
  res = response()
  await handler({ method: 'GET' }, res)
  assert.equal(res.code, 401)
  assert.deepEqual(calls, [], 'Unauthenticated requests cannot read a profile')
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    res = response()
    await handler({ method }, res)
    assert.equal(res.code, 405)
    assert.equal(res.headers.Allow, 'GET')
    assert.deepEqual(calls, [], 'No mutation capability introduced')
  }
  console.log('PASS own-account GET: verified-user gate reused, own UUID only, username/email only, no-store, unauthorized rejection, all mutations rejected')
})().catch(error => { console.error(error); process.exitCode = 1 })
