const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { guard, nonce } = require('../scripts/staging-demo.cjs')
const staging = 'pcaqxezdfxofysghssyo'
const production = 'yzvchumzyonegujucyqs'
const key = (ref, role) =>
  'fixture.' +
  Buffer.from(JSON.stringify({ ref, role })).toString('base64url') +
  '.fixture'
const info = { ref: staging, name: 'western-marketplace-staging' }
const keys = {
  publicKey: key(staging, 'anon'),
  secret: key(staging, 'service_role'),
}
guard(info, keys)
assert.throws(() => guard({ ...info, ref: production }, keys))
assert.throws(() => guard({ ...info, name: 'campus-marketplace' }, keys))
assert.throws(() =>
  guard(info, { ...keys, secret: key(production, 'service_role') })
)
assert.throws(() =>
  guard(info, { ...keys, publicKey: key(production, 'anon') })
)
assert.throws(() => guard(info, { ...keys, secret: key(staging, 'anon') }))
assert.throws(() => guard(info, { ...keys, secret: '' }))
assert.equal(nonce('same-retry'), nonce('same-retry'))
assert.notEqual(nonce('same-retry'), nonce('different-send'))
assert.match(
  nonce('same-retry'),
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/
)
const blocked = spawnSync(
  process.execPath,
  ['scripts/staging-demo.cjs', 'seed'],
  { env: { ...process.env, APP_ENV: 'production' }, encoding: 'utf8' }
)
assert.notEqual(blocked.status, 0)
assert.match(blocked.stderr, /Refusing inherited non-staging APP_ENV/)
console.log(
  'PASS demo project/name/key-role fences, production environment rejected before CLI/network, stable distinct message nonces (no hosted calls).'
)
