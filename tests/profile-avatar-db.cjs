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
async function main() {
  const port = await new Promise((resolve) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => resolve(p))
    })
  })
  const folder = fs.mkdtempSync(path.resolve('tests/artifacts/avatar-db-'))
  const data = path.join(folder, 'data')
  let started = false
  try {
    run('initdb', [
      '-D',
      data,
      '-U',
      'avatar_test',
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
          'avatar_test',
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
      '202610030001_marketplace_usernames.sql',
      '202610090001_auth_pending_username.sql',
    ])
      sql(fs.readFileSync('supabase/migrations/' + file, 'utf8'))
    sql(
      `insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('33333333-3333-4333-8333-333333333333','legacy-avatar@uwo.ca',now(),'{"username":"B03Legacy"}');create table public.avatar_legacy_snapshot as select to_jsonb(p) data from public.profiles p where username='B03Legacy';`
    )
    sql(
      fs.readFileSync(
        'supabase/migrations/202610180002_profile_avatar_persistence.sql',
        'utf8'
      )
    )
    sql(fs.readFileSync('tests/profile-avatar-db.sql', 'utf8'))
    // Two genuine DB connections: a newer intent holds the owner lock while an
    // older upload tries to commit. It must recheck after waiting, not overwrite.
    const a = '11111111-1111-4111-8111-111111111111',
      old = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
      next = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6'
    sql(`set role service_role;select public.marketplace_prepare_profile_avatar('${a}','${old}','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',repeat('a',64),repeat('b',64),100);reset role;
    insert into storage.objects(bucket_id,name) values('profile-avatars','${a}/${old}.webp'),('profile-avatars','${a}/${next}.webp');`)
    const args = [
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-h',
      '127.0.0.1',
      '-p',
      String(port),
      '-U',
      'avatar_test',
      '-d',
      'postgres',
      '-At',
    ]
    const holder = spawn(bin('psql'), args, {
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const ready = new Promise((resolve, reject) => {
      let output = ''
      holder.stdout.on('data', (data) => {
        output += data
        if (output.includes('INTENT_READY')) resolve()
      })
      holder.on('error', reject)
      holder.on('exit', () => {
        if (!output.includes('INTENT_READY'))
          reject(Error('Local intent lock failed'))
      })
    })
    const holderDone = new Promise((resolve) => holder.on('exit', resolve))
    holder.stdin.write(
      `begin;set role service_role;select public.marketplace_prepare_profile_avatar('${a}','${next}','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',repeat('a',64),repeat('c',64),100);\n\\echo INTENT_READY\n`
    )
    await ready
    const older = spawn(bin('psql'), args, {
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let error = ''
    older.stderr.on('data', (data) => (error += data))
    const olderDone = new Promise((resolve) => older.on('exit', resolve))
    older.stdin.end(
      `set role service_role;select public.marketplace_commit_profile_avatar('${a}','${old}');`
    )
    holder.stdin.end('select pg_sleep(0.2);commit;\n\\q\n')
    assert.equal(await holderDone, 0)
    assert.equal(await olderDone, 3)
    assert.match(error, /newer avatar request/)
    sql(
      `set role service_role;select public.marketplace_commit_profile_avatar('${a}','${next}');reset role;select public.avatar_test_assert((select avatar_path='${a}/${next}.webp' from public.profiles where id='${a}'),'newer connection wins');`
    )
    console.log(
      'PASS PostgreSQL: actual migrations/Profile triggers, private bucket/RLS/ACL, own immutable intent, retries, two-connection concurrent replacement, failed upload, delayed/retryable cleanup, current-avatar protection, other-user isolation.'
    )
  } finally {
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'])
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
