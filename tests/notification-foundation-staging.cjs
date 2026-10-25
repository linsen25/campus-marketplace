/* global fetch, document, innerWidth */
// Real staging auth/Broadcast/Edge delivery. Only new, journaled synthetic users/events.
// Never read Resend secrets or the configured personal test recipient.
const fs = require('fs'),
  path = require('path'),
  Module = require('module'),
  crypto = require('crypto'),
  assert = require('assert/strict')
const { createClient } = require('@supabase/supabase-js')
const scope = 'tests/artifacts/notification-fixtures',
  journalFile = scope + '/scope.json'
fs.mkdirSync(scope, { recursive: true })
assert(
  !fs.existsSync(journalFile),
  'Inspect/recover previous exact notification fixture journal first'
)
const copy = new Module(
  path.resolve('tests/notification-scoped-fixtures.cjs'),
  module
)
copy.filename = path.resolve('tests/notification-scoped-fixtures.cjs')
copy.paths = Module._nodeModulePaths(path.dirname(copy.filename))
copy._compile(
  fs
    .readFileSync('tests/order-meetup-fixtures.cjs', 'utf8')
    .replaceAll('tests/artifacts/meetup-d1-fixtures', scope),
  copy.filename
)
const h = copy.exports,
  users = [],
  events = [],
  deliveries = []
const journal = () =>
  fs.writeFileSync(journalFile, JSON.stringify({ users, events, deliveries }))
const uuid = () => crypto.randomUUID(),
  base = 'http://localhost:3000'
