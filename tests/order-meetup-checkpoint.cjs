const fs = require('fs'),
  path = require('path'),
  assert = require('assert/strict'),
  { spawnSync } = require('child_process')
const eligible = [
  ...new Set(
    spawnSync('git', ['ls-files', '-c', '-o', '--exclude-standard'], {
      encoding: 'utf8',
    })
      .stdout.trim()
      .split('\n')
  ),
]
assert.equal(spawnSync('git', ['diff', '--cached', '--quiet']).status, 0)
const forbidden = eligible.filter((f) =>
  /(^|\/)\.env\.(local|staging\.local)$|pgpass|__auth-rollout-smoke|__phase|tests\/artifacts\/|ProductionBackups|\.(dump|backup|pgpass)$/i.test(
    f
  )
)
assert.deepEqual(forbidden, [])
const secrets = []
for (const f of ['.env.local', '.env.staging.local'])
  if (fs.existsSync(f))
    for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = l.match(/^([^#=]+)=(.+)$/)
      if (m && /SERVICE_ROLE|PASSWORD|ACCESS_TOKEN|SECRET/.test(m[1])) {
        const v = m[2].trim().replace(/^['"]|['"]$/g, '')
        if (v.length > 12) secrets.push(v)
      }
    }
let scanned = 0
for (const f of eligible) {
  if (!fs.existsSync(f) || fs.statSync(f).size > 20000000) continue
  const b = fs.readFileSync(f)
  for (const s of secrets)
    assert(!b.includes(Buffer.from(s)), 'Privileged value in eligible file')
  const text = b.toString()
  assert(!/sbp_[a-f0-9]{40}/i.test(text), 'Access token in eligible file')
  for (const t of text.match(
    /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g
  ) || []) {
    try {
      const c = JSON.parse(Buffer.from(t.split('.')[1], 'base64url'))
      assert(
        !['service_role', 'authenticated'].includes(c.role),
        'Private JWT in eligible file'
      )
    } catch (e) {
      if (e.code === 'ERR_ASSERTION') throw e
    }
  }
  scanned++
}
let bundles = 0
function scan(d) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n)
    if (fs.statSync(p).isDirectory()) scan(p)
    else if (/\.(js|html)$/.test(p)) {
      const b = fs.readFileSync(p)
      for (const s of secrets)
        assert(!b.includes(Buffer.from(s)), 'Privileged browser value')
      assert(
        !b.includes(Buffer.from('SUPABASE_SERVICE_ROLE_KEY')),
        'Server key name in browser bundle'
      )
      for (const token of b
        .toString()
        .match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || []) {
        try {
          const claims = JSON.parse(
            Buffer.from(token.split('.')[1], 'base64url')
          )
          assert(
            !['service_role', 'authenticated'].includes(claims.role),
            'Private browser JWT'
          )
        } catch (failure) {
          if (failure.code === 'ERR_ASSERTION') throw failure
        }
      }
      bundles++
    }
  }
}
scan('tests/artifacts/offer-accept-c2-build/static')
let links = 0
for (const f of eligible.filter((f) => f.endsWith('.md') && fs.existsSync(f))) {
  for (const m of fs
    .readFileSync(f, 'utf8')
    .matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    let t = m[1].replace(/^<|>$/g, '').split('#')[0]
    if (!t || /^(https?:|mailto:|app:|plugin:|\/|[A-Za-z]:)/.test(t)) continue
    t = decodeURIComponent(t)
    assert(
      fs.existsSync(path.resolve(path.dirname(f), t)),
      'Broken local documentation link: ' + f + ' -> ' + t
    )
    links++
  }
}
assert.equal(
  spawnSync('git', ['diff', '--check'], { encoding: 'utf8' }).status,
  0
)
console.log(
  JSON.stringify({
    eligibleFilesScanned: scanned,
    browserBundlesScanned: bundles,
    localDocumentationLinks: links,
    privilegedValuesFound: 0,
    prohibitedFilesEligible: 0,
    indexEmpty: true,
    diffCheck: true,
  })
)
