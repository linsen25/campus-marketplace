/* global document, innerWidth */
// Real immutable multi-round history, using disposable staged backend authority only.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const h = require('./order-meetup-fixtures.cjs')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
const base = 'http://localhost:3000'
const uuid = () => crypto.randomUUID()
const ok = (result) => {
  assert(
    !result.error,
    (result.error?.code || 'Staging transport') +
      ': ' +
      (result.error?.message || '')
  )
  return result.data
}
async function another(f, terms) {
  const offer = ok(
    await h.clients[0].rpc('marketplace_submit_offer', {
      p_conversation_id: f.order.conversation_id,
      p_terms: terms,
      p_client_action_id: uuid(),
    })
  )
  h.offers.push(offer.id)
  h.journal()
  const next = { ...f, offer: offer.id },
    command = uuid()
  const batch = await h.prepare(next, command, 1)
  next.order = ok(await h.accept(next, batch, command, 1))
  return next
}
async function run() {
  const baseline = await h.fingerprint(),
    contexts = [],
    checks = [],
    errors = []
  let browser
  try {
    await h.setup()
    await h.capability('set', 1, 'payment_method')
    const cancelled = await h.accepted('on_campus', true)
    console.log('Synthetic milestone: first accepted')
    const cid = cancelled.order.conversation_id
    const terms = (
      await h.query(
        `select offer_terms from public.order_requests where id=${h.q(
          cancelled.offer
        )}`
      )
    )[0].offer_terms
    ok(
      await h.clients[1].rpc('marketplace_cancel_order', {
        p_order_id: cancelled.order.id,
        p_reason: 'buyer_changed_mind',
        p_note: 'Synthetic multi-round history',
        p_client_action_id: uuid(),
      })
    )
    const expired = await another(cancelled, terms)
    console.log('Synthetic milestone: second accepted')
    await h.query(`begin;lock table public.order_meetup_revisions in access exclusive mode;
   alter table public.order_meetup_revisions disable trigger order_meetup_guard;
   alter table public.order_meetup_revisions disable trigger order_meetup_event;
   update public.order_meetup_revisions set scheduled_at=date_trunc('hour',clock_timestamp())-interval '2 hours'
   where order_id=${h.q(expired.order.id)} and status='confirmed';
   alter table public.order_meetup_revisions enable trigger order_meetup_event;
   alter table public.order_meetup_revisions enable trigger order_meetup_guard;
   select marketplace_private.settle_order_meetup(${h.q(expired.lid)});commit;`)
    const completed = await another(cancelled, terms)
    console.log('Synthetic milestone: third accepted')
    ok(
      await h.clients[1].rpc('marketplace_confirm_campus_inspection', {
        p_order_id: completed.order.id,
        p_client_action_id: uuid(),
      })
    )
    const payment = ok(
      await h.clients[1].rpc('marketplace_start_order_payment', {
        p_order_id: completed.order.id,
        p_client_action_id: uuid(),
      })
    )
    console.log('Synthetic milestone: payment attempt started')
    ok(
      await h.admin.rpc('marketplace_resolve_campus_payment', {
        p_attempt_id: payment.attemptId,
        p_success: true,
      })
    )
    const credential = ok(
      await h.clients[1].rpc('marketplace_handoff_credential', {
        p_order_id: completed.order.id,
      })
    )
    console.log('Synthetic milestone: paid credential available')
    ok(
      await h.clients[0].rpc('marketplace_verify_handoff', {
        p_order_id: completed.order.id,
        p_channel: 'qr',
        p_credential: credential.qrToken,
        p_client_action_id: uuid(),
      })
    )
    await h.query(
      `begin;update marketplace_private.order_protection set started_at=t.value-interval '25 hours',expires_at=t.value-interval '1 hour' from(select clock_timestamp() value)t where order_id=${h.q(
        completed.order.id
      )};select marketplace_private.settle_order_protection(${h.q(
        completed.lid
      )});commit;`
    )
    const expected = [
      ['cancelled', cancelled],
      ['expired', expired],
      ['completed', completed],
    ]
    for (const i of [0, 1]) {
      const history = ok(
        await h.clients[i].rpc('marketplace_offer_history', {
          p_conversation_id: cid,
        })
      )
      assert.equal(history.agreements.length, 3)
      assert.deepEqual(
        history.agreements.map((value) => value.status),
        expected.map(([status]) => status)
      )
      for (const [, fixture] of expected)
        assert.equal(
          history.offers.find((value) => value.id === fixture.offer).status,
          'accepted'
        )
    }
    assert.equal(
      (
        await h.query(
          `select status from public.listings where id=${h.q(completed.lid)}`
        )
      )[0].status,
      'sold'
    )
    browser = await chromium.launch({
      executablePath: process.env.BROWSER_EXECUTABLE,
      headless: true,
      args: ['--enable-unsafe-swiftshader'],
    })
    for (const i of [0, 1]) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        serviceWorkers: 'block',
        timezoneId: 'America/Toronto',
      })
      contexts.push(context)
      assert.equal(
        (
          await context.request.post(base + '/api/auth/sign-in', {
            headers: { Origin: base, 'X-Marketplace-Request': '1' },
            data: h.accounts[i],
          })
        ).status(),
        200
      )
      const page = await context.newPage()
      page.on('pageerror', (error) => errors.push(error.message))
      for (const width of [390, 430, 1280, 1536]) {
        await page.setViewportSize({ width, height: 900 })
        await page.goto(
          `${base}/home?section=messages&destination=${
            i === 0 ? 'selling' : 'buying'
          }&conversation=${cid}`,
          { waitUntil: 'domcontentloaded', timeout: 120000 }
        )
        const row = page.locator(`[data-conversation-id="${cid}"]`).first(),
          history = page.locator(`[data-message-history="${cid}"]`)
        await Promise.race([
          row.waitFor({ timeout: 60000 }),
          history.waitFor({ timeout: 60000 }),
        ])
        if (!(await history.isVisible())) await row.click()
        await history.waitFor({ timeout: 60000 })
        for (const [status, fixture] of expected) {
          const card = page.locator(
            `[data-timeline-agreement="${fixture.order.id}"]`
          )
          await card
            .locator(`[data-agreement-status="${status}"]`)
            .waitFor({ timeout: 60000 })
          assert.equal(
            await card.locator('[data-sent]').count(),
            0,
            'Milestone is centered system content'
          )
          assert.equal(
            await page
              .locator(`[data-offer-id="${fixture.offer}"]`)
              .getAttribute('data-offer-status'),
            'Accepted'
          )
          assert.equal(
            await page
              .locator(`[data-offer-id="${fixture.offer}"] img`)
              .count(),
            0,
            'Compact Offer image-free'
          )
        }
        assert(
          await history.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
          'Timeline has no horizontal overflow'
        )
        await page.screenshot({
          path: `${h.root}/milestones-${
            i === 0 ? 'seller' : 'buyer'
          }-${width}.png`,
        })
        await page
          .locator(`[data-timeline-agreement="${completed.order.id}"]`)
          .getByRole('button', { name: 'View details', exact: true })
          .click()
        await page
          .locator(`[data-formal-order="${completed.order.id}"]`)
          .waitFor({ timeout: 60000 })
        assert(page.url().includes(`order=${completed.order.id}`))
        checks.push({
          width,
          role: i === 0 ? 'seller' : 'buyer',
          cancelled: true,
          expired: true,
          completed: true,
          threeImmutableAcceptedOffers: true,
          threeDistinctMilestones: true,
          correctOrderNavigation: true,
        })
        console.log(`PASS milestones ${width} ${i === 0 ? 'seller' : 'buyer'}`)
      }
    }
    assert.deepEqual(errors, [])
    console.log(
      JSON.stringify({
        checks,
        paidHandoffProtectionAuthority: true,
        providerIndependentStagingOnly: true,
        runtimeErrors: 0,
      })
    )
  } finally {
    if (browser) await browser.close()
    await h.cleanup()
    assert.deepEqual(
      await h.fingerprint(),
      baseline,
      'Canonical/manual unchanged'
    )
  }
}
run().catch((error) => {
  console.error('Milestone qualification failed:', error.message)
  process.exitCode = 1
})
