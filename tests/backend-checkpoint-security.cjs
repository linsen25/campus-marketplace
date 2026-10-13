// Local checkpoint audit; never connects to a database or prints secret values.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const git = (args) => {
  const result = spawnSync('git', args, { encoding: 'utf8' })
  assert.equal(result.status, 0, 'Git audit command failed')
  return result.stdout
}
const eligible = [
  ...new Set(
    git(['ls-files', '-c', '-o', '--exclude-standard', '-z'])
      .split('\0')
      .filter(Boolean)
  ),
]
// This tracked legacy cache is explicitly scheduled for removal from the index.
const files = eligible.filter(
  (file) => file !== 'tsconfig.tsbuildinfo' && fs.existsSync(file)
)
assert.equal(
  spawnSync('git', ['check-ignore', '--no-index', 'tsconfig.tsbuildinfo'])
    .status,
  0
)
const forbidden = files.filter(
  (file) =>
    file !== '.env.sample' &&
    /(^|\/)\.env(?:\.|$)|pgpass|__auth-rollout-smoke|__phase|tests\/artifacts\/|ProductionBackups|\.(?:dump|backup|tsbuildinfo)$/i.test(
      file
    )
)
assert.deepEqual(forbidden, [], 'Prohibited commit-eligible file')
const privateValues = []
for (const file of ['.env.local', '.env.staging.local']) {
  if (!fs.existsSync(file)) continue
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.+)$/)
    if (match && /SERVICE_ROLE|PASSWORD|ACCESS_TOKEN|SECRET/.test(match[1])) {
      const value = match[2].trim().replace(/^['"]|['"]$/g, '')
      if (value.length > 12) privateValues.push(value)
    }
  }
}
function safeFile(file) {
  const bytes = fs.readFileSync(file)
  for (const value of privateValues)
    assert(
      !bytes.includes(Buffer.from(value)),
      'Private value found; value suppressed'
    )
  const text = bytes.toString()
  assert(
    !/sbp_[a-f0-9]{40}|sb_secret_[A-Za-z0-9_-]{20,}/i.test(text),
    'Privileged token found; value suppressed'
  )
  for (const token of text.match(
    /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g
  ) || []) {
    let claims
    try {
      claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'))
    } catch {
      continue
    }
    assert(
      !['service_role', 'authenticated'].includes(claims.role),
      'Privileged/session JWT found; value suppressed'
    )
  }
}
files.forEach(safeFile)
let links = 0
for (const file of files.filter((file) => file.endsWith('.md'))) {
  for (const match of fs
    .readFileSync(file, 'utf8')
    .matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = match[1].replace(/^<|>$/g, '').split('#')[0]
    if (!target || /^(https?:|mailto:|app:|plugin:|\/|[A-Za-z]:)/.test(target))
      continue
    target = decodeURIComponent(target)
    assert(
      fs.existsSync(path.resolve(path.dirname(file), target)),
      'Broken documentation link: ' + file + ' -> ' + target
    )
    links++
  }
}
const report =
  fs.readFileSync('docs/BACKEND_COMPLETION_STAGING.md', 'utf8') +
  fs.readFileSync('docs/V2_OFFER_AGREEMENT_REVISION.md', 'utf8')
const migrations = fs
  .readdirSync('supabase/migrations')
  .filter((file) => file.startsWith('20261013'))
  .sort()
assert.equal(migrations.length, 17)
for (const file of migrations) {
  const bytes = fs.readFileSync('supabase/migrations/' + file)
  const hash = crypto.createHash('sha256').update(bytes).digest('hex')
  assert(
    report
      .split(/\r?\n/)
      .some(
        (line) =>
          line.includes('`' + file + '`') && line.includes('`' + hash + '`')
      ),
    'Migration report/hash mismatch: ' + file
  )
}
assert.equal(
  git(['diff', '--name-only', '--', 'supabase/migrations']).trim(),
  '',
  'Previously tracked migration modified'
)
assert.equal(
  spawnSync('git', ['diff', '--check'], { encoding: 'utf8' }).status,
  0
)
const counts = {}
const changes = git(['status', '--porcelain', '-uall'])
  .trimEnd()
  .split(/\r?\n/)
  .filter(Boolean)
for (const line of changes) {
  const file = line.slice(3).replace(/^"|"$/g, '')
  const category = file.includes('/') ? file.split('/')[0] : 'root/config'
  counts[category] = (counts[category] || 0) + 1
}
console.log(
  JSON.stringify({
    eligibleFilesScanned: files.length,
    localDocumentationLinks: links,
    migrationHashesMatched: migrations.length,
    privilegedValuesFound: 0,
    prohibitedFilesEligible: 0,
    generatedCacheExcluded: true,
    changedFileCategories: counts,
    diffCheck: true,
  })
)
