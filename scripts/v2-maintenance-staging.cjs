const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto')
const assert = require('node:assert/strict'),
  { spawnSync } = require('node:child_process')
const guard = require('./staging-target-guard.cjs')
function environment() {
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
  if (process.env.APP_ENV)
    assert.equal(
      process.env.APP_ENV,
      'staging',
      'Inherited environment must be staging'
    )
  if (process.env.NEXT_PUBLIC_SUPABASE_URL)
    assert.equal(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_URL,
      'Inherited project mismatch'
    )
  const claims = JSON.parse(
    Buffer.from(env.SUPABASE_SERVICE_ROLE_KEY.split('.')[1], 'base64url')
  )
  assert.equal(claims.ref, guard.STAGING_REF)
  assert.equal(claims.role, 'service_role')
  return env
}
function query(sql) {
  environment() // Check before CLI resolution or any network.
  const file = path.resolve(
    'tests/artifacts/v2-maintenance/operation-' + crypto.randomUUID() + '.sql'
  )
  assert.equal(spawnSync('git', ['check-ignore', file]).status, 0)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, sql)
  const bin = path.join(
    path.dirname(require.resolve('@supabase/cli-windows-x64/package.json')),
    'bin/supabase.exe'
  )
  try {
    const r = spawnSync(
      bin,
      guard.assertStagingArguments([
        'db',
        'query',
        '--linked',
        '--project-ref',
        guard.STAGING_REF,
        '--file',
        file,
        '--output',
        'json',
      ]),
      { encoding: 'utf8', windowsHide: true, maxBuffer: 24 * 1024 * 1024 }
    )
    if (r.status !== 0) {
      // Only PostgreSQL's first diagnostic line; strip values and never retain
      // connection/provider output or the SQL text (which can contain private data).
      let message =
        (r.stderr || '').match(/ERROR:[^\r\n]*/)?.[0] ||
        'CLI access/transport failure before SQL diagnostic'
      message = message.split(/\\n|\r|\n/)[0]
      for (const value of Object.values(environment()).filter(
        (v) => v.length > 12
      ))
        message = message.replaceAll(value, '[redacted]')
      message = message
        .replace(/eyJ[A-Za-z0-9_.-]+/g, '[redacted]')
        .replace(/https?:\/\/\S+/g, '[redacted]')
        .replace(/'[^']*'/g, "'[value]'")
      fs.writeFileSync(
        path.join(path.dirname(file), 'last-query-error.json'),
        JSON.stringify({ message })
      )
      throw Error(
        'Staging maintenance query failed; see ignored last-query-error.json'
      )
    }
    try {
      return require('./cli-json-result.cjs').parseRows(r.stdout)
    } catch (error) {
      fs.writeFileSync(
        path.join(path.dirname(file), 'last-query-error.json'),
        JSON.stringify({
          message: error.message,
          stdoutLength: r.stdout.length,
        })
      )
      throw error
    }
  } finally {
    fs.unlinkSync(file)
  }
}
const q = (v) =>
  "E'" + String(v).replaceAll('\\', '\\\\').replaceAll("'", "''") + "'"
function block(body) {
  let delimiter
  do {
    delimiter = '$maintenance_' + crypto.randomUUID().replaceAll('-', '') + '$'
  } while (body.includes(delimiter))
  return 'do ' + delimiter + body + delimiter + ';'
}
const ids = (vs) => {
  assert(vs.every((v) => /^[0-9a-f-]{36}$/.test(v)))
  return vs.length ? vs.map(q).join(',') : 'null'
}
const hash = (v) =>
  crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex')
module.exports = { environment, query, q, ids, hash, block }
