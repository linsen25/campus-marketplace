// Real PostgreSQL contract execution; no network or live accounts.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite')
async function main() {
  const db = new PGlite()
  try {
    const setup = fs
      .readFileSync('tests/marketplace-security.cjs', 'utf8')
      .match(/await db\.exec\(`([\s\S]*?)`\)/)[1]
    await db.exec(setup)
    await db.exec(
      `create role service_role; alter table auth.users add column confirmation_token text default ''; create table auth.one_time_tokens(user_id uuid, token_type text, token_hash text);`
    )
    for (const file of [
      '202609290001_marketplace.sql',
      '202610030001_marketplace_usernames.sql',
      '202610090001_auth_pending_username.sql',
    ])
      await db.exec(fs.readFileSync('supabase/migrations/' + file, 'utf8'))
    const user = async (name) => {
      const id = crypto.randomUUID(),
        ticket = crypto.randomBytes(32).toString('hex'),
        email = name + '@uwo.ca'
      await db.query(
        `insert into auth.users(id,email,confirmation_token,raw_user_meta_data) values ($1,$2,'old-code',$3)`,
        [
          id,
          email,
          JSON.stringify({ username: name, pending_signup_ticket: ticket }),
        ]
      )
      await db.query(
        `insert into auth.one_time_tokens values ($1,'confirmation_token','old-code')`,
        [id]
      )
      return { id, ticket, email }
    }
    const a = await user('PendingA'),
      b = await user('PendingB')
    const correct = (u, name, role = 'service_role') =>
      db.transaction(async (tx) => {
        await tx.exec('set local role ' + role)
        return tx.query(
          'select public.marketplace_correct_pending_username($1,$2,$3)',
          [u.ticket, u.email, name]
        )
      })
    const profile = async (u) =>
      (
        await db.query(
          'select username,username_changed_at from public.profiles where id=$1',
          [u.id]
        )
      ).rows[0]
    assert.equal(
      (
        await db.query(
          "select raw_user_meta_data ? 'pending_signup_ticket' as leaked from auth.users where id=$1",
          [a.id]
        )
      ).rows[0].leaked,
      false
    )
    for (const role of ['anon', 'authenticated'])
      await assert.rejects(correct(a, 'Changed', role), /permission/)
    await assert.rejects(
      correct({ ...a, ticket: b.ticket }, 'Hijack'),
      /unavailable/
    )
    await db.query(
      "update marketplace_private.pending_signup_controls set expires_at=now()-interval '1 second' where user_id=$1",
      [a.id]
    )
    await assert.rejects(correct(a, 'Expired'), /unavailable/)
    await db.query(
      "update marketplace_private.pending_signup_controls set expires_at=now()+interval '24 hours' where user_id=$1",
      [a.id]
    )
    await assert.rejects(correct(a, 'PendingB'), /already taken/)
    assert.equal((await profile(a)).username, 'PendingA')
    assert.equal(
      (
        await db.query(
          'select confirmation_token from auth.users where id=$1',
          [a.id]
        )
      ).rows[0].confirmation_token,
      'old-code'
    )
    await correct(a, 'CorrectedA')
    assert.equal((await profile(a)).username, 'CorrectedA')
    assert.equal(
      (
        await db.query(
          "select public.marketplace_username_available('PendingA') as ok"
        )
      ).rows[0].ok,
      true
    )
    assert.equal(
      (
        await db.query(
          'select confirmation_token from auth.users where id=$1',
          [a.id]
        )
      ).rows[0].confirmation_token,
      ''
    )
    assert.equal(
      (
        await db.query(
          'select count(*)::int as n from auth.one_time_tokens where user_id=$1',
          [a.id]
        )
      ).rows[0].n,
      0
    )
    const race = await Promise.allSettled([
      correct(a, 'RaceName'),
      correct(b, 'RACENAME'),
    ])
    assert.equal(race.filter((x) => x.status === 'fulfilled').length, 1)
    await db.query(
      'update auth.users set email_confirmed_at=now() where id=$1',
      [a.id]
    )
    await assert.rejects(correct(a, 'Bypass'), /unavailable/)
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.exec('set local role authenticated')
        await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
          a.id,
        ])
        return tx.query("select public.marketplace_change_username('Bypass')")
      }),
      /change your username again/
    )
    await assert.rejects(
      db.query(
        "update public.profiles set username_changed_at=now()-interval '10 days' where id=$1",
        [a.id]
      ),
      /cannot be changed directly/
    )
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.exec('set local role authenticated')
        return tx.query(
          "update public.profiles set username='Direct' where id=$1",
          [b.id]
        )
      }),
      /permission/
    )
    assert.equal(
      (await db.query('select count(*)::int as n from auth.users')).rows[0].n,
      2
    )
    await db.query('delete from auth.users where id in ($1,$2)', [a.id, b.id])
    assert.equal(
      (
        await db.query(
          'select count(*)::int as n from marketplace_private.pending_signup_controls'
        )
      ).rows[0].n,
      0
    )
    console.log(
      'PASS pending capability ownership, metadata redaction, direct-write denial, atomic collision rollback, release, token invalidation, uniqueness race, verified cooldown, cascading cleanup'
    )
  } finally {
    await db.close()
  }
}
main().catch(() => {
  console.error('FAIL pending signup PostgreSQL contract (details suppressed)')
  process.exitCode = 1
})
