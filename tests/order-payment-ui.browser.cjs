const assert = require('node:assert/strict')
const path = require('node:path')
module.exports = async function ({
  buyer,
  seller,
  fixed,
  shipping,
  expired,
  capability,
  base,
  root,
}) {
  let runtimeErrors = 0,
    posts = 0,
    exactReads = 0
  const results = []
  const pages = []
  let release
  let stage = 'open Buyer Unset'
  async function open(context, fixture, role) {
    const page = await context.newPage()
    pages.push(page)
    page.setDefaultTimeout(25000)
    page.setDefaultNavigationTimeout(60000)
    page.on('pageerror', () => runtimeErrors++)
    page.on('request', (r) => {
      if (r.url().endsWith('/simulate-payment-success')) posts++
      if (r.url().endsWith('/api/orders/' + fixed.order.id)) exactReads++
    })
    await page.goto(
      base +
        '/home?section=orders&destination=' +
        (role === 'buyer' ? 'purchases' : 'sales') +
        '&order=' +
        fixture.order.id,
      { waitUntil: 'domcontentloaded' }
    )
    await page
      .locator('[data-formal-order="' + fixture.order.id + '"]')
      .waitFor()
    await page.getByRole('tab', { name: 'Payment', exact: true }).click()
    const panel = page.locator('[data-payment-role="' + role + '"]')
    await panel.waitFor()
    return { page, panel }
  }
  async function check(view, name, heading, role, simulator) {
    stage = name
    await view.panel
      .getByRole('heading', { name: heading, exact: true })
      .waitFor()
    await view.panel
      .getByText(role === 'buyer' ? 'Payment method' : 'Payout account', {
        exact: true,
      })
      .waitFor()
    for (const width of [390, 430, 1280, 1536]) {
      await view.page.setViewportSize({ width, height: 1000 })
      // The existing mobile/desktop workspace remounts its detail. Reopen the tab.
      await view.page.getByRole('tab', { name: 'Payment', exact: true }).click()
      await view.panel
        .getByRole('heading', { name: heading, exact: true })
        .waitFor()
      await view.panel
        .getByText(/^(Set|Not set|Needs attention|Ready)$/)
        .first()
        .waitFor()
      assert.equal(
        await view.panel
          .getByText('Simulate successful payment', { exact: true })
          .count(),
        simulator ? 1 : 0,
        name + ' simulator visibility at ' + width
      )
      assert.equal(
        await view.panel
          .getByText(role === 'buyer' ? 'Payout account' : 'Payment method', {
            exact: true,
          })
          .count(),
        0
      )
      assert(
        await view.page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        ),
        name + ' document overflow ' + width
      )
      const overflow = await view.panel.evaluate(
        (el) => el.scrollWidth > el.clientWidth + 1
      )
      assert(!overflow, name + ' panel overflow ' + width)
      await view.page.screenshot({
        path: path.join(root, 'phase-e-' + name + '-' + width + '.png'),
        fullPage: true,
      })
      results.push({ state: name, width, passed: true })
    }
    console.log('PASS responsive ' + name + ' 390/430/1280/1536')
  }
  try {
    await capability(buyer, 'payment_method', 'unset')
    let b = await open(buyer, fixed, 'buyer')
    await b.panel.getByText('Not set', { exact: true }).waitFor()
    await check(b, 'buyer-unset', 'Payment pending', 'buyer', true)
    assert(
      await b.panel
        .getByRole('button', { name: 'Simulate successful payment' })
        .isDisabled()
    )
    await b.panel.getByRole('button', { name: 'Manage payment method' }).click()
    await b.page.waitForURL('**/home?section=settings&focus=payments-payouts')
    await b.page.getByRole('region', { name: 'Payments & payouts' }).waitFor()
    await b.page.close()
    await capability(buyer, 'payment_method', 'needs_attention')
    b = await open(buyer, fixed, 'buyer')
    await b.panel.getByText('Needs attention', { exact: true }).waitFor()
    assert(
      await b.panel
        .getByRole('button', { name: 'Simulate successful payment' })
        .isDisabled()
    )
    await b.page.close()
    await capability(buyer, 'payment_method', 'set')
    b = await open(buyer, fixed, 'buyer')
    await b.panel.getByText('Set', { exact: true }).waitFor()
    await check(b, 'buyer-set', 'Payment pending', 'buyer', true)
    assert(
      await b.panel
        .getByRole('button', { name: 'Simulate successful payment' })
        .isEnabled()
    )
    let s = await open(seller, fixed, 'seller')
    await s.panel.getByText('Ready', { exact: true }).waitFor()
    await check(
      s,
      'seller-pending',
      'Waiting for buyer payment',
      'seller',
      false
    )
    assert(await s.panel.getByText('Expected payout', { exact: true }).count())
    assert(await s.panel.getByText('Not eligible yet', { exact: true }).count())
    // An account problem after Accept must not change or destroy this Order.
    await capability(seller, 'payout_account', 'needs_attention')
    await s.page.reload({ waitUntil: 'domcontentloaded' })
    await s.page.getByRole('tab', { name: 'Payment', exact: true }).click()
    await s.panel.getByText('Needs attention', { exact: true }).waitFor()
    await s.panel
      .getByRole('button', { name: 'Review Payout Settings' })
      .click()
    await s.page.waitForURL('**/home?section=settings&focus=payments-payouts')
    await s.page.close()
    for (const role of ['buyer', 'seller']) {
      for (const [fixture, name, title] of [
        [shipping, 'shipping', 'Shipping cost pending'],
        [expired, 'expired', 'Reservation expired'],
      ]) {
        const v = await open(role === 'buyer' ? buyer : seller, fixture, role)
        await check(v, role + '-' + name, title, role, false)
        assert.equal(
          await v.panel
            .getByText('reservation remaining', { exact: false })
            .count(),
          0
        )
        if (name === 'shipping')
          assert.equal(
            await v.panel
              .getByText(role === 'buyer' ? 'Total' : 'Order total', {
                exact: true,
              })
              .count(),
            0
          )
        await v.page.close()
      }
    }
    // Hold exact GET after mutation: the mutation response must not paint Paid.
    let reached
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const arrived = new Promise((resolve) => {
      reached = resolve
    })
    await b.page.route('**/api/orders?**', async (route) => {
      await gate
      await route.continue()
    })
    await b.page.route('**/api/orders/' + fixed.order.id, async (route) => {
      reached()
      await gate
      await route.continue()
    })
    await b.page.getByRole('tab', { name: 'Payment', exact: true }).click()
    await b.panel.getByText('Set', { exact: true }).waitFor()
    const response = b.page.waitForResponse((r) =>
      r.url().endsWith('/simulate-payment-success')
    )
    const [mutation] = await Promise.all([
      response,
      b.panel
        .getByRole('button', { name: 'Simulate successful payment' })
        .click(),
    ])
    assert.equal(mutation.status(), 200)
    await arrived
    assert.equal(
      await b.panel
        .getByRole('button', { name: 'Simulate successful payment' })
        .getAttribute('aria-busy'),
      'true'
    )
    assert.equal(
      await b.panel
        .getByRole('button', { name: 'Refresh Order', exact: true })
        .count(),
      0
    )
    assert.equal(
      await b.panel
        .getByRole('heading', { name: 'Payment pending', exact: true })
        .count(),
      1
    )
    await b.page
      .getByRole('region', { name: 'Next Step', exact: true })
      .getByRole('heading', { name: 'Complete payment', exact: true })
      .waitFor()
    assert.equal(
      await b.page.locator('[data-slot="stepper"] [data-done]').count(),
      1
    )
    assert.equal(
      await b.page
        .getByRole('status', { name: 'Loading order details', exact: true })
        .count(),
      0
    )
    release()
    await b.panel
      .getByRole('heading', { name: 'Payment confirmed', exact: true })
      .waitFor()
    const shippingFixed = fixed.order.snapshot.draft.fulfillment === 'shipping'
    await b.page
      .getByRole('region', { name: 'Next Step', exact: true })
      .getByRole('heading', {
        name: shippingFixed ? 'Waiting for seller to ship' : 'Meet the seller',
        exact: true,
      })
      .waitFor()
    assert.equal(
      await b.page.locator('[data-slot="stepper"] [data-done]').count(),
      2
    )
    assert.equal(
      await b.page
        .locator('[data-slot="stepper"] [aria-current="step"]')
        .count(),
      0
    )
    assert.equal(posts, 1, 'Exactly one UI simulator POST')
    assert(exactReads >= 1, 'Authoritative exact Order GET')
    await check(b, 'buyer-paid', 'Payment confirmed', 'buyer', false)
    assert.equal(
      await b.panel
        .getByText('reservation remaining', { exact: false })
        .count(),
      0
    )
    await b.page.reload({ waitUntil: 'domcontentloaded' })
    await b.page.getByRole('tab', { name: 'Payment', exact: true }).click()
    await b.panel
      .getByRole('heading', { name: 'Payment confirmed', exact: true })
      .waitFor()
    s = await open(seller, fixed, 'seller')
    await check(s, 'seller-paid', 'Buyer payment confirmed', 'seller', false)
    await s.page
      .getByRole('region', { name: 'Next Step', exact: true })
      .getByRole('heading', {
        name: shippingFixed ? 'Ship the item' : 'Meet the buyer',
        exact: true,
      })
      .waitFor()
    assert.equal(
      await s.page.locator('[data-slot="stepper"] [data-done]').count(),
      2
    )
    assert.equal(
      await s.page
        .locator('[data-slot="stepper"] [aria-current="step"]')
        .count(),
      0
    )
    await s.panel.getByText('Not eligible yet', { exact: true }).waitFor()
    await s.page.reload({ waitUntil: 'domcontentloaded' })
    await s.page.getByRole('tab', { name: 'Payment', exact: true }).click()
    await s.panel
      .getByRole('heading', { name: 'Buyer payment confirmed', exact: true })
      .waitFor()
    const paid = (
      await (
        await buyer.request.get(base + '/api/orders/' + fixed.order.id)
      ).json()
    ).order
    assert.equal(paid.paymentStatus, 'paid')
    assert.equal(paid.payoutStatus, 'not_eligible')
    assert.equal(runtimeErrors, 0)
    require('node:fs').writeFileSync(
      path.join(root, 'phase-e-results.json'),
      JSON.stringify({
        results,
        simulatorPosts: posts,
        exactReads,
        runtimeErrors,
        passed: true,
      })
    )
    console.log(
      'PASS Phase E real Buyer UI mutation -> held exact refetch -> persisted Paid; Seller refresh; Settings links; no runtime errors'
    )
    return paid
  } catch (error) {
    for (let n = 0; n < pages.length; n++) {
      if (!pages[n].isClosed()) {
        const safe = await pages[n]
          .locator('[data-formal-order]')
          .innerText()
          .catch(() => '')
        require('node:fs').writeFileSync(
          path.join(root, 'phase-e-diagnostic-' + n + '.txt'),
          safe
        )
      }
    }
    throw Error(stage + ': ' + error.message)
  } finally {
    if (release) release()
    for (const page of pages) if (!page.isClosed()) await page.close()
  }
}