const claims = `select set_config('request.jwt.claims','{"role":"service_role","ref":"pcaqxezdfxofysghssyo"}',true);`
async function seed(user, email = false) {
  const event = uuid(),
    delivery = uuid()
  events.push(event)
  deliveries.push(delivery)
  journal()
  await h.query(`begin;insert into marketplace_private.notification_events(id,source_key,event_type,destination)values(${h.q(
    event
  )},${h.q(
    'notification-test:' + event
  )},'notification_test','{"section":"settings","panel":"payments-payouts"}');
  select marketplace_private.deliver_notification(${h.q(event)},${h.q(
    user
  )},'INFORMATIONAL');
  ${
    email
      ? `insert into marketplace_private.notification_deliveries(id,notification_id,notification_identity,test_only)select ${h.q(
          delivery
        )},id,id,true from public.notifications where domain_event_id=${h.q(
          event
        )};`
      : ''
  }commit;`)
  return delivery
}
async function run() {
  const envHash = crypto
    .createHash('sha256')
    .update(fs.readFileSync('.env.local'))
    .digest('hex')
  const baseline = await h.fingerprint()
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  const contexts = [],
    clients = []
  let sent = false
  try {
    for (let i = 0; i < 2; i++) {
      const email = 'notification_' + uuid() + '@uwo.ca',
        password = crypto.randomBytes(24).toString('base64url') + 'Aa1!'
      const r = await h.admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          username: 'NF_' + uuid().replaceAll('-', '').slice(0, 12),
        },
      })
      assert(!r.error && r.data.user, 'Isolated notification Auth fixture')
      users.push(r.data.user.id)
      journal()
      const c = createClient(
        h.env.NEXT_PUBLIC_SUPABASE_URL,
        h.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        { auth: { persistSession: false, autoRefreshToken: false } }
      )
      assert(!(await c.auth.signInWithPassword({ email, password })).error)
      clients.push(c)
      const context = await browser.newContext()
      contexts.push(context)
      const login = await context.request.post(base + '/api/auth/sign-in', {
        headers: { Origin: base, 'X-Marketplace-Request': '1' },
        data: { email, password },
      })
      assert(login.ok(), 'Real app authenticated fixture session')
    }
    const p = await contexts[0].newPage()
    await p.goto(base + '/home')
    await p
      .getByRole('button', { name: 'Notifications, 0 unread', exact: true })
      .waitFor({ timeout: 60000 })
    await seed(users[0])
    await p
      .getByRole('button', { name: 'Notifications, 1 unread', exact: true })
      .waitFor({ timeout: 30000 })
    await p
      .getByRole('button', { name: 'Notifications, 1 unread', exact: true })
      .click()
    await p
      .getByRole('region', { name: 'Notifications feed' })
      .getByText('Staging email test', { exact: true })
      .waitFor()
    const own = await contexts[0].request.get(base + '/api/notifications')
    const notice = (await own.json()).notifications[0]
    const other = await contexts[1].request.get(base + '/api/notifications')
    assert.equal((await other.json()).unreadCount, 0)
    const denied = await contexts[1].request.post(base + '/api/notifications', {
      headers: { Origin: base, 'X-Marketplace-Request': '1' },
      data: { id: notice.id },
    })
    assert.equal(denied.status(), 403)
    assert.equal(
      (await clients[1].from('notifications').select('id').eq('id', notice.id))
        .data.length,
      0
    )
    assert(
      (
        await clients[0]
          .from('notifications')
          .insert({ recipient_user_id: users[0] })
      ).error
    )
    assert((await clients[0].rpc('marketplace_claim_email_deliveries')).error)
    console.log(
      'PASS real authenticated in-app private Broadcast, unread/feed, cross-user read/mark denial, no client notification/outbox authority'
    )
    if (process.argv.includes('--ui-only')) {
      assert(p.url().endsWith('/home?section=notifications'))
      const feed = p.getByRole('region', { name: 'Notifications feed' })
      await feed.getByRole('button', { name: /Staging email test/ }).click()
      await p.waitForURL('**/home?section=settings&focus=payments-payouts')
      await p
        .getByRole('button', { name: 'Notifications, 0 unread', exact: true })
        .waitFor()
      await p
        .getByRole('button', { name: 'Notifications, 0 unread', exact: true })
        .click()
      await p.waitForURL('**/home?section=notifications')
      await p.getByText('0 unread', { exact: true }).waitFor()
      assert.equal(await feed.locator('[data-unread]').count(), 0)
      await seed(users[0])
      await p.getByText('1 unread', { exact: true }).waitFor({ timeout: 30000 })
      assert.equal(await feed.locator('[data-unread]').count(), 1)
      await feed.getByRole('button', { name: 'Mark all as read' }).click()
      await p
        .getByRole('button', { name: 'Notifications, 0 unread', exact: true })
        .waitFor()
      await p.getByText('0 unread', { exact: true }).waitFor()
      for (const width of [390, 430, 820, 1280, 1536]) {
        await p.setViewportSize({ width, height: 900 })
        await feed.waitFor()
        await p.waitForTimeout(500)
        assert.equal(await p.getByRole('dialog').count(), 0)
        assert.equal(
          await p.getByRole('region', { name: 'Notifications feed' }).count(),
          1
        )
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        )
        const nav = p.getByRole('link', { name: 'Notifications', exact: true })
        if (await nav.isVisible()) {
          const before = await nav.boundingBox()
          const after = await p
            .getByRole('link', { name: 'Settings', exact: true })
            .boundingBox()
          assert(before.y < after.y, 'Notifications above Settings')
          assert.equal(await nav.getAttribute('aria-current'), 'page')
        } else {
          await p.getByRole('button', { name: 'Open Home navigation' }).click()
          const menu = p.getByRole('group', { name: 'Home section navigation' })
          const notification = menu.getByRole('button', {
            name: 'Notifications',
            exact: true,
          })
          const settings = menu.getByRole('button', {
            name: 'Settings',
            exact: true,
          })
          await notification.waitFor()
          assert(
            (await notification.boundingBox()).y <
              (await settings.boundingBox()).y
          )
          assert.equal(await notification.getAttribute('aria-current'), 'page')
          await notification.click()
        }
        console.log(
          'PASS real Notifications layout ' +
            width +
            ': one feed, no popup/overflow'
        )
      }
      const otherPage = await contexts[1].newPage()
      await otherPage.goto(base + '/home?section=notifications')
      await otherPage
        .getByText(/No notifications yet/)
        .waitFor({ timeout: 60000 })
      await otherPage
        .getByRole('button', { name: 'Notifications, 0 unread', exact: true })
        .waitFor()
      console.log(
        'PASS real two-account UI isolation, Bell route, read-on-click, Settings return, live feed, mark-all reconciliation'
      )
      return
    }
    // Two independent overlapping DB transactions, not two sequential RPC calls.
    const raceRuns = process.argv.includes('--email-only') ? 0 : 3
    for (let run = 0; run < raceRuns; run++) {
      const id = await seed(users[0], true),
        barrier = String(700000 + run)
      const a = h.query(
        `begin;${claims}create function pg_temp.nf_claim() returns jsonb language plpgsql as $$declare result jsonb;begin perform pg_advisory_xact_lock(${barrier});result:=public.marketplace_claim_email_deliveries(1,${h.q(
          id
        )});perform pg_sleep(8);return result;end;$$;select pg_temp.nf_claim() claimed;commit;`
      )
      let locked = false
      for (let poll = 0; poll < 15; poll++) {
        const check = await h.query(
          `begin;select not pg_try_advisory_xact_lock(${barrier}) overlapping;rollback;`
        )
        if (check[0]?.overlapping) {
          locked = true
          break
        }
      }
      assert(locked, 'Independent transaction barrier observed')
      const b = await h.query(
        `begin;${claims}select public.marketplace_claim_email_deliveries(1,${h.q(
          id
        )}) claimed;commit;`
      )
      assert.equal(
        b[0].claimed.length,
        0,
        'Second worker skips locked delivery'
      )
      const first = await a
      assert.equal(first.find((r) => r.claimed)?.claimed.length, 1)
      // These were claim-only tests; no provider call. Remove only their synthetic delivery.
      await h.query(
        `delete from marketplace_private.notification_deliveries where id=${h.q(
          id
        )} and test_only and provider_message_id is null;`
      )
    }
    if (raceRuns)
      console.log(
        'PASS three independent overlapping worker claim races; one claimant, no deadlock/timeout'
      )
    const delivery = await seed(users[0], true)
    const anonymousWorker = (token, body) =>
      fetch(
        h.env.NEXT_PUBLIC_SUPABASE_URL +
          '/functions/v1/notification-email-worker',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }
      )
    const callWorker = async (body) => {
      // Same Vault-authenticated path as cron; token is used inside PostgreSQL
      // and is never returned to this test or written into a fixture journal.
      const rows = await h.query(
        `select marketplace_private.call_email_worker(${h.q(
          JSON.stringify(body)
        )}::jsonb) result;`
      )
      return rows[0].result
    }
    assert.equal((await anonymousWorker('invalid', {})).status, 401)
    assert.equal(
      (await callWorker({ to: 'not-allowed@example.invalid' })).status,
      400
    )
    const response = await callWorker({
      testDeliveryId: delivery,
    })
    const result = response.body
    if (result.blocked === 'test_recipient_required') {
      console.log(
        'BLOCKED real-send only: staging RESEND_TEST_RECIPIENT is not configured; no provider call and no delivery claimed'
      )
      return
    }
    assert(
      response.status === 200 && result.sent === 1,
      'Controlled real-send not accepted: ' + JSON.stringify(result)
    )
    sent = true
    let records = await h.query(
      `begin read only;select status,attempt_count,provider_message_id is not null provider_id_present,provider_status from marketplace_private.notification_deliveries where id=${h.q(
        delivery
      )};rollback;`
    )
    assert.equal(records[0].status, 'sent')
    assert(records[0].provider_id_present)
    assert.equal(records[0].provider_status, 'accepted')
    const retry = await callWorker({
      testDeliveryId: delivery,
    })
    assert.equal(retry.body.claimed, 0)
    console.log(
      'PASS real Resend accepted one isolated test delivery; provider ID stored; retry claims zero/sends zero; no recipient/secret disclosed'
    )
  } finally {
    for (const c of contexts) await c.close()
    await browser.close()
    if (events.length) {
      await h.query(
        `begin;delete from marketplace_private.notification_deliveries where notification_identity in(select id from public.notifications where domain_event_id in(${h.set(
          events
        )})) and attempt_count=0;delete from public.notifications where domain_event_id in(${h.set(
          events
        )});delete from marketplace_private.notification_events where id in(${h.set(
          events
        )});commit;`
      )
    }
    for (const id of users)
      assert(
        !(await h.admin.auth.admin.deleteUser(id)).error,
        'Synthetic Auth cleanup'
      )
    assert.deepEqual(await h.fingerprint(), baseline, 'Original data unchanged')
    assert.equal(
      crypto
        .createHash('sha256')
        .update(fs.readFileSync('.env.local'))
        .digest('hex'),
      envHash
    )
    fs.unlinkSync(journalFile)
    console.log(
      'PASS synthetic notification/Auth cleanup; attempted real provider audit retained privately; original/manual/D1 data and .env.local unchanged; sent=' +
        sent
    )
  }
}
run().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
