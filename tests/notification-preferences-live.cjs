/* global document, window, HTMLMediaElement */
// Disposable staging accounts only; never reads Demo credentials or sends email.
const fs = require('node:fs')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { createClient } = require('@supabase/supabase-js')
const h = require('../scripts/v2-maintenance-staging.cjs')
const env = h.environment()
const admin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
)
const journal = 'tests/artifacts/notification-preferences-live.json'
assert(
  !fs.existsSync(journal),
  'Inspect exact previous fixture journal before another run'
)
const runId = crypto.randomUUID(),
  users = [],
  events = []
const save = () =>
  fs.writeFileSync(journal, JSON.stringify({ runId, users, events }))
const base = 'http://localhost:3000',
  headers = { Origin: base, 'X-Marketplace-Request': '1' }
const fingerprint = () =>
  h.query(
    "begin read only;select (select md5(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]')::text) from public.listings t) listings,(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]')::text) from public.orders t) orders,(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]')::text) from public.order_requests t) requests,(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]')::text) from public.messages t) messages,(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]')::text) from public.conversations t) conversations;rollback;"
  )
async function main() {
  const baseline = fingerprint()
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  })
  const contexts = []
  save()
  try {
    for (let i = 0; i < 2; i++) {
      const email = 'np_live_' + runId + '_' + i + '@uwo.ca',
        password = crypto.randomBytes(24).toString('base64url') + 'Aa1!'
      const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          username:
            'NPL_' + crypto.randomUUID().replaceAll('-', '').slice(0, 12),
          qualificationId: runId,
        },
      })
      assert(
        !created.error && created.data.user,
        'Synthetic staging Auth creation'
      )
      users.push(created.data.user.id)
      save()
      const context = await browser.newContext()
      contexts.push(context)
      const login = await context.request.post(base + '/api/auth/sign-in', {
        headers,
        data: { email, password },
      })
      assert(login.ok(), 'Synthetic localhost session login')
      context.fixtureLogin = { email, password }
    }
    await contexts[0].addInitScript(() => {
      window.soundPlayback = { attempted: 0, resolved: 0, rejected: 0 }
      const original = HTMLMediaElement.prototype.play
      HTMLMediaElement.prototype.play = function (...args) {
        if (!this.src.includes('/static/sounds/notification.wav'))
          return original.apply(this, args)
        window.lastSound = this
        window.soundPlayback.attempted++
        return original.apply(this, args).then(
          (value) => {
            window.soundPlayback.resolved++
            return value
          },
          (error) => {
            window.soundPlayback.rejected++
            window.soundPlayback.errorName = error.name
            throw error
          }
        )
      }
    })
    const p = await contexts[0].newPage()
    await p.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) =>
      r.abort()
    )
    await p.goto(base + '/home?section=settings', {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    })
    const toggle = (label) =>
      p.getByRole('switch', { name: label, exact: true })
    await toggle('In-app notifications').waitFor({ timeout: 60000 })
    for (const width of [390, 430, 820, 1280, 1536]) {
      await p.setViewportSize({ width, height: 900 })
      await p.waitForTimeout(300)
      const switches = p.getByRole('switch')
      assert.equal(await switches.count(), 3)
      const geometry = await switches.evaluateAll((nodes) =>
        nodes.map((n) => {
          const r = n.getBoundingClientRect()
          return { width: r.width, height: r.height, right: r.right }
        })
      )
      assert(
        geometry.every(
          (g) =>
            g.width === 56 &&
            g.height === 30 &&
            Math.abs(g.right - geometry[0].right) < 1
        ),
        'Real Settings switch geometry'
      )
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        ),
        'Real Settings no horizontal overflow'
      )
      console.log(
        'PASS real staging Settings ' +
          width +
          '; supplied switches 56x30, aligned/no overflow'
      )
    }
    await toggle('Email notifications').click()
    await p.waitForFunction(
      () =>
        document
          .querySelector('[role="switch"][aria-label="Email notifications"]')
          ?.getAttribute('aria-checked') === 'false'
    )
    await toggle('Notification sounds').click()
    await p.waitForFunction(
      () =>
        document
          .querySelector('[role="switch"][aria-label="Notification sounds"]')
          ?.getAttribute('aria-checked') === 'true'
    )
    await p.reload({ waitUntil: 'domcontentloaded' })
    await toggle('Notification sounds').waitFor({ timeout: 60000 })
    assert.equal(
      await toggle('Notification sounds').getAttribute('aria-checked'),
      'true',
      'Sound ON refresh persistence'
    )
    assert.equal(
      await p.evaluate(() => window.soundPlayback.attempted),
      0,
      'Sound ON reload with no new notification is silent'
    )
    await toggle('Notification sounds').click()
    await p.waitForFunction(
      () =>
        document
          .querySelector('[role="switch"][aria-label="Notification sounds"]')
          ?.getAttribute('aria-checked') === 'false'
    )
    await p.reload({ waitUntil: 'domcontentloaded' })
    await toggle('Notification sounds').waitFor({ timeout: 60000 })
    assert.equal(
      await toggle('Notification sounds').getAttribute('aria-checked'),
      'false',
      'Sound OFF refresh persistence'
    )
    await toggle('Notification sounds').click()
    await p.waitForFunction(
      () =>
        document
          .querySelector('[role="switch"][aria-label="Notification sounds"]')
          ?.getAttribute('aria-checked') === 'true'
    )
    await toggle('Email notifications').waitFor({ timeout: 60000 })
    assert.equal(
      await toggle('Email notifications').getAttribute('aria-checked'),
      'false',
      'Refresh persistence'
    )
    assert(
      (
        await contexts[0].request.post(base + '/api/auth/sign-out', {
          headers,
          data: {},
        })
      ).ok()
    )
    assert(
      (
        await contexts[0].request.post(base + '/api/auth/sign-in', {
          headers,
          data: contexts[0].fixtureLogin,
        })
      ).ok()
    )
    const mine = await contexts[0].request.get(
      base + '/api/notification-preferences'
    )
    assert.deepEqual(await mine.json(), {
      inApp: true,
      sounds: true,
      email: false,
    })
    const other = await contexts[1].request.get(
      base + '/api/notification-preferences'
    )
    assert.deepEqual(
      await other.json(),
      { inApp: true, sounds: false, email: true },
      'Account isolation'
    )
    await p.reload({ waitUntil: 'domcontentloaded' })
    await toggle('In-app notifications').waitFor({ timeout: 60000 })
    await p.waitForTimeout(2500)
    const event = crypto.randomUUID()
    events.push(event)
    save()
    h.query(
      `begin;insert into marketplace_private.notification_events(id,source_key,event_type,destination)values(${h.q(
        event
      )},${h.q(
        'np-live:' + event
      )},'notification_test','{"section":"settings","panel":"payments-payouts"}');select marketplace_private.deliver_notification(${h.q(
        event
      )},${h.q(users[0])},'INFORMATIONAL');commit;`
    )
    const popup = p.getByRole('button', {
      name: 'Open notification: Staging email test',
      exact: true,
    })
    await popup.waitFor({ timeout: 60000 })
    await p.waitForFunction(() => window.soundPlayback.attempted === 1)
    await p.waitForFunction(
      () => window.soundPlayback.resolved + window.soundPlayback.rejected === 1
    )
    await p.waitForFunction(() => window.lastSound.readyState >= 2)
    const sound = await p.evaluate(() => ({
      ...window.soundPlayback,
      duration: window.lastSound.duration,
      volume: window.lastSound.volume,
      loop: window.lastSound.loop,
    }))
    assert(
      Math.abs(sound.duration - 1.4971) < 0.05 &&
        sound.volume === 0.45 &&
        sound.loop === false,
      'Native WAV decode/path/volume'
    )
    console.log(
      'PASS native WAV decoded; playback ' +
        (sound.resolved ? 'allowed' : 'policy-blocked without failure') +
        '; sound preference ON/OFF refresh and logout/login persistence'
    )
    await p
      .getByRole('button', { name: 'Notifications, 1 unread', exact: true })
      .waitFor()
    await popup.click()
    await p
      .getByRole('button', { name: 'Notifications, 0 unread', exact: true })
      .waitFor({ timeout: 30000 })
    assert(new URL(p.url()).searchParams.get('section') === 'settings')
    console.log(
      'PASS real staging durable preferences, refresh/logout/login, other-user isolation, private Broadcast popup, read/count/navigation; no email send'
    )
  } finally {
    for (const c of contexts) await c.close()
    await browser.close()
    if (events.length)
      h.query(
        `begin;delete from public.notifications where domain_event_id in(${h.ids(
          events
        )});delete from marketplace_private.notification_events where id in(${h.ids(
          events
        )}) and source_key like 'np-live:%';commit;`
      )
    for (const id of users) {
      const found = await admin.auth.admin.getUserById(id)
      assert.equal(
        found.data.user?.user_metadata?.qualificationId,
        runId,
        'Synthetic cleanup ownership'
      )
      assert(
        !(await admin.auth.admin.deleteUser(id)).error,
        'Synthetic Auth cleanup'
      )
    }
    assert.deepEqual(
      fingerprint(),
      baseline,
      'Existing Listing/transaction/chat data unchanged'
    )
    const remaining = h.query(
      `select (select count(*) from auth.users where id in(${h.ids(
        users
      )}))::int users,(select count(*) from marketplace_private.notification_events where id in(${h.ids(
        events
      )}))::int events`
    )
    assert.deepEqual(remaining, [{ users: 0, events: 0 }])
    fs.unlinkSync(journal)
    console.log(
      'PASS synthetic Auth/preferences/notification cleanup; original transaction/chat data unchanged'
    )
  }
}
main().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
