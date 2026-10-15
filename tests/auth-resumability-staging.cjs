// Authorized staging-only additive RPC deployment and rollback qualification.
const fs = require('node:fs')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { query, q, ref } = require('./order-master-staging-query.cjs')
const file = '202610140003_auth_pending_resumability.sql'
const sql = fs.readFileSync('supabase/migrations/' + file, 'utf8')
const sha256 = crypto.createHash('sha256').update(sql).digest('hex')
const fingerprint = () =>
  query(`begin read only;
select 'users' name, count(*) n, md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) hash from auth.users t
union all select 'profiles',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.profiles t
union all select 'controls',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'' order by user_id),'')) from marketplace_private.pending_signup_controls t;
rollback;`)
async function main() {
  const mode = process.argv[2]
  assert(['dry-run', 'apply', 'verify'].includes(mode))
  assert.equal(ref, 'pcaqxezdfxofysghssyo')
  const before = await fingerprint()
  const versions = (
    await query('select version from supabase_migrations.schema_migrations;')
  ).map((r) => r.version)
  if (mode !== 'verify') {
    assert.deepEqual(
      fs
        .readdirSync('supabase/migrations')
        .filter(
          (f) => f.endsWith('.sql') && !versions.includes(f.split('_')[0])
        ),
      [file]
    )
    const body = sql.replace(/\bbegin;/, '').replace(/commit;\s*$/, '')
    await query(
      'begin;' +
        body +
        (mode === 'apply'
          ? `insert into supabase_migrations.schema_migrations(version,name,statements) values('202610140003','auth_pending_resumability',array[${q(
              sql
            )}]);commit;`
          : 'rollback;') +
        'select true complete;'
    )
  }
  if (mode !== 'dry-run') {
    const grants = await query(`select p.prosecdef, p.provolatile, p.proconfig,
      pg_get_userbyid(p.proowner) owner,
      has_function_privilege('anon',p.oid,'EXECUTE') anon,
      has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,
      has_function_privilege('service_role',p.oid,'EXECUTE') service
      from pg_proc p where p.oid='public.marketplace_pending_signup_resumable(text)'::regprocedure;`)
    assert.equal(grants.length, 1)
    assert.equal(grants[0].prosecdef, true)
    assert.equal(grants[0].provolatile, 's')
    assert.equal(grants[0].owner, 'postgres')
    assert.equal(grants[0].anon, false)
    assert.equal(grants[0].authenticated, false)
    assert.equal(grants[0].service, true)
    assert.deepEqual(grants[0].proconfig, ['search_path=""'])
    await query(`begin;
    do $$ declare actor uuid := gen_random_uuid(); ticket text := encode(extensions.gen_random_bytes(32),'hex'); name text := 'AuthProbe_' || substr(replace(actor::text,'-',''),1,8); original jsonb; after_probe jsonb;
    begin
      insert into auth.users(id,email,raw_user_meta_data) values(actor,'authprobe_'||actor::text||'@uwo.ca',jsonb_build_object('username',name,'pending_signup_ticket',ticket));
      select jsonb_build_array(to_jsonb(u),to_jsonb(p),to_jsonb(s)) into original from auth.users u join public.profiles p on p.id=u.id join marketplace_private.pending_signup_controls s on s.user_id=u.id where u.id=actor;
      if not public.marketplace_pending_signup_resumable(ticket) then raise exception 'Valid pending proof rejected'; end if;
      if public.marketplace_pending_signup_resumable(null) or public.marketplace_pending_signup_resumable('tampered') or public.marketplace_pending_signup_resumable(repeat('f',64)) then raise exception 'Invalid proof accepted'; end if;
      select jsonb_build_array(to_jsonb(u),to_jsonb(p),to_jsonb(s)) into after_probe from auth.users u join public.profiles p on p.id=u.id join marketplace_private.pending_signup_controls s on s.user_id=u.id where u.id=actor;
      if original is distinct from after_probe then raise exception 'Read-only probe mutated state'; end if;
      update marketplace_private.pending_signup_controls set expires_at=now()-interval '1 second' where user_id=actor;
      if public.marketplace_pending_signup_resumable(ticket) then raise exception 'Expired accepted'; end if;
      update marketplace_private.pending_signup_controls set expires_at=now()+interval '1 hour' where user_id=actor;
      update auth.users set email_confirmed_at=now() where id=actor;
      if public.marketplace_pending_signup_resumable(ticket) then raise exception 'Verified accepted'; end if;
      begin
        update auth.users set email='synthetic@example.invalid' where id=actor;
        raise exception 'Western email guard missing';
      exception when check_violation then null;
      end;
      delete from marketplace_private.pending_signup_controls where user_id=actor;
      if public.marketplace_pending_signup_resumable(ticket) then raise exception 'Consumed accepted'; end if;
    end $$;
    rollback;select true rollback_qualification;`)
  }
  assert.deepEqual(
    await fingerprint(),
    before,
    'Auth/profile/capability rows must remain unchanged'
  )
  console.log(
    JSON.stringify({
      mode,
      ref,
      file,
      sha256,
      passed: true,
      authRowsUnchanged: true,
    })
  )
}
main().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
