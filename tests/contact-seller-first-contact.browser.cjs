/* global document, innerWidth, getComputedStyle */
// Main app with disposable staging participants. No canonical/demo history touched.
const fs = require('fs'),
  path = require('path'),
  Module = require('module'),
  crypto = require('crypto'),
  assert = require('assert/strict')
const scope = 'tests/artifacts/contact-seller-live'
fs.mkdirSync(scope, { recursive: true })
assert(
  !fs.existsSync(scope + '/scope.json'),
  'Recover exact previous synthetic journal first'
)
const mod = new Module(path.resolve('tests/contact-live-fixtures.cjs'), module)
mod.filename = path.resolve('tests/contact-live-fixtures.cjs')
mod.paths = Module._nodeModulePaths(path.dirname(mod.filename))
mod._compile(
  fs
    .readFileSync('tests/order-meetup-fixtures.cjs', 'utf8')
    .replaceAll('tests/artifacts/meetup-d1-fixtures', scope),
  mod.filename
)
const h = mod.exports,
  base = 'http://localhost:3000'
async function freshListing() {
  const f = await h.fixture('on_campus', false)
  await h.query(
    `delete from public.conversations where id=${h.q(
      f.conversationId
    )} and buyer_id=${h.q(h.users[1])} and listing_id=${h.q(
      f.lid
    )} and last_message_sequence=0;`
  )
  return f
}
async function facts(lid) {
  return (
    await h.query(
      `select (select count(*) from public.conversations where listing_origin_id=${h.q(
        lid
      )}) conversations,(select count(*) from public.messages m join public.conversations c on c.id=m.conversation_id where c.listing_origin_id=${h.q(
        lid
      )} and m.origin='buyer_interest') intros,(select count(*) from public.messages m join public.conversations c on c.id=m.conversation_id where c.listing_origin_id=${h.q(
        lid
      )} and m.origin='marketplace_auto_reply') acks,(select count(*) from public.notifications n join public.conversations c on c.id::text=n.destination->>'conversationId' where c.listing_origin_id=${h.q(
        lid
      )} and n.recipient_user_id=c.seller_id) seller_notices,(select count(*) from public.notifications n join public.conversations c on c.id::text=n.destination->>'conversationId' where c.listing_origin_id=${h.q(
        lid
      )} and n.recipient_user_id=c.buyer_id) buyer_notices,(select count(*) from marketplace_private.notification_deliveries d join public.notifications n on n.id=d.notification_id join public.conversations c on c.id::text=n.destination->>'conversationId' where c.listing_origin_id=${h.q(
        lid
      )}) emails;`
    )
  )[0]
}
(async () => {
  const original = await h.fingerprint(),
    envHash = crypto
      .createHash('sha256')
      .update(fs.readFileSync('.env.local'))
      .digest('hex')
  fs.writeFileSync(
    scope + '/qualification-baseline.json',
    JSON.stringify(original)
  )
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const b = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    await h.setup()
    const contexts = []
    for (const i of [0, 1]) {
      const c = await b.newContext({
        viewport: { width: i === 0 ? 1280 : 390, height: 900 },
      })
      assert(
        (
          await c.request.post(base + '/api/auth/sign-in', {
            headers: { Origin: base, 'X-Marketplace-Request': '1' },
            data: h.accounts[i],
          })
        ).ok()
      )
      contexts.push(c)
    }
    const seller = await contexts[0].newPage(),
      buyer = await contexts[1].newPage()
    seller.setDefaultTimeout(45000)
    buyer.setDefaultTimeout(45000)
    await seller.goto(base + '/home?section=messages&destination=selling')
    await seller
      .getByRole('button', { name: 'Notifications, 0 unread', exact: true })
      .waitFor()
    if (!process.argv.includes('--concurrency-only')) {
      const f = await freshListing()
      const marker = JSON.parse(
        fs.readFileSync(scope + '/scope.json', 'utf8')
      ).marker
      await buyer.goto(base + '/listings')
      await buyer
        .getByRole('button', {
          name: new RegExp('Open example listing: ' + marker),
        })
        .click()
      await buyer
        .getByRole('button', { name: /^(Message Seller|Contact seller)$/i })
        .click()
      await buyer.locator('[data-message-history]').waitFor()
      const cid = new URL(buyer.url()).searchParams.get('conversation')
      assert(cid)
      await buyer.getByText(/Automatic reply/).waitFor()
      await buyer.getByText(/Hi, I'm .*interested in your/).waitFor()
      await buyer
        .getByRole('button', { name: 'Notifications, 0 unread', exact: true })
        .waitFor()
      await seller
        .getByRole('button', { name: 'Notifications, 1 unread', exact: true })
        .waitFor({ timeout: 30000 })
      await seller
        .locator(`[data-conversation-id="${cid}"]`)
        .waitFor({ timeout: 30000 })
      assert.deepEqual(await facts(f.lid), {
        conversations: 1,
        intros: 1,
        acks: 1,
        seller_notices: 1,
        buyer_notices: 0,
        emails: 0,
      })
      console.log(
        'PASS real mobile Listing contact: exact conversation, intro/labelled Marketplace reply, Seller realtime conversation + one Bell notification, Buyer zero, no email'
      )
      const repeat = await contexts[1].request.post(
        base + '/api/messages/conversations',
        {
          headers: { Origin: base, 'X-Marketplace-Request': '1' },
          data: {
            listingId: f.lid,
            intent: 'contact-seller',
            displayName: 'Spoofed client name',
            senderId: h.users[0],
          },
        }
      )
      assert(repeat.ok())
      assert.equal((await repeat.json()).id, cid)
      assert.deepEqual(await facts(f.lid), {
        conversations: 1,
        intros: 1,
        acks: 1,
        seller_notices: 1,
        buyer_notices: 0,
        emails: 0,
      })
      await seller
        .getByRole('button', { name: 'Notifications, 1 unread', exact: true })
        .click()
      await seller
        .getByRole('region', { name: 'Notifications feed' })
        .getByRole('button', { name: /^New message/ })
        .click()
      await seller.locator(`[data-message-history="${cid}"]`).waitFor()
      assert(seller.url().includes('conversation=' + cid))
      await seller
        .getByRole('button', { name: 'Notifications, 0 unread', exact: true })
        .waitFor()
      await seller
        .getByRole('textbox', { name: 'Message', exact: true })
        .fill('Actual Seller response for first-contact test')
      await seller
        .getByRole('button', { name: 'Send message', exact: true })
        .click()
      await buyer
        .getByRole('region', { name: 'Chat messages' })
        .getByText('Actual Seller response for first-contact test', {
          exact: true,
        })
        .waitFor({ timeout: 30000 })
      await buyer
        .getByRole('button', { name: 'Notifications, 1 unread', exact: true })
        .waitFor()
      assert.equal((await facts(f.lid)).buyer_notices, 1)
      console.log(
        'PASS repeat contact reuse, exact Seller notification destination/read, real Chat Send and Buyer normal notification'
      )
      for (const width of [390, 430, 820, 1280, 1536]) {
        await seller.setViewportSize({ width, height: 900 })
        await seller.goto(base + '/home?section=notifications')
        await seller
          .getByRole('region', { name: 'Notifications feed' })
          .waitFor()
        await seller.waitForTimeout(400)
        assert(
          await seller.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        )
        if (width >= 1024) {
          const nav = seller.locator('[data-slot="sidebar-body"]')
          await nav.hover()
          await seller.waitForTimeout(450)
          const n = nav.getByRole('link', {
              name: 'Notifications',
              exact: true,
            }),
            s = nav.getByRole('link', { name: 'Settings', exact: true })
          const geom = await n.evaluate((el) => {
            const other = el.parentElement.querySelector('a[href="#settings"]')
            const measure = (e) => {
              const icon = e.firstElementChild,
                label = e.lastElementChild
              return {
                x: icon.getBoundingClientRect().x,
                label: label.getBoundingClientRect().x,
                height: e.getBoundingClientRect().height,
                padding: getComputedStyle(e).paddingLeft,
                width: icon.getBoundingClientRect().width,
                gap: getComputedStyle(e).columnGap,
              }
            }
            return [measure(el), measure(other)]
          })
          assert.deepEqual(geom[0], geom[1])
          assert.equal(await n.locator('span[aria-label$="unread"]').count(), 0)
          assert((await n.boundingBox()).y < (await s.boundingBox()).y)
        } else {
          await seller
            .getByRole('button', { name: 'Open Home navigation' })
            .click()
          await seller.waitForTimeout(750)
          const menu = seller.getByRole('group', {
            name: 'Home section navigation',
          })
          const n = menu.getByRole('button', {
              name: 'Notifications',
              exact: true,
            }),
            s = menu.getByRole('button', { name: 'Settings', exact: true })
          const get = (loc) =>
            loc.evaluate((e) => ({
              x: e.querySelector('svg').getBoundingClientRect().x,
              h: e.getBoundingClientRect().height,
              p: getComputedStyle(e).paddingLeft,
              gap: getComputedStyle(e).columnGap,
            }))
          assert.deepEqual(await get(n), await get(s))
          assert.equal(await n.locator('span[aria-label$="unread"]').count(), 0)
          await n.click()
        }
        await buyer.setViewportSize({ width, height: 900 })
        await buyer.getByText(/Automatic reply/).waitFor()
        assert(
          await buyer.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        )
        console.log(
          'PASS ' +
            width +
            ' sibling icon/text geometry, no nav dot, active Notifications, labelled automatic reply/no overflow'
        )
      }
    }
    // Independent transactions overlap while the first initializer is uncommitted.
    const race = await freshListing(),
      barrier = 80419231,
      actor = `select set_config('request.jwt.claims',${h.q(
        JSON.stringify({ sub: h.users[1], role: 'authenticated' })
      )},true);`
    const a = h.query(
      `begin;${actor}create function pg_temp.fc_race() returns uuid language plpgsql as $$declare cid uuid;begin
      cid:=(public.marketplace_contact_seller(${h.q(race.lid)})).id;
      perform pg_advisory_xact_lock(${barrier});perform pg_sleep(20);return cid;end;$$;
      select pg_temp.fc_race() cid;commit;`
    )
    let held = false
    for (let i = 0; i < 12; i++) {
      const r = await h.query(
        `begin;select not pg_try_advisory_xact_lock(${barrier}) held;rollback;`
      )
      if (r[0].held) {
        held = true
        break
      }
    }
    assert(held, 'First initializer held behind observable barrier')
    let settled = false
    const bb = h
      .query(
        `begin;set local application_name='contact_first_race_b';${actor}select (public.marketplace_contact_seller(${h.q(
          race.lid
        )})).id cid;commit;`
      )
      .finally(() => (settled = true))
    let waiting = false
    for (let i = 0; i < 5 && !settled; i++) {
      const r = await h.query(
        "select exists(select 1 from pg_stat_activity where application_name='contact_first_race_b' and wait_event='advisory') waiting;"
      )
      if (r[0].waiting) {
        waiting = true
        break
      }
    }
    const [ar, br] = await Promise.all([a, bb])
    assert(
      waiting,
      'Independent second transaction observed waiting on first-contact lock'
    )
    assert.equal(ar.find((r) => r.cid).cid, br.find((r) => r.cid).cid)
    assert.deepEqual(await facts(race.lid), {
      conversations: 1,
      intros: 1,
      acks: 1,
      seller_notices: 1,
      buyer_notices: 0,
      emails: 0,
    })
    console.log(
      'PASS true concurrent independent first-contact transactions: observed advisory wait, one identity/intro/ack/notification, no deadlock or timeout'
    )
  } finally {
    await b.close()
    await h.cleanup()
    assert.deepEqual(
      await h.fingerprint(),
      original,
      'Original staging data unchanged'
    )
    assert.equal(
      crypto
        .createHash('sha256')
        .update(fs.readFileSync('.env.local'))
        .digest('hex'),
      envHash
    )
    fs.unlinkSync(scope + '/scope.json')
    console.log(
      'PASS all synthetic Auth/conversation/messages/notifications/Listings/public-private media cleaned; original/manual/D1 and .env.local unchanged'
    )
  }
})().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
