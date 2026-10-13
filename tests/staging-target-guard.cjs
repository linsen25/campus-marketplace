const assert = require('node:assert/strict')
const fs = require('node:fs')
const {
  STAGING_REF,
  assertStagingEnvironment,
  assertStagingArguments,
} = require('../scripts/staging-target-guard.cjs')
const production = 'yzvchumzyonegujucyqs'
assertStagingEnvironment({
  APP_ENV: 'staging',
  NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
})
for (const env of [
  {
    APP_ENV: 'staging',
    NEXT_PUBLIC_SUPABASE_URL: `https://${production}.supabase.co`,
  },
  {
    APP_ENV: 'production',
    NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
  },
  {},
])
  assert.throws(() => assertStagingEnvironment(env))
assertStagingArguments(['db', 'lint', '--linked', '--project-ref', STAGING_REF])
for (const args of [
  ['db', 'lint', '--linked'],
  ['db', 'lint', '--project-ref', production],
  ['db', 'lint', '--project-ref', STAGING_REF, '--project-ref', production],
  ['db', 'lint', `--project-ref=${production}`],
  ['db', 'lint', '--project-ref', STAGING_REF, '--db-url', 'not-used'],
])
  assert.throws(() => assertStagingArguments(args))
for (const file of [
  'scripts/staging-backend-candidate.cjs',
  'tests/backend-contract-staging.cjs',
  'tests/backend-deployed-staging.cjs',
]) {
  const source = fs.readFileSync(file, 'utf8')
  assert(source.includes("const ref = 'pcaqxezdfxofysghssyo'"))
  assert(
    source.includes("'--project-ref',") &&
      source.includes("assert.equal(env.APP_ENV, 'staging')")
  )
  assert(
    source.includes(
      'assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, `https://${ref}.supabase.co`)'
    )
  )
}
const candidate = fs.readFileSync(
  'scripts/staging-backend-candidate.cjs',
  'utf8'
)
assert(
  /replace\([\s\S]*?=>/.test(candidate),
  'Archival replacement must use a callback'
)
const sample =
  'begin; create function f() returns void as $$ begin end $$ language plpgsql; commit;'
const archivalCode = candidate.match(
  /const candidate = sql[\s\S]*?(?=\nquery\(candidate\))/
)?.[0]
assert(archivalCode, 'Actual archival expression must be found')
const archived = require('node:vm').runInNewContext(
  archivalCode + '\ncandidate',
  {
    sql: sample,
    version: '202610130999',
    name: 'local_archive_test',
  }
)
assert.equal(archived.split('$candidate_archive$')[1], sample)
assert(archived.includes('as $$ begin end $$'))
console.log(
  'Staging target guard: production/missing/override targets rejected locally; no network used'
)
