// Execute both actual migrations against PostgreSQL via PGlite, not a regex mock.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite')
;(async () => {
  const db = new PGlite()
  try {
    const setup = fs
      .readFileSync('tests/marketplace-security.cjs', 'utf8')
      .match(/await db\.exec\(`([\s\S]*?)`\)/)[1]
    await db.exec(setup)
    await db.exec(
      fs.readFileSync(
        'supabase/migrations/202609290001_marketplace.sql',
        'utf8'
      )
    )
    const old = '11111111-1111-4111-8111-111111111111'
    await db.query(
      `insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values ($1,'existing@uwo.ca',now(),'{"display_name":"Chris"}')`,
      [old]
    )
    for (const name of ['ChrisLegacy', 'Western', 'Dup', 'dup', 'bad name']) {
      await db.query(`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values (gen_random_uuid(),$1,now(),$2)`, [name.replace(' ', '') + '@uwo.ca', JSON.stringify({display_name:name})])
    }
    await db.exec(
      fs.readFileSync(
        'supabase/migrations/202610030001_marketplace_usernames.sql',
        'utf8'
      )
    )
    assert.equal(
      (
        await db.query('select username from public.profiles where id=$1', [
          old,
        ])
      ).rows[0].username,
      'Chris'
    )
    for (const candidate of [
      'ab',
      'chris 25',
      'chris-25',
      'chris!',
      'a'.repeat(21),
    ]) {
      await assert.rejects(
        db.query(
          `insert into auth.users(id,email,raw_user_meta_data) values (gen_random_uuid(),'bad@uwo.ca',$1)`,
          [JSON.stringify({ username: candidate, marketplace_signup: true })]
        )
      )
    }
    for (const candidate of ['chris', 'CHRIS']) {
      await assert.rejects(
        db.query(
          `insert into auth.users(id,email,raw_user_meta_data) values (gen_random_uuid(),'collision@uwo.ca',$1)`,
          [JSON.stringify({ username: candidate, marketplace_signup: true })]
        ),
        /already taken/
      )
    }
    assert.equal(
      (
        await db.query(
          `select count(*)::int as n from auth.users where email in ('bad@uwo.ca','collision@uwo.ca')`
        )
      ).rows[0].n,
      0,
      'Failed profile transaction leaves no Auth account'
    )
    const candidate = 'chris_25'
    const newer = '22222222-2222-4222-8222-222222222222'
    await db.query(
      `insert into auth.users(id,email,raw_user_meta_data) values ($1,'new@uwo.ca',$2)`,
      [newer, JSON.stringify({ username: candidate, marketplace_signup: true })]
    )
    const as = (id, sql, params = []) =>
      db.transaction(async (tx) => {
        await tx.exec(`set local role ${id ? 'authenticated' : 'anon'}`)
        await tx.query(`select set_config('request.jwt.claim.sub',$1,true)`, [
          id || '',
        ])
        return tx.query(sql, params)
      })
    assert.equal(
      (
        await as(
          null,
          'select public.marketplace_username_available($1) as available',
          ['CHRIS']
        )
      ).rows[0].available,
      false
    )
    assert.equal(
      (
        await as(
          null,
          'select public.marketplace_username_available($1) as available',
          ['Fresh_name']
        )
      ).rows[0].available,
      true
    )
    await assert.rejects(
      as(newer, 'select public.marketplace_confirm_username($1)', [candidate]),
      /Verified Western/
    )
    await assert.rejects(as(newer,'select public.marketplace_change_username($1)',['NotVerified']),/Verified Western/)
    await db.query(
      'update auth.users set email_confirmed_at=now() where id=$1',
      [newer]
    )
    await as(newer, 'select public.marketplace_confirm_username($1)', [
      candidate.toUpperCase(),
    ])
    await assert.rejects(
      as(newer, 'select public.marketplace_confirm_username($1)', [
        'Different_name',
      ])
    )
    await as(
      newer,
      `update public.profiles set display_name='new@uwo.ca' where id=$1`,
      [newer]
    )
    assert.equal(
      (
        await db.query('select display_name from public.profiles where id=$1', [
          newer,
        ])
      ).rows[0].display_name,
      candidate
    )
    await assert.rejects(
      as(newer, `update public.profiles set username='Changed' where id=$1`, [
        newer,
      ]),
      /permission/
    )
    // Reserved names are unavailable and rejected by the atomic signup boundary.
    for (const name of ['admin','ADMIN','administrator','moderator','support','system','staff','official','western','Western','uwo','UWO','campusmarketplace','campus_marketplace']) {
      assert.equal((await as(null,'select public.marketplace_username_available($1) as ok',[name])).rows[0].ok,false)
      await assert.rejects(db.query(`insert into auth.users(id,email,raw_user_meta_data) values (gen_random_uuid(),'reserved@uwo.ca',$1)`,[JSON.stringify({username:name})]),/reserved/)
      await assert.rejects(as(newer,'select public.marketplace_change_username($1)',[name]),/reserved/)
    }
    await assert.rejects(db.query(`insert into auth.users(id,email) values (gen_random_uuid(),'missing@uwo.ca')`),/required/)
    for (const name of ['Western','Dup','dup','bad name'])
      assert.equal((await db.query('select username from public.profiles where display_name=$1',[name])).rows[0].username,null)
    const legacy=(await db.query("select id,username_changed_at from public.profiles where username='ChrisLegacy'")).rows[0]
    assert.equal(legacy.username_changed_at,null)
    await as(legacy.id,'select public.marketplace_change_username($1)',['LegacyNew'])
    await assert.rejects(as(legacy.id,'select public.marketplace_change_username($1)',['LegacyNext']),/change your username again/)
    assert.equal((await db.query('select username_changed_at from public.profiles where id=$1',[old])).rows[0].username_changed_at,null)
    // Backfilled users can rename immediately; newly-created users cannot.
    await as(old,'select public.marketplace_change_username($1)',['Chris2'])
    await assert.rejects(as(newer,'select public.marketplace_change_username($1)',['NewName']),/change your username again/)
    await assert.rejects(as(old,'select public.marketplace_change_username($1)',['Chris3']),/change your username again/)
    const timestamp=(await db.query('select username_changed_at from public.profiles where id=$1',[old])).rows[0].username_changed_at
    const same=(await as(old,'select public.marketplace_change_username($1) as result',['Chris2'])).rows[0].result
    assert.equal(same.username,'Chris2')
    assert.equal((await db.query('select username_changed_at from public.profiles where id=$1',[old])).rows[0].username_changed_at.getTime(),timestamp.getTime())
    assert.equal((await as(null,'select public.marketplace_username_available($1) as ok',['Chris'])).rows[0].ok,false)
    await assert.rejects(db.query(`insert into auth.users(id,email,raw_user_meta_data) values (gen_random_uuid(),'held@uwo.ca','{"username":"CHRIS"}')`),/already taken/)
    assert.equal((await db.query("select count(*)::int as n from auth.users where email='held@uwo.ca'")).rows[0].n,0)
    await assert.rejects(as(null,'select * from marketplace_private.username_history'),/permission/)
    await assert.rejects(db.query("update public.profiles set username_changed_at=now() where id=$1",[old]),/cannot be changed directly/)
    // Simulate elapsed time locally as database administrator. This fixture bypass
    // is absent from the migration/RPC and never runs on the live project.
    const age = async (id, hours) => {
      await db.exec('alter table public.profiles disable trigger profiles_username_identity')
      try { await db.query("update public.profiles set username_changed_at=now()-($2::text || ' hours')::interval where id=$1",[id,hours]) }
      finally { await db.exec('alter table public.profiles enable trigger profiles_username_identity') }
    }
    await age(old,167)
    await assert.rejects(as(old,'select public.marketplace_change_username($1)',['Chris3']),/change your username again/)
    await age(old,169)
    assert.equal((await as(null,'select public.marketplace_username_available($1) as ok',['Chris'])).rows[0].ok,false)
    assert.equal((await as(old,'select public.marketplace_username_available($1) as ok',['Chris'])).rows[0].ok,true)
    assert.equal((await as(newer,'select public.marketplace_username_available($1) as ok',['Chris'])).rows[0].ok,false)
    await age(newer,169)
    await assert.rejects(as(newer,'select public.marketplace_change_username($1)',['Chris']),/already taken/)
    await as(old,'select public.marketplace_change_username($1)',['Chris'])
    assert.equal((await db.query('select username from public.profiles where id=$1',[old])).rows[0].username,'Chris')
    assert.equal((await as(old,'select public.marketplace_username_available($1) as ok',['Chris'])).rows[0].ok,false,'A current owner still makes the name unavailable')
    await assert.rejects(as(newer,'select public.marketplace_change_username($1)',['Chris']),/already taken/)
    await assert.rejects(as(old,'select public.marketplace_change_username($1)',['Chris2']),/change your username again/)
    await age(old,169)
    await as(old,'select public.marketplace_change_username($1)',['Chris2'])
    assert.equal((await as(null,'select public.marketplace_username_available($1) as ok',['Chris'])).rows[0].ok,false)
    assert.equal((await as(old,'select public.marketplace_username_available($1) as ok',['Chris'])).rows[0].ok,true)
    // An existing authenticated session must not bypass new-account hold checks.
    await assert.rejects(db.transaction(async tx=>{
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[old])
      return tx.query(`insert into auth.users(id,email,raw_user_meta_data) values (gen_random_uuid(),'owner-new@uwo.ca','{"username":"Chris"}')`)
    }),/already taken/)
    await age(old,169)
    await as(old,'select public.marketplace_change_username($1)',['CHRIS2'])
    await assert.rejects(as(old,'select public.marketplace_change_username($1)',['Chris3']),/change your username again/)
    await age(old,169)
    await as(old,'select public.marketplace_change_username($1)',['Chris2']) // repeat case-only change, despite own history
    await age(newer,169)
    await assert.rejects(as(newer,'select public.marketplace_change_username($1)',['Chris']),/already taken/)
    await db.exec("update marketplace_private.username_history set released_at=now()-interval '31 days' where previous_username_normalized='chris'")
    assert.equal((await as(null,'select public.marketplace_username_available($1) as ok',['Chris'])).rows[0].ok,true)
    await as(newer,'select public.marketplace_change_username($1)',['Chris'])
    await assert.rejects(as(null,'select public.marketplace_change_username($1)',['AnonNew']),/permission/)
    for(const id of [old,newer]) {
      await assert.rejects(as(id,'select * from marketplace_private.username_history'),/permission/)
      await assert.rejects(as(id,`update public.profiles set username_changed_at=now()-interval '100 days' where id=$1`,[id]),/permission/)
      await assert.rejects(as(id,`update public.profiles set username_normalized='forged' where id=$1`,[id]),/permission|DEFAULT/)
      await assert.rejects(as(id,`update public.profiles set username='admin' where id=$1`,[id]),/permission/)
    }
    await assert.rejects(as(old,'select public.marketplace_confirm_username($1)',['Different']),/associated/)
    assert.equal((await db.query('select count(*)::int as n from marketplace_private.username_history')).rows[0].n,7)
    const results = await Promise.allSettled(
      ['Race_name', 'RACE_NAME'].map((username) =>
        db.query(
          `insert into auth.users(id,email,raw_user_meta_data) values (gen_random_uuid(),$1,$2)`,
          [
            username + '@uwo.ca',
            JSON.stringify({ username, marketplace_signup: true }),
          ]
        )
      )
    )
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    assert.equal(results.filter((r) => r.status === 'rejected').length, 1)
    console.log(
      'PASS PostgreSQL: format/reserved names, eligible-only legacy backfill, atomic Auth rollback, case-insensitive races, 168-hour rolling cooldown, case-only changes, exact no-op, private 30-day holds/expiry, ownership and direct-write safety.'
    )
  } finally {
    await db.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
