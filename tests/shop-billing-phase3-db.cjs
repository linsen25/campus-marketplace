const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('PG'))
)
const bin = (name) =>
  path.join(
    process.env.PG_BIN || 'C:/pgsql/bin',
    name + (process.platform === 'win32' ? '.exe' : '')
  )
const run = (name, args, input) => {
  const result = spawnSync(bin(name), args, {
    input,
    env,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
  })
  assert.equal(
    result.status,
    0,
    `${name}: ${result.stderr || result.error?.message}`
  )
  return result.stdout
}

async function main() {
  const port = await new Promise((resolve) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const value = server.address().port
      server.close(() => resolve(value))
    })
  })
  const folder = fs.mkdtempSync(
    path.join(root, 'tests/artifacts/shop-billing-phase3-db-')
  )
  const data = path.join(folder, 'data')
  let started = false
  const args = [
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    '-h',
    '127.0.0.1',
    '-p',
    String(port),
    '-U',
    'billing_test',
    '-d',
    'postgres',
    '-At',
  ]
  try {
    run('initdb', [
      '-D',
      data,
      '-U',
      'billing_test',
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
      'start',
    ])
    started = true
    const sql = (text) => run('psql', args, text)
    sql(
      `create schema extensions; create extension if not exists pgcrypto with schema extensions; create schema auth; create schema marketplace_private; create role anon noinherit; create role authenticated noinherit; create role service_role bypassrls; create table auth.users(id uuid primary key); create table public.shops(id uuid primary key,owner_id uuid unique not null); create table marketplace_private.shop_memberships(owner_id uuid primary key references auth.users(id),revision bigint not null default 0); insert into auth.users values('10000000-0000-4000-8000-000000000001'),('20000000-0000-4000-8000-000000000002'); insert into public.shops values('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001'); insert into marketplace_private.shop_memberships values('10000000-0000-4000-8000-000000000001',4);`
    )
    sql(
      fs.readFileSync(
        path.join(
          root,
          'supabase/migrations/20261117160034_shop_billing_security_foundation.sql'
        ),
        'utf8'
      )
    )
    sql(
      fs.readFileSync(
        path.join(
          root,
          'supabase/migrations/20261117161641_shop_billing_checkout_command.sql'
        ),
        'utf8'
      )
    )
    const output = sql(`
      create function public.p3_reject(statement text, code text) returns void language plpgsql as $$ begin begin execute statement; exception when others then if sqlstate=code then return; end if; raise; end; raise exception 'unexpected success'; end $$;
      set role service_role;
      select public.marketplace_shop_billing_checkout_command('prepare','10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000004','acct_test','{"tier":"plus","membershipRevision":4}');
      select public.marketplace_shop_billing_checkout_command('prepare','10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000004','acct_test','{"tier":"plus","membershipRevision":4}');
      select public.p3_reject($q$select public.marketplace_shop_billing_checkout_command('prepare','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000005','acct_test','{"tier":"pro","membershipRevision":3}')$q$,'40001');
      select public.p3_reject($q$select public.marketplace_shop_billing_checkout_command('prepare','20000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000006','acct_test','{"tier":"pro","membershipRevision":0}')$q$,'42501');
      reset role;
      set role authenticated;
      select public.p3_reject($q$select public.marketplace_shop_billing_checkout_command('prepare','10000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000007','acct_test','{"tier":"plus","membershipRevision":4}')$q$,'42501');
      reset role;
    `)
    assert.equal((output.match(/prepared/g) || []).length, 2)
    console.log(
      'PASS isolated Billing Phase 3 PostgreSQL: service-only checkout command, owner/revision validation, and idempotent preparation.'
    )
  } finally {
    if (started)
      run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', '-t', '5', 'stop'])
    fs.rmSync(folder, { recursive: true, force: true })
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
