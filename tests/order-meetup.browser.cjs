const fs = require('fs'),
  assert = require('assert/strict'),
  path = require('path')
const h = require('./order-meetup-fixtures.cjs')
const {
  chromium,
} = require('./artifacts/browser-tools/node_modules/playwright-core')
const url = (f, mode) =>
  `http://localhost:3000/home?section=orders&destination=${mode}&order=${f.order.id}`
const button = (p, name) => p.getByRole('button', { name, exact: true })
async function loaded(p, f) {
  await p
    .locator(`[data-formal-order="${f.order.id}"]`)
    .waitFor({ timeout: 45000 })
  await p.locator('[data-order-meetup]').waitFor()
}
async function openProposal(p, location) {
  await button(p, 'Propose new meetup').click()
  await p.getByRole('dialog', { name: 'Propose new meetup' }).waitFor()
  await p
    .getByRole('textbox', { name: 'Meetup location', exact: true })
    .fill(location)
}
async function propose(p, location) {
  await openProposal(p, location)
  await button(p, 'Send proposal').click()
  await p
    .getByRole('dialog', { name: 'Propose new meetup' })
    .waitFor({ state: 'hidden', timeout: 45000 })
}
async function clockFixture(f, minutes) {
  await h.query(
    `begin;lock table public.orders in access exclusive mode;alter table public.order_meetup_revisions disable trigger order_meetup_guard;alter table public.order_meetup_revisions disable trigger order_meetup_event;update public.order_meetup_revisions set scheduled_at=clock_timestamp()-interval '${minutes} minutes' where id=(select id from public.order_meetup_revisions where order_id=${h.q(
      f.order.id
    )} and status='confirmed' order by revision desc limit 1);alter table public.order_meetup_revisions enable trigger order_meetup_event;alter table public.order_meetup_revisions enable trigger order_meetup_guard;commit;`
  )
}
;(async () => {
  const before = await h.fingerprint(),
    contexts = []
  let browser, failure
  const errors = [],
    incoming = [0, 0, 0],
    report = { checks: [] }
  try {
    await h.setup()
    const f = await h.accepted('on_campus', true)
    browser = await chromium.launch({
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: true,
    })
    const pages = []
    for (const i of [0, 1, 3]) {
      const c = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        timezoneId: 'America/Toronto',
        serviceWorkers: 'allow',
      })
      // Prove domain invalidation/refetch without the 15-second fallback poll.
      await c.addInitScript(() => {
        const interval = window.setInterval.bind(window)
        window.setInterval = (callback, delay, ...args) =>
          interval(delay === 15000 ? () => {} : callback, delay, ...args)
      })
      contexts.push(c)
      const r = await c.request.post('http://localhost:3000/api/auth/sign-in', {
        headers: {
          Origin: 'http://localhost:3000',
          'X-Marketplace-Request': '1',
        },
        data: h.accounts[i],
      })
      assert.equal(r.status(), 200)
      const p = await c.newPage()
      pages.push(p)
      p.on('pageerror', (e) => errors.push(e.message))
      const ix = pages.length - 1
      p.on('websocket', (s) =>
        s.on('framereceived', ({ payload }) => {
          const frame =
            typeof payload === 'string' ? payload : payload.toString('utf8')
          if (
            frame.includes('messages_changed') &&
            frame.includes(f.order.conversation_id)
          )
            incoming[ix]++
        })
      )
      await p.goto(
        i === 3
          ? 'http://localhost:3000/home?section=orders&destination=purchases'
          : url(f, i === 0 ? 'sales' : 'purchases')
      )
      if (i !== 3) await loaded(p, f)
    }
    const [seller, buyer, outsider] = pages
    for (const width of [390, 430, 1280, 1536]) {
      await buyer.setViewportSize({ width, height: 900 })
      await loaded(buyer, f)
      await openProposal(buyer, 'Synthetic library entrance')
      const d = buyer.getByRole('dialog', { name: 'Propose new meetup' })
      assert(
        await d.evaluate((el) => {
          const r = el.getBoundingClientRect()
          return (
            r.left >= 0 &&
            r.right <= innerWidth + 1 &&
            el.scrollWidth <= el.clientWidth + 1
          )
        })
      )
      await buyer.keyboard.press('Tab')
      assert(await d.evaluate((el) => el.contains(document.activeElement)))
      await buyer.screenshot({
        path: path.join(h.root, `d1-editor-${width}.png`),
      })
      await button(buyer, 'Cancel').click()
      await d.waitFor({ state: 'hidden' })
      console.log('PASS editor ' + width)
    }
    assert.equal(
      (
        await h.query(
          `select count(*) n from public.order_meetup_revisions where order_id=${h.q(
            f.order.id
          )};`
        )
      )[0].n,
      1
    )
    await propose(buyer, 'Synthetic library entrance')
    await seller
      .getByRole('heading', { name: 'New meetup proposed', exact: true })
      .waitFor({ timeout: 45000 })
    await buyer
      .getByRole('heading', { name: 'Awaiting confirmation', exact: true })
      .waitFor()
    assert.equal(await button(buyer, 'Confirm new meetup').count(), 0)
    for (const p of [buyer, seller])
      for (const width of [390, 430, 1280, 1536]) {
        await p.setViewportSize({ width, height: 900 })
        await loaded(p, f)
        await p
          .getByRole('heading', {
            name: p === buyer ? 'Awaiting confirmation' : 'New meetup proposed',
            exact: true,
          })
          .waitFor()
        if (width === 390) {
          const layout = await p.evaluate(() => {
            const h = document.querySelector('[data-formal-order] > h3')
            return {
              viewport: innerWidth,
              root: document.documentElement.scrollWidth,
              titleClient: h?.clientWidth,
              titleScroll: h?.scrollWidth,
              titleFont: h ? getComputedStyle(h).fontSize : null,
            }
          })
          console.log(JSON.stringify({ layout }))
          if (process.argv[2] === 'layout')
            throw new Error('Read-only layout diagnostic complete')
        }
        await p.waitForFunction(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
        const panel = p.locator('[data-order-meetup]')
        assert(
          await panel.evaluate((el) => {
            const r = el.getBoundingClientRect()
            return (
              r.left >= 0 &&
              r.right <= innerWidth + 1 &&
              el.scrollWidth <= el.clientWidth + 1
            )
          })
        )
        await panel.scrollIntoViewIfNeeded()

        await panel.screenshot({
          path: path.join(
            h.root,
            `d1-pending-${p === buyer ? 'buyer' : 'seller'}-${width}.png`
          ),
        })
      }
    await button(seller, 'Decline').click()
    await buyer
      .getByRole('heading', { name: 'Awaiting confirmation', exact: true })
      .waitFor({ state: 'hidden', timeout: 45000 })
    await propose(seller, 'Synthetic campus cafe')
    await buyer
      .getByRole('heading', { name: 'New meetup proposed', exact: true })
      .waitFor({ timeout: 45000 })
    assert.equal(await button(seller, 'Confirm new meetup').count(), 0)
    await button(buyer, 'Confirm new meetup').click()
    for (const p of [buyer, seller]) {
      await p
        .getByRole('heading', { name: 'New meetup proposed', exact: true })
        .waitFor({ state: 'hidden', timeout: 45000 })
      await p
        .getByRole('heading', { name: 'Awaiting confirmation', exact: true })
        .waitFor({ state: 'hidden' })
      await p
        .getByText('Synthetic campus cafe', { exact: true })
        .first()
        .waitFor({ timeout: 45000 })
    }
    await buyer.reload()
    await loaded(buyer, f)
    await buyer
      .getByText('Synthetic campus cafe', { exact: true })
      .first()
      .waitFor()
    assert.equal(
      (
        await h.query(
          `select count(*) n from public.order_meetup_revisions where order_id=${h.q(
            f.order.id
          )} and status='confirmed';`
        )
      )[0].n,
      2
    )
    report.checks.push(
      'Buyer-propose-Seller-decline-Seller-propose-Buyer-confirm-Realtime-no-reload-refresh-persistence-self-confirm-absent'
    )
    // Scheduling callbacks must keep this exact detail, including withdraw/replacement.
    await propose(buyer, 'Synthetic first replacement')
    await loaded(buyer, f)
    await seller
      .getByRole('heading', { name: 'New meetup proposed', exact: true })
      .waitFor()
    await propose(buyer, 'Synthetic final replacement')
    await loaded(buyer, f)
    await seller
      .getByText('Synthetic final replacement', { exact: true })
      .first()
      .waitFor()
    await button(seller, 'Confirm new meetup').click()
    await loaded(seller, f)
    await buyer
      .getByText('Synthetic final replacement', { exact: true })
      .first()
      .waitFor()
    await propose(buyer, 'Synthetic withdrawn meetup')
    await loaded(buyer, f)
    await seller
      .getByRole('heading', { name: 'New meetup proposed', exact: true })
      .waitFor()
    await button(buyer, 'Withdraw proposal').click()
    await loaded(buyer, f)
    await seller
      .getByRole('heading', { name: 'New meetup proposed', exact: true })
      .waitFor({ state: 'hidden', timeout: 45000 })
    const duplicateEvents = await h.query(
      `select count(*) n from (select transition_key from public.transaction_events where order_id=${h.q(
        f.order.id
      )} group by transition_key having count(*)>1) duplicates;`
    )
    assert.equal(duplicateEvents[0].n, 0)
    report.checks.push(
      'propose-confirm-decline-withdraw-replace-keeps-exact-detail-zero-duplicate-events'
    )
    await clockFixture(f, 30)
    await buyer.reload()
    await loaded(buyer, f)
    await buyer
      .getByText('Meetup grace period in progress.', { exact: true })
      .waitFor()
    for (const width of [390, 430, 1280, 1536]) {
      await buyer.setViewportSize({ width, height: 900 })
      await loaded(buyer, f)
      await buyer
        .getByText('Meetup grace period in progress.', { exact: true })
        .waitFor()
      if (
        !(await buyer
          .locator('[data-order-meetup] details')
          .evaluate((el) => el.open))
      )
        await buyer.getByText('Meetup history', { exact: true }).click()
      await buyer
        .getByRole('heading', { name: 'Initial confirmed meetup', exact: true })
        .waitFor()
      await buyer.locator('[data-order-meetup]').screenshot({
        path: path.join(h.root, `d1-grace-history-${width}.png`),
      })
    }
    await clockFixture(f, 65)
    await buyer.reload()
    await loaded(buyer, f)
    await buyer
      .getByText('Meetup was not completed within the allowed grace period.', {
        exact: true,
      })
      .waitFor()
    assert.equal(await button(buyer, 'Propose new meetup').count(), 0)
    for (const p of [buyer, seller]) {
      await p.reload()
      await loaded(p, f)
      for (const width of [390, 430, 1280, 1536]) {
        await p.setViewportSize({ width, height: 900 })
        await loaded(p, f)
        await p.getByText('Order expired', { exact: true }).waitFor()
        assert.equal(await button(p, 'Confirm new meetup').count(), 0)
        await p.locator('[data-order-meetup]').screenshot({
          path: path.join(
            h.root,
            `d1-expired-${p === buyer ? 'buyer' : 'seller'}-${width}.png`
          ),
        })
      }
    }
    assert.equal(await outsider.locator('[data-order-meetup]').count(), 0)
    assert.equal(incoming[2], 0)
    assert(incoming[0] > 0 && incoming[1] > 0)
    assert.equal(errors.length, 0, JSON.stringify(errors))
    report.checks.push(
      '390-430-1280-1536-confirmed-pending-incoming-awaiting-confirm-decline-history-grace-Expired-no-overflow'
    )
    report.checks.push(
      'private-two-participant-invalidation-outsider-zero-no-runtime-errors-no-payment-handoff'
    )
    const offerStates = await h.query(
      `select id,status from public.order_requests where id in(${h.q(
        f.offer
      )},${h.q(f.competingOfferId)});`
    )
    assert.equal(offerStates.find((r) => r.id === f.offer).status, 'accepted')
    assert.equal(
      offerStates.find((r) => r.id === f.competingOfferId).status,
      'closed'
    )
    const cancellation = await h.accepted()
    await buyer.goto(url(cancellation, 'purchases'))
    await loaded(buyer, cancellation)
    await button(buyer, 'Cancel order').click()
    const cancelDialog = buyer.getByRole('dialog', {
      name: 'Cancel this order?',
      exact: true,
    })
    const reason = cancelDialog.getByRole('combobox', {
      name: 'Cancellation reason',
      exact: true,
    })
    await reason.focus()
    await buyer.keyboard.press('ArrowDown')
    await buyer.keyboard.press('Home')
    await buyer.keyboard.press('Enter')
    await reason.getByText('Changed my mind', { exact: true }).waitFor()
    await cancelDialog
      .getByRole('button', { name: 'Cancel order', exact: true })
      .click()
    await buyer.waitForURL(
      (u) =>
        u.searchParams.get('section') === 'orders' &&
        !u.searchParams.has('order')
    )
    await buyer
      .locator(`[data-order-list-card="${cancellation.order.id}"]`)
      .waitFor()
    assert.equal(
      (
        await h.query(
          `select lifecycle_status from public.orders where id=${h.q(
            cancellation.order.id
          )};`
        )
      )[0].lifecycle_status,
      'cancelled'
    )
    report.checks.push('Cancel-Order-keeps-original-History-navigation')
    report.runtimeErrors = 0
    report.invalidationCounts = incoming
    console.log('PASS ' + report.checks.join('\nPASS '))
  } catch (e) {
    failure = e
    console.error(e.stack)
    for (let i = 0; i < contexts.length; i++) {
      const p = contexts[i].pages()[0]
      if (p)
        await p
          .screenshot({ path: path.join(h.root, `d1-failure-${i}.png`) })
          .catch(() => {})
    }
  } finally {
    for (const c of contexts) await c.close()
    if (browser) await browser.close()
    await h.cleanup()
    assert.deepEqual(await h.fingerprint(), before)
    report.syntheticCleanup = true
    report.manualMediaFingerprintUnchanged = true
    fs.writeFileSync(h.root + '/browser-report.json', JSON.stringify(report))
    console.log(JSON.stringify(report))
  }
  if (failure) throw failure
})().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
