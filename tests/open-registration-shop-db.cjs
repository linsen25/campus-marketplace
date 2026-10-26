// Local-only contract test for the two open-registration / Shop approval migrations.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const bin = (name) =>
  path.join(process.env.PG_BIN || 'C:/pgsql/bin', `${name}.exe`)
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith('PG'))
)
function run(name, args, input) {
  const r = spawnSync(bin(name), args, {
    input,
    env,
    encoding: 'utf8',
    windowsHide: true,
    ...(name === 'pg_ctl' ? {} : {}),
  })
  if (r.status !== 0) {
    const detail = [r.stderr, r.stdout, r.error?.message]
      .filter(Boolean)
      .join('\n')
      .trim()
    throw new Error(`${name} failed: ${detail}`)
  }
  return (r.stdout || '').trim()
}

async function main() {
  const port = await new Promise((resolve) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const value = server.address().port
      server.close(() => resolve(value))
    })
  })
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'uu-open-registration-'))
  const data = path.join(folder, 'data')
  const args = [
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    '-h',
    '127.0.0.1',
    '-p',
    String(port),
    '-U',
    'uu_test',
    '-d',
    'postgres',
    '-At',
  ]
  let started = false
  try {
    run('initdb', [
      '-D',
      data,
      '-U',
      'uu_test',
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
    const sql = (text) => run('psql', args, text)
    sql(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema marketplace_private;
      create extension pgcrypto;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
      create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create table public.profiles(id uuid primary key references auth.users(id));
      create table public.listings(id uuid primary key,seller_id uuid not null,listing_channel text not null default 'resale');
      create table public.listing_favorites(user_id uuid not null,listing_id uuid not null);
      create policy profiles_owner_update on public.profiles for update to authenticated using (true) with check (true);
      create policy listings_owner_insert on public.listings for insert to authenticated with check (true);
      create policy listings_owner_update on public.listings for update to authenticated using (true) with check (true);
      create policy listings_owner_delete on public.listings for delete to authenticated using (true);
      create policy favorites_eligible_insert on public.listing_favorites for insert to authenticated with check (true);
      create policy favorites_own_read on public.listing_favorites for select to authenticated using (true);
      create policy favorites_own_delete on public.listing_favorites for delete to authenticated using (true);
      create function marketplace_private.is_western_user() returns boolean language sql stable as $$select false$$;
      grant usage on schema public, marketplace_private, auth to authenticated, service_role;
    `)
    sql(
      `\i '${path
        .join(
          root,
          'supabase/migrations/202610260001_open_registration_uwo_verification.sql'
        )
        .replaceAll('\\', '/')}'`
    )
    sql(
      `\i '${path
        .join(
          root,
          'supabase/migrations/202610260005_uwo_verification_delivery_contract.sql'
        )
        .replaceAll('\\', '/')}'`
    )
    sql(
      `\i '${path
        .join(
          root,
          'supabase/migrations/202610260002_verified_user_resale_and_shop_approval.sql'
        )
        .replaceAll('\\', '/')}'`
    )
    const fn = sql(
      `select count(*) from pg_proc where pronamespace='marketplace_private'::regnamespace and proname in ('is_verified_user','is_uwo_email_verified','is_shop_approved','review_shop_application');`
    )
    assert.equal(fn, '4')
    sql(
      `insert into auth.users values ('00000000-0000-0000-0000-000000000001','gmail@example.com',now()),('00000000-0000-0000-0000-000000000002','pending@example.com',null); insert into public.profiles values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');`
    )
    assert.equal(
      sql(
        `select marketplace_private.is_verified_user() from auth.users where id='00000000-0000-0000-0000-000000000001';`
      ),
      'f'
    )
    assert.equal(
      sql(
        `set role authenticated; set request.jwt.claims='{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}'; select marketplace_private.is_verified_user();`
      ),
      't'
    )
    assert.equal(
      sql(`select public.marketplace_request_shop_application();`),
      'pending'
    )
    assert.equal(
      sql(
        `select status from marketplace_private.shop_applications where owner_id='00000000-0000-0000-0000-000000000001';`
      ),
      'pending'
    )
    assert.throws(() =>
      sql(
        `select marketplace_private.review_shop_application('00000000-0000-0000-0000-000000000001','approved','00000000-0000-0000-0000-000000000003');`
      )
    )
    assert.equal(
      sql(`set role service_role;
        select marketplace_private.begin_uwo_email_verification(
          '00000000-0000-0000-0000-000000000001','student@uwo.ca',repeat('a',64),now()+interval '10 minutes');`),
      't'
    )
    assert.equal(
      sql(`set role service_role;
        select marketplace_private.begin_uwo_email_verification(
          '00000000-0000-0000-0000-000000000001','student@uwo.ca',repeat('b',64),now()+interval '10 minutes');`),
      'f'
    )
    assert.equal(
      sql(`set role service_role;
        select marketplace_private.complete_uwo_email_verification(
          '00000000-0000-0000-0000-000000000001',repeat('b',64));`),
      'f'
    )
    assert.equal(
      sql(`set role service_role;
        select marketplace_private.complete_uwo_email_verification(
          '00000000-0000-0000-0000-000000000001',repeat('a',64));`),
      't'
    )
    assert.equal(
      sql(`set role service_role;
        select marketplace_private.complete_uwo_email_verification(
          '00000000-0000-0000-0000-000000000001',repeat('a',64));`),
      'f'
    )
    console.log(
      'PASS open registration / verified-user / Shop application migration contract'
    )
  } finally {
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'])
    fs.rmSync(folder, { recursive: true, force: true })
  }
}
main().catch((error) => {
  console.error(error.stack || error)
  process.exitCode = 1
})
