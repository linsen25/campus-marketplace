// Opt-in hosted STAGING execution. Verifies project name/link before any writes.
// Never loads .env.local or a production database URL. Credentials stay in the CLI.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')

const stagingRef = 'pcaqxezdfxofysghssyo'
const seller = 'f1bc0000-0000-4000-8000-000000000101'
const buyer = 'f1bc0000-0000-4000-8000-000000000102'
const outsider = 'f1bc0000-0000-4000-8000-000000000103'
const listingIds = [1, 2, 3, 4].map(n => 'f1bc0000-0000-4000-8000-' + String(n).padStart(12, '0'))
const files = []
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-staging-messages-'))

function cli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('cmd.exe', ['/d', '/c', 'npx.cmd', '--no-install', 'supabase', ...args], {
      cwd: path.resolve('.'), windowsHide: true,
    })
    let stdout = '', stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) return reject(new Error('Staging CLI failed: ' + stderr + stdout))
      try { resolve(JSON.parse(stdout.slice(stdout.indexOf('{')))) }
      catch { reject(new Error('Unexpected CLI response: ' + stdout)) }
    })
  })
}
function query(sql) {
  const filename = path.join(directory, 'query-' + files.length + '.sql')
  fs.writeFileSync(filename, sql)
  files.push(filename)
  // Explicit verified project pins the target even if another process changes the link.
  return cli(['db', 'query', '--linked', '--project-ref', stagingRef, '--file', filename])
}
const cleanup = `begin;
-- These fixtures inserted metadata through SQL only, never physical Storage files.
-- Explicit transaction-local opt-in is required by hosted storage.protect_delete().
select set_config('storage.allow_delete_query','true',true);
delete from public.conversations where listing_origin_id in (${listingIds.map(id => "'" + id + "'").join(',')});
delete from public.listings where id in (${listingIds.map(id => "'" + id + "'").join(',')});
delete from storage.objects where bucket_id='listing-images' and (storage.foldername(name))[1]='${seller}';
delete from auth.users where id in ('${seller}','${buyer}','${outsider}');
select (select count(*) from auth.users where id in ('${seller}','${buyer}','${outsider}')) as users_left,
 (select count(*) from public.conversations where listing_origin_id in (${listingIds.map(id => "'" + id + "'").join(',')})) as conversations_left,
 (select count(*) from public.listings where id in (${listingIds.map(id => "'" + id + "'").join(',')})) as listings_left,
 (select count(*) from public.messages where sender_id='${buyer}') as messages_left,
 (select count(*) from storage.objects where bucket_id='listing-images' and (storage.foldername(name))[1]='${seller}') as objects_left;
commit;`

