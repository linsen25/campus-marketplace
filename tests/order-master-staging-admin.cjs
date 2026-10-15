const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { query, q, root, ref } = require('./order-master-staging-query.cjs')
const files = [
  '202610140001_campus_payment_before_inspection.sql',
  '202610140002_order_cancellation_settlement.sql',
]
const mode = process.argv[2]
assert(['dry-run', 'apply', 'verify'].includes(mode))
const contents = files.map((file) =>
  fs.readFileSync('supabase/migrations/' + file, 'utf8')
)
const hashes = contents.map((sql) =>
  crypto.createHash('sha256').update(sql).digest('hex')
)
const linkBefore = fs.readFileSync('supabase/.temp/project-ref', 'utf8')
const fingerprint = () =>
  query(
    'begin read only;' +
      [
        'public.listings',
        'public.order_requests',
        'public.orders',
        'public.transaction_events',
      ]
        .map(
          (table) =>
            `select ${q(
              table
            )} name,count(*) n,md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) hash from ${table} t`
        )
        .join(' union all ') +
      ';rollback;'
  )
async function main() {
  const versions = (
    await query(
      'begin read only;select version from supabase_migrations.schema_migrations order by version;rollback;'
    )
  ).map((r) => r.version)
  if (mode !== 'verify') {
    const pending = fs
      .readdirSync('supabase/migrations')
      .filter((f) => f.endsWith('.sql') && !versions.includes(f.split('_')[0]))
      .sort()
    assert.deepEqual(
      pending,
      files,
      'Only the two qualified Master-flow candidates may apply'
    )
    const baseline = await fingerprint()
    let sql = contents
      .map((text) =>
        text.replace(/^([\s\S]*?)begin;/, '$1').replace(/commit;\s*$/, '')
      )
      .join('\n')
    if (mode === 'apply') {
      assert.deepEqual(
        JSON.parse(fs.readFileSync(path.join(root, 'dry-run.json'), 'utf8'))
          .hashes,
        hashes,
        'Candidate bytes changed after dry-run'
      )
      sql +=
        '\n' +
        files
          .map(
            (file, i) =>
              `insert into supabase_migrations.schema_migrations(version,name,statements) values(${q(
                file.split('_')[0]
              )},${q(file.replace(/^\d+_|\.sql$/g, ''))},array[${q(
                contents[i]
              )}]);`
          )
          .join('\n')
    }
    await query(
      "begin;set local lock_timeout='15s';\n" +
        sql +
        (mode === 'apply' ? '\ncommit;' : '\nrollback;') +
        '\nselect true as complete;'
    )
    assert.deepEqual(
      await fingerprint(),
      baseline,
      'No historical transaction rows may change during schema application'
    )
    fs.writeFileSync(
      path.join(root, mode + '.json'),
      JSON.stringify({
        ref,
        files,
        hashes,
        transactionRowsUnchanged: true,
        at: new Date().toISOString(),
      })
    )
  } else {
    for (const file of files)
      assert.equal(versions.filter((v) => v === file.split('_')[0]).length, 1)
    const expected = new Map()
    for (const text of contents)
      for (const match of text.matchAll(
        /create (?:or replace )?function ([a-z_]+)\.([a-z_]+)\([\s\S]*?as \$\$([\s\S]*?)\$\$;/gi
      ))
        expected.set(match[1] + '.' + match[2], match[3].trim())
    const rows = await query(
      `begin read only;select n.nspname||'.'||p.proname name,p.prosrc source,p.prosecdef definer,p.proconfig config,r.rolname owner,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname||'.'||p.proname in(${[
        ...expected.keys(),
      ]
        .map(q)
        .join(',')});rollback;`
    )
    assert.equal(rows.length, expected.size)
    for (const row of rows) {
      assert.equal(
        row.source.trim(),
        expected.get(row.name),
        row.name + ' deployed body'
      )
      assert.equal(row.owner, 'postgres')
      assert.equal(row.definer, true)
      assert.equal(row.anon, false)
      assert(row.config.some((c) => c.startsWith('search_path=')))
      if (row.name.startsWith('marketplace_private.'))
        assert.equal(row.authenticated, false)
    }
  }
  assert.equal(
    fs.readFileSync('supabase/.temp/project-ref', 'utf8'),
    linkBefore,
    'Main cached project link unchanged'
  )
  console.log(
    JSON.stringify({
      mode,
      ref,
      files,
      hashes,
      passed: true,
      ...(mode !== 'verify' ? { historicalRowsUnchanged: true } : {}),
    })
  )
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
