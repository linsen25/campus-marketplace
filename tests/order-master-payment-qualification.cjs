// Candidate DDL plus disposable fixtures in ONE rolled-back staging transaction.
// No deployment, migration ledger write, committed fixtures, or canonical mutations.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { parseRows } = require('../scripts/cli-json-result.cjs')
const ref = 'pcaqxezdfxofysghssyo'
const settlement = process.argv[2] === 'settlement'
assert(!process.argv[2] || settlement, 'Unknown qualification mode')
const file = settlement
  ? 'supabase/migrations/202610140002_order_cancellation_settlement.sql'
  : 'supabase/migrations/202610140001_campus_payment_before_inspection.sql'
const env = Object.fromEntries(
  fs
    .readFileSync('.env.staging.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [
        l.slice(0, i).trim(),
        l
          .slice(i + 1)
          .trim()
          .replace(/^['"]|['"]$/g, ''),
      ]
    })
)
assert.equal(env.APP_ENV, 'staging')
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, `https://${ref}.supabase.co`)
const root = path.resolve('tests/artifacts/order-master-qualification')
assert.equal(spawnSync('git', ['check-ignore', root + '/probe']).status, 0)
fs.mkdirSync(root, { recursive: true })
// Never consult or rewrite the main repository's cached project link.
const isolatedLink = path.join(root, 'supabase', '.temp')
fs.mkdirSync(isolatedLink, { recursive: true })
fs.writeFileSync(path.join(isolatedLink, 'project-ref'), ref)
const sqlFile = path.join(root, 'candidate.sql')
const sql = fs.readFileSync(file, 'utf8')
assert(/begin;/.test(sql) && /commit;\s*$/.test(sql))
const helper = fs
  .readFileSync('tests/delivery-area-economics-staging.sql', 'utf8')
  .split('do $$declare terms jsonb;')[0]
assert(helper.includes('create function pg_temp.bc_accept'))
fs.writeFileSync(
  sqlFile,
  (settlement
    ? fs
        .readFileSync(
          'supabase/migrations/202610140001_campus_payment_before_inspection.sql',
          'utf8'
        )
        .replace(/commit;\s*$/, '') + '\n'
    : '') +
    sql
      .replace(/^([\s\S]*?)begin;/, settlement ? '$1' : '$&')
      .replace(/commit;\s*$/, '') +
    '\n' +
    helper +
    '\n' +
    fs.readFileSync(
      settlement
        ? 'tests/order-master-settlement-staging.sql'
        : 'tests/order-master-payment-staging.sql',
      'utf8'
    ) +
    '\nset constraints all immediate; rollback; select true as rolled_back;'
)
const bin = path.join(
  path.dirname(require.resolve('@supabase/cli-windows-x64/package.json')),
  'bin/supabase.exe'
)
try {
  const result = spawnSync(
    bin,
    [
      'db',
      'query',
      '--linked',
      '--project-ref',
      ref,
      '--workdir',
      root,
      '--file',
      sqlFile,
      '--output',
      'json',
    ],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 }
  )
  if (result.error || result.status !== 0) {
    const sqlstate =
      (result.stderr || '').match(/SQLSTATE\s+([A-Z0-9]{5})/)?.[1] || null
    const diagnostic = {
      exitCode: result.status,
      sqlstate,
      stdoutLength: (result.stdout || '').length,
      stderrLength: (result.stderr || '').length,
    }
    fs.writeFileSync(
      path.join(root, 'failure.json'),
      JSON.stringify(diagnostic)
    )
    throw Error(
      'Staging rollback qualification failed; sanitized ignored diagnostic retained'
    )
  }
  const rows = parseRows(result.stdout)
  assert(
    rows.some((r) => r.rolled_back === true),
    'Successful rollback receipt required'
  )
  console.log(
    JSON.stringify({
      candidate: path.basename(file),
      sha256: crypto.createHash('sha256').update(sql).digest('hex'),
      qualified: true,
      applied: false,
      fixturesRolledBack: true,
    })
  )
} finally {
  fs.unlinkSync(sqlFile)
}
