// Exact staging Management API target with an isolated ignored CLI link.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { spawnSync, spawn } = require('node:child_process')
const { parseRows } = require('../scripts/cli-json-result.cjs')
const ref = 'pcaqxezdfxofysghssyo'
const root = path.resolve('tests/artifacts/order-master-staging')
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
assert.equal(spawnSync('git', ['check-ignore', root + '/probe']).status, 0)
fs.mkdirSync(path.join(root, 'supabase', '.temp'), { recursive: true })
fs.writeFileSync(path.join(root, 'supabase', '.temp', 'project-ref'), ref)
const bin = path.join(
  path.dirname(require.resolve('@supabase/cli-windows-x64/package.json')),
  'bin/supabase.exe'
)
const q = (value) => "'" + String(value).replaceAll("'", "''") + "'"
function query(sql) {
  const file = path.join(root, crypto.randomUUID() + '.sql')
  fs.writeFileSync(file, sql)
  return new Promise((resolve, reject) => {
    const child = spawn(
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
        file,
        '--output',
        'json',
      ],
      { windowsHide: true }
    )
    let stdout = '',
      stderr = ''
    child.stdout.on('data', (data) => {
      stdout += data
    })
    child.stderr.on('data', (data) => {
      stderr += data
    })
    const fail = (code) => {
      const categories = [
        'syntax error',
        'does not exist',
        'violates check constraint',
        'violates foreign key constraint',
        'permission denied',
        'column reference',
        'ambiguous',
        'already exists',
        'invalid input syntax',
        'query canceled',
        'deadlock detected',
        'lock timeout',
      ].filter((category) => stderr.toLowerCase().includes(category))
      // Only CLI/domain error headlines, never SQL context or row payloads.
      const headlines = stderr
        .split(/\r?\n/)
        .filter((line) =>
          /^(Error:|error:|failed to|unexpected|ERROR:)/i.test(line)
        )
        .map((line) => {
          let value = line
          for (const secret of Object.values(env))
            if (secret.length > 12)
              value = value.split(secret).join('[redacted]')
          return value
            .replace(
              /(?:https?|postgres(?:ql)?):\/\/\S+|eyJ[A-Za-z0-9_.-]+|sbp_[A-Za-z0-9_]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g,
              '[redacted]'
            )
            .slice(0, 200)
        })
      fs.writeFileSync(
        file + '.diagnostic.json',
        JSON.stringify({
          code,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
          categories,
          headlines,
          sqlstate: stderr.match(/SQLSTATE\s+([A-Z0-9]{5})/)?.[1] || null,
        })
      )
      reject(
        Error(
          'Explicit staging SQL failed (' +
            categories.join(', ') +
            '); sanitized ignored diagnostic retained'
        )
      )
    }
    child.on('error', () => {
      fs.unlinkSync(file)
      fail('launch')
    })
    child.on('close', (code) => {
      if (fs.existsSync(file)) fs.unlinkSync(file)
      if (code) return fail(code)
      try {
        resolve(parseRows(stdout))
      } catch {
        fail('json')
      }
    })
  })
}
module.exports = { query, q, root, ref }
