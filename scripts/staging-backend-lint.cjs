// Never falls back to the repository link (which may point to production).
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const {
  STAGING_REF,
  assertStagingEnvironment,
  assertStagingArguments,
} = require('./staging-target-guard.cjs')
const env = Object.fromEntries(
  fs
    .readFileSync('.env.staging.local', 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('=') && !line.startsWith('#'))
    .map((line) => {
      const i = line.indexOf('=')
      return [
        line.slice(0, i).trim(),
        line
          .slice(i + 1)
          .trim()
          .replace(/^['"]|['"]$/g, ''),
      ]
    })
)
assertStagingEnvironment(env)
if (process.argv.length !== 2) throw Error('No target overrides accepted')
const args = assertStagingArguments([
  'db',
  'lint',
  '--linked',
  '--project-ref',
  STAGING_REF,
  '--schema',
  'public,marketplace_private',
  '--level',
  'warning',
])
const bin = path.join(
  path.dirname(require.resolve('@supabase/cli-windows-x64/package.json')),
  'bin/supabase.exe'
)
const result = spawnSync(bin, args, {
  encoding: 'utf8',
  maxBuffer: 8 * 1024 * 1024,
})
if (result.error || result.status !== 0)
  throw Error('Explicit staging lint failed; connection diagnostics suppressed')
process.stdout.write(result.stdout)
