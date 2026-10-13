// Exact staging project, rollback-only candidate/deployed qualification.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const guard = require('../scripts/staging-target-guard.cjs')
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
guard.assertStagingEnvironment(env)
const bin = path.join(
  path.dirname(require.resolve('@supabase/cli-windows-x64/package.json')),
  'bin/supabase.exe'
)
const file = path.resolve('tests/artifacts/offer-revision-qualification.sql')
assert.equal(spawnSync('git', ['check-ignore', file]).status, 0)
assert(!fs.existsSync(file), 'Another qualification is active')
const names = [
  '202610130010_offer_revision_economics.sql',
  '202610130011_offer_revision_domain.sql',
  '202610130012_message_withdrawal.sql',
  '202610130013_offer_revision_guards.sql',
  '202610130014_offer_revision_lint.sql',
]
const candidates = process.argv.includes('--deployed')
  ? ''
  : (process.argv.includes('--followup') ? names.slice(-1) : names)
      .map((n) =>
        fs
          .readFileSync('supabase/migrations/' + n, 'utf8')
          .replace(/^.*?begin;/s, '')
          .replace(/commit;\s*$/, '')
      )
      .join('\n')
const foundation = fs
  .readFileSync('tests/delivery-area-economics-staging.sql', 'utf8')
  .split('do $$declare terms jsonb;')[0]
const sql =
  'begin;\n' +
  candidates +
  '\n' +
  foundation +
  '\n' +
  fs.readFileSync('tests/offer-revision-staging.sql', 'utf8') +
  '\nset constraints all immediate;rollback;'
fs.mkdirSync(path.dirname(file), { recursive: true })
fs.writeFileSync(file, sql)
try {
  const result = spawnSync(
    bin,
    guard.assertStagingArguments([
      'db',
      'query',
      '--linked',
      '--project-ref',
      guard.STAGING_REF,
      '--output',
      'json',
      '--file',
      file,
    ]),
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
  )
  if (result.status !== 0) {
    console.error(
      (result.stderr || '').match(/ERROR:[\s\S]*?(?:Try rerunning|$)/)?.[0] ||
        'Staging qualification failed; credentials suppressed'
    )
    process.exitCode = 1
  } else
    console.log(
      JSON.stringify({
        project: guard.STAGING_REF,
        passed: true,
        allFixturesRolledBack: true,
        mode: process.argv.includes('--deployed') ? 'deployed' : 'candidate',
      })
    )
} finally {
  fs.unlinkSync(file)
}
