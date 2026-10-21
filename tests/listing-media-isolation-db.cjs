// Isolated native PostgreSQL, loopback only, no env files/Supabase CLI.
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith('PG'))
)
const bin = (name) =>
  path.join(
    process.env.PG_BIN || 'C:/pgsql/bin',
    name + (process.platform === 'win32' ? '.exe' : '')
  )
function run(name, args, input) {
  const r = spawnSync(bin(name), args, {
    input,
    env,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
  })
  assert.equal(r.status, 0, `${name}: ${r.stderr || r.error?.message}`)
  return r.stdout
}
function functionBody(sql, name) {
  sql = sql.replace(/\r\n/g, '\n')
  const start = sql.indexOf('function ' + name)
  return sql.slice(start, sql.indexOf('$$;', start) + 3)
}
const migration = fs.readFileSync(
  'supabase/migrations/202610190001_listing_image_isolation.sql',
  'utf8'
)
const oldSnapshot = fs.readFileSync(
  'supabase/migrations/202610120003_order_snapshot_media.sql',
  'utf8'
)
const newPrepare = functionBody(
  migration,
  'public.marketplace_prepare_order_media('
)
  .replace('source_path,source_bucket,position)', 'source_path,position)')
  .replace(
    "select b.id,(x->>'id')::uuid,x->>'path',i.storage_bucket,(x->>'slot')::smallint\n from jsonb_array_elements(m)x join public.listing_images i on i.id=(x->>'id')::uuid;",
    "select b.id,(x->>'id')::uuid,x->>'path',(x->>'slot')::smallint from jsonb_array_elements(m)x;"
  )
assert.equal(
  newPrepare,
  functionBody(oldSnapshot, 'public.marketplace_prepare_order_media('),
  'snapshot authority must differ only at frozen source bucket projection'
)
async function main() {
  const port = await new Promise((resolve) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => resolve(p))
    })
  })
  const folder = fs.mkdtempSync(
    path.resolve('tests/artifacts/listing-media-db-')
  )
  const data = path.join(folder, 'data')
  let started = false
  try {
    run('initdb', [
      '-D',
      data,
      '-U',
      'media_test',
      '--auth=trust',
      '--no-locale',
      '--encoding=UTF8',
    ])
    run('pg_ctl', [
      '-D',
      data,
      '-l',
      path.join(folder, 'postgres.log'),
      '-o',
      `-h 127.0.0.1 -p ${port}`,
      '-w',
      'start',
    ])
    started = true
    const sql = (text) =>
      run(
        'psql',
        [
          '-X',
          '-v',
          'ON_ERROR_STOP=1',
          '-h',
          '127.0.0.1',
          '-p',
          String(port),
          '-U',
          'media_test',
          '-d',
          'postgres',
          '-At',
        ],
        text
      )
    const fixture = fs
      .readFileSync('tests/marketplace-security.cjs', 'utf8')
      .match(/await db\.exec\(`([\s\S]*?)`\)/)[1]
    sql(
      fixture +
        '\ncreate role service_role bypassrls;alter table auth.users add column confirmation_token text;create table auth.one_time_tokens(user_id uuid,token_type text,token_hash text);'
    )
    for (const file of [
      '202609290001_marketplace.sql',
      '202610040001_marketplace_taxonomy.sql',
      '202610050001_marketplace_publication_favorites.sql',
      '202610160007_listing_channel_authority.sql',
    ])
      sql(fs.readFileSync('supabase/migrations/' + file, 'utf8'))
    sql(`create table public.order_requests(id uuid primary key,listing_id uuid,protocol_version integer,buyer_origin_id uuid,seller_origin_id uuid,status text);
      create table public.orders(id uuid primary key,request_id uuid,listing_id uuid,buyer_origin_id uuid,seller_origin_id uuid,buyer_id uuid,seller_id uuid);`)
    sql(
      fs.readFileSync(
        'supabase/migrations/202610120003_order_snapshot_media.sql',
        'utf8'
      )
    )
    sql(
      'grant insert(id) on public.listings,public.listing_images to authenticated;'
    )
    sql(fs.readFileSync('tests/listing-media-isolation-before.sql', 'utf8'))
    sql(
      fs.readFileSync(
        'supabase/migrations/202610190001_listing_image_isolation.sql',
        'utf8'
      )
    )
    sql(fs.readFileSync('tests/listing-media-isolation-db.sql', 'utf8'))
    const args = [
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-h',
      '127.0.0.1',
      '-p',
      String(port),
      '-U',
      'media_test',
      '-d',
      'postgres',
      '-At',
    ]
    const connection = () =>
      spawn(bin('psql'), args, {
        env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    const first = connection()
    let output = '',
      errors = ''
    const firstDone = new Promise((resolve) => first.on('exit', resolve))
    const locked = new Promise((resolve, reject) => {
      first.on('error', reject)
      first.stdout.on('data', (d) => {
        output += d
        if (output.includes('FINALIZE_LOCKED')) resolve()
      })
      first.on('exit', () => {
        if (!output.includes('FINALIZE_LOCKED'))
          reject(Error('Finalize lock not obtained'))
      })
    })
    first.stderr.on('data', (d) => {
      errors += d
    })
    const auth =
      "set role authenticated;set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';"
    const finalize =
      "select public.marketplace_finalize_listing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5');"
    first.stdin.write('begin;' + auth + finalize + '\n\\echo FINALIZE_LOCKED\n')
    await locked
    const second = connection()
    const secondDone = new Promise((resolve) => second.on('exit', resolve))
    second.stderr.on('data', (d) => {
      errors += d
    })
    second.stdout.resume()
    second.stdin.end(auth + finalize)
    first.stdin.end('select pg_sleep(0.2);commit;\n\\q\n')
    assert.equal(await firstDone, 0, errors)
    assert.equal(await secondDone, 0, errors)
    sql(
      "select public.media_assert((select count(*)=1 and bool_and(published_at is not null) from public.listings where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5'),'two-connection finalize one Listing');"
    )
    console.log(
      'PASS native PostgreSQL: forward migration, legacy invariance, private bucket, permissions, owner/anon/other RLS, immutable sources, manifest/finalize/Sold/Favorites, source-bucket snapshot and unchanged material hash'
    )
  } finally {
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'])
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
