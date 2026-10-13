const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const files = []
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(file)
    else if (/\.(js|html)$/.test(file)) files.push(file)
  }
}
walk('tests/artifacts/backend-completion-build/static')
const failures = []
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8')
  if (/SUPABASE_SERVICE_ROLE_KEY|sb_secret_[A-Za-z0-9_-]{20,}/.test(source))
    failures.push({ file, kind: 'privileged-variable-or-key' })
  for (const token of source.match(
    /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g
  ) || []) {
    try {
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'))
      if (['service_role', 'authenticated'].includes(claims.role))
        failures.push({ file, kind: 'privileged-or-session-jwt' })
    } catch {
      /* Not a JWT. No values are logged. */
    }
  }
  if (source.includes('https://yzvchumzyonegujucyqs.supabase.co'))
    failures.push({ file, kind: 'production-endpoint' })
}
// Both project refs occur in the existing Realtime environment allowlist. A ref
// is public metadata; the compiled endpoint must instead be exactly staging.
const home = files.find((f) => /pages[\\/]home-/.test(f))
assert(
  home &&
    fs
      .readFileSync(home, 'utf8')
      .includes('https://pcaqxezdfxofysghssyo.supabase.co')
)
console.log(
  JSON.stringify({
    browserFiles: files.length,
    failures,
    stagingEndpointVerified: true,
  })
)
assert.equal(failures.length, 0)