async function main() {
  const projects = await cli(['projects', 'list'])
  const linked = projects.projects.filter(project => project.linked)
  assert.equal(linked.length, 1)
  assert.equal(linked[0].ref, stagingRef)
  assert.equal(linked[0].name, 'western-marketplace-staging')
  console.log('Confirmed linked western-marketplace-staging; production excluded')
  const suite = fs.readFileSync('tests/messages-text-staging.sql', 'utf8')
  const setupStart = suite.indexOf('do $$\ndeclare seller uuid')
  const setupEnd = suite.indexOf('set local role authenticated;', setupStart)
  assert(setupStart >= 0 && setupEnd > setupStart)
  const setup = suite.slice(setupStart, setupEnd)
    .replaceAll('f1b00000', 'f1bc0000').replaceAll('f1b10000', 'f1bc1000')
    .replaceAll('Phase1B', 'Phase1BC').replaceAll('phase1b-', 'phase1bc-')
  let created = false
  try {
    if (process.argv.includes('--cleanup-only')) {
      created = true
      return
    }
    const seeded = await query(`begin; ${setup}
set local role authenticated;
select set_config('request.jwt.claim.sub','${buyer}',true);
select set_config('request.jwt.claims','{"sub":"${buyer}","role":"authenticated"}',true);
select (public.marketplace_find_or_create_conversation('${listingIds[0]}')).id as id;
commit;`)
    created = true
    const conversation = seeded.rows[0].id
    assert.match(conversation, /^[0-9a-f-]{36}$/)
    const auth = `set local role authenticated;
select set_config('request.jwt.claim.sub','${buyer}',true);
select set_config('request.jwt.claims','{"sub":"${buyer}","role":"authenticated"}',true);`
    const concurrent = async (label, same, expectedFirst) => {
      const nonce = crypto.randomUUID()
      const secondNonce = same ? nonce : crypto.randomUUID()
      const appName = 'phase1b_' + label + '_' + crypto.randomUUID().slice(0, 8)
      const first = query(`begin; ${auth}
select set_config('application_name','${appName}',true);
create temp table sent_result as select * from public.marketplace_send_text('${conversation}','${nonce}','Concurrent ${label}');
select pg_sleep(15);
select id,sequence,pg_backend_pid() as backend_pid from sent_result;
commit;`)
      // Keep a rejection handler while the first session is awaiting commit.
      first.catch(() => {})
      let observed = false
      try {
        for (let attempt = 0; attempt < 6 && !observed; attempt++) {
          const locks = await query(`select count(*) as held from pg_stat_activity a join pg_locks l on l.pid=a.pid
where a.application_name='${appName}' and l.relation='public.messages'::regclass
and l.mode='RowExclusiveLock' and l.granted;`)
          observed = Number(locks.rows[0].held) > 0
        }
        assert(observed, 'First real PostgreSQL session must hold message/conversation transaction locks')
        const second = query(`begin; ${auth}
create temp table elapsed_start as select clock_timestamp() as started;
create temp table sent_result as select * from public.marketplace_send_text('${conversation}','${secondNonce}','Concurrent ${label}');
select id,sequence,pg_backend_pid() as backend_pid,
 extract(epoch from clock_timestamp()-(select started from elapsed_start)) as elapsed_seconds from sent_result;
commit;`)
        const [a, b] = await Promise.all([first, second])
        const one = a.rows[0], two = b.rows[0]
        assert.notEqual(one.backend_pid, two.backend_pid, 'Independent PostgreSQL sessions required')
        assert(Number(two.elapsed_seconds) > 1, 'Second request must genuinely wait for first transaction')
        assert.equal(Number(one.sequence), expectedFirst)
        if (same) {
          assert.equal(one.id, two.id)
          assert.equal(Number(two.sequence), expectedFirst)
        } else {
          assert.notEqual(one.id, two.id)
          assert.equal(Number(two.sequence), expectedFirst + 1)
        }
        const state = await query(`select c.last_message_sequence,
 (select count(*) from public.messages m where m.conversation_id=c.id) as message_count,
 (select count(distinct sequence) from public.messages m where m.conversation_id=c.id) as unique_sequences
from public.conversations c where c.id='${conversation}';`)
        const last = same ? expectedFirst : expectedFirst + 1
        assert.equal(Number(state.rows[0].last_message_sequence), last)
        assert.equal(Number(state.rows[0].message_count), last)
        assert.equal(Number(state.rows[0].unique_sequences), last)
        console.log(JSON.stringify({ test: label, result: 'PASS', firstSequence: one.sequence,
          secondSequence: two.sequence, separateBackendSessions: true,
          secondWaitSeconds: Number(two.elapsed_seconds), messages: state.rows[0].message_count }))
      } finally {
        // Do not delete fixtures while the held first transaction is still running.
        await first
      }
    }
    await concurrent('same_client_id', true, 1)
    await concurrent('different_client_ids', false, 2)
  } finally {
    if (created) {
      const result = await query(cleanup)
      assert.equal(Number(result.rows[0].users_left), 0)
      assert.equal(Number(result.rows[0].conversations_left), 0)
      assert.equal(Number(result.rows[0].listings_left), 0)
      assert.equal(Number(result.rows[0].messages_left), 0)
      assert.equal(Number(result.rows[0].objects_left), 0)
      console.log('PASS staging concurrency fixtures cleaned: users/conversations/listings/messages/objects = 0')
    }
    for (const file of files) fs.unlinkSync(file)
    fs.rmdirSync(directory)
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
