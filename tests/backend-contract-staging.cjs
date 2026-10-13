// Exact staging-only, disposable SQL qualification. Candidate DDL and fixtures roll back.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const ref = 'pcaqxezdfxofysghssyo'
const [filename, fixture] = process.argv.slice(2)
assert(/^20261013\d{4}_[a-z_]+\.sql$/.test(filename))
assert(/^[a-z-]+\.sql$/.test(fixture))
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
const bin = path.join(
  path.dirname(require.resolve('@supabase/cli-windows-x64/package.json')),
  'bin/supabase.exe'
)
function query(sql) {
  const file = path.resolve(
    'tests/artifacts/backend-contract-qualification.sql'
  )
  assert.equal(spawnSync('git', ['check-ignore', file]).status, 0)
  assert(!fs.existsSync(file), 'Do not overwrite another qualification')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, sql)
  let r
  try {
    r = spawnSync(
      bin,
      [
        'db',
        'query',
        '--linked',
        '--project-ref',
        ref,
        '--output',
        'json',
        '--file',
        file,
      ],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
    )
  } finally {
    fs.unlinkSync(file)
  }
  if (r.error) throw Error('Staging qualification process failed')
  if (r.status) {
    console.error(
      (r.stderr || '').match(/ERROR:[\s\S]*?(?:Try rerunning|$)/)?.[0] ||
        'Staging qualification failed; connection diagnostics suppressed'
    )
    process.exit(1)
  }
  return JSON.parse(r.stdout).rows
}
const applied =
  query(
    `begin read only;select count(*) n from supabase_migrations.schema_migrations where version='${filename.slice(
      0,
      12
    )}';rollback;`
  )[0].n === 1
const migration = fs.readFileSync('supabase/migrations/' + filename, 'utf8')
assert(/commit;\s*$/.test(migration))
const prefix = applied
  ? 'begin;'
  : migration.slice(migration.indexOf('begin;')).replace(/commit;\s*$/, '')
const foundation = ![
  'delivery-area-economics-staging.sql',
  'notifications-domain-staging.sql',
].includes(fixture)
  ? fs.readFileSync('tests/delivery-area-economics-staging.sql', 'utf8')
  : ''
const handoff = [
  'courier-possession-staging.sql',
  'notifications-due-work-staging.sql',
].includes(fixture)
  ? fs.readFileSync('tests/handoff-protection-staging.sql', 'utf8')
  : ''
query(
  prefix +
    '\n' +
    foundation +
    '\n' +
    handoff +
    '\n' +
    fs.readFileSync('tests/' + fixture, 'utf8') +
    '\nset constraints all immediate;rollback;'
)
console.log(
  JSON.stringify({
    fixture,
    candidate: filename,
    mode: applied ? 'deployed' : 'candidate',
    passed: true,
    allFixturesRolledBack: true,
  })
)
