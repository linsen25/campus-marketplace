// UI-only qualification against the existing offline synthetic transport.
/* global window, document, getComputedStyle, performance, requestAnimationFrame */
const assert = require('node:assert/strict')
module.exports = async function qualify(page, width) {
  for (const role of ['buyer', 'seller'])
    for (const mode of ['campus', 'seller_delivery', 'courier']) {
      await page.evaluate((v) => window.setScenario(v), {
        viewer: role,
        mode,
        phase: 'review',
      })
      await page.waitForTimeout(120)
      const agreement = page.getByRole('region', {
        name: 'Agreement / Terms',
        exact: true,
      })
      const listing = agreement.locator('[data-listing-preview]')
      assert.equal(
        await listing
          .getByRole('heading', { name: 'Description', exact: true })
          .count(),
        1
      )
      assert.equal(
        await listing
          .getByRole('region', { name: 'Listing description' })
          .locator('p')
          .textContent(),
        await page.evaluate(() => window.model.order.v2.description)
      )
      assert.equal(
        await listing.getByText('Category', { exact: true }).count(),
        1
      )
      assert.equal(
        await listing.getByText('Subcategory', { exact: true }).count(),
        1
      )
      const img = listing.locator('img')
      assert.equal(
        await listing.locator('[data-slot="image-slider"]').count(),
        0
      )
      assert.equal(
        await listing.getByRole('button', { name: /slide/ }).count(),
        0
      )
      await img.evaluate((e) => e.decode())
      const media = await img.evaluate((e) => {
        const r = e.getBoundingClientRect()
        return {
          width: r.width,
          height: r.height,
          fit: getComputedStyle(e).objectFit,
        }
      })
      assert(Math.abs(media.width / media.height - 4 / 5) < 0.01)
      assert(media.width <= (width >= 768 ? 260 : width))
      assert.equal(media.fit, 'cover')
      const navigation = page.getByRole('navigation', {
        name: 'Order page navigation',
      })
      assert.equal(
        await navigation.evaluate((e) => getComputedStyle(e).paddingBottom),
        width >= 1024 ? '24px' : '0px'
      )
      if (width >= 768)
        assert(
          await img.evaluate(
            (e) =>
              e
                .closest('[data-listing-preview]')
                .querySelector('h3')
                .getBoundingClientRect().left >= e.getBoundingClientRect().right
          )
        )
      const panel = page.getByRole('region', {
        name: 'Cancel Order',
        exact: true,
      })
      const disclosure = panel.getByRole('button', {
        name: 'Review cancellation',
        exact: true,
      })
      assert.equal(
        await panel
          .getByRole('button', { name: 'Confirm cancellation', exact: true })
          .count(),
        0
      )
      const posts = await page.evaluate(
        () => window.requests.filter((r) => r.method === 'POST').length
      )
      await disclosure.click()
      const review = panel.getByRole('region', {
        name: 'Cancellation review',
        exact: true,
      })
      await review.waitFor()
      assert.equal(await page.locator('dialog').count(), 0)
      assert.equal(
        await page.evaluate(
          () => window.requests.filter((r) => r.method === 'POST').length
        ),
        posts
      )
      assert.equal(await disclosure.getAttribute('aria-expanded'), 'true')
      const confirm = review.getByRole('button', {
        name: 'Confirm cancellation',
        exact: true,
      })
      assert.equal(await confirm.isDisabled(), true)
      await review
        .getByRole('combobox', { name: 'Cancellation context' })
        .click()
      await page
        .getByRole('option', {
          name: role === 'buyer' ? 'Changed my mind' : 'Item unavailable',
          exact: true,
        })
        .click()
      assert.equal(await confirm.isEnabled(), true)
      assert.equal(
        await confirm
          .locator('.shining-button__body')
          .evaluate((e) => getComputedStyle(e).backgroundColor),
        'rgb(119, 45, 64)'
      )
      assert(
        await review.evaluate((e) => {
          const root = e.closest('[aria-label="Order Detail"]'),
            nav = root.querySelector('nav')
          return (
            e.getBoundingClientRect().bottom <= nav.getBoundingClientRect().top
          )
        })
      )
      await confirm.click()
      await page.waitForFunction(() =>
        window.requests.some(
          (r) => r.method === 'POST' && r.url.endsWith('/cancel')
        )
      )
      const commands = await page.evaluate(() =>
        window.requests.filter((r) => r.method === 'POST')
      )
      assert.equal(commands.length, 1)
      assert.deepEqual(Object.keys(commands[0].body).sort(), [
        'clientActionId',
        'note',
        'reason',
      ])
      await page.waitForFunction(
        () => window.model.order.lifecycle === 'cancelled'
      )
      assert.equal(
        await panel
          .getByRole('button', { name: 'Review cancellation', exact: true })
          .count(),
        0
      )
      assert.equal(
        await panel
          .getByRole('button', { name: 'Confirm cancellation', exact: true })
          .count(),
        0
      )
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      )
    }
  // Successful clipboard feedback: real CSS transitions, exact content, no moving row.
  for (const motion of ['no-preference', 'reduce']) {
    await page.emulateMedia({ reducedMotion: motion })
    await page.evaluate(() =>
      window.setScenario({ mode: 'campus', viewer: 'buyer', phase: 'review' })
    )
    await page.waitForTimeout(120)
    const copy = page.getByRole('button', {
      name: 'Copy order number',
      exact: true,
    })
    await copy.focus()
    const samples = await copy.evaluate(async (button) => {
      const row = button.parentElement,
        samples = [],
        start = performance.now()
      const sample = () => {
        const r = row.getBoundingClientRect(),
          b = button.getBoundingClientRect(),
          c = getComputedStyle(button.querySelector('svg:first-child')),
          check = getComputedStyle(button.querySelector('svg:last-child'))
        samples.push({
          t: performance.now() - start,
          state: button.dataset.copyState,
          copy: Number(c.opacity),
          check: Number(check.opacity),
          duration: check.transitionDuration,
          geometry: [r.x, r.y, r.width, r.height, b.x, b.y, b.width, b.height],
        })
      }
      sample()
      button.click()
      await new Promise((resolve) => {
        const tick = () => {
          sample()
          if (performance.now() - start >= 1400) resolve()
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
      return samples
    })
    assert.equal(
      await page.evaluate(() => window.copied),
      'FDA25A071C57483E93F12AE81B39B6C7'
    )
    assert.equal(await page.getByText('Copied', { exact: true }).count(), 0)
    for (const sample of samples)
      assert.deepEqual(sample.geometry, samples[0].geometry)
    assert.equal(samples.at(-1).copy, 1)
    assert.equal(samples.at(-1).check, 0)
    const visible = samples.filter((s) => s.check > 0.99)
    assert(visible.length > 1)
    const held = visible.at(-1).t - visible[0].t
    assert(held >= 900 && held <= 1070, `Check held ${held}ms`)
    if (motion === 'no-preference')
      assert(
        samples.some((s) => s.check > 0 && s.check < 1),
        'Check must fade'
      )
    else assert.equal(visible[0].duration, '0s')
    const repeated = await copy.evaluate(async (button) => {
      button.click()
      await new Promise((resolve) => setTimeout(resolve, 500))
      button.click()
      await new Promise((resolve) => setTimeout(resolve, 700))
      const held = {
        state: button.dataset.copyState,
        opacity: getComputedStyle(button.querySelector('svg:last-child'))
          .opacity,
      }
      await new Promise((resolve) => setTimeout(resolve, 550))
      return { held, final: button.dataset.copyState }
    })
    assert.deepEqual(repeated, {
      held: { state: 'check', opacity: '1' },
      final: 'copy',
    })
  }
  // Reuse the actual ListingMedia / ImageSlider, including navigation, dots and touch.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const viewer of ['buyer', 'seller']) {
    await page.evaluate((viewer) => {
      window.setScenario({ mode: 'campus', viewer, phase: 'review' })
      const first = window.model.order.snapshot.listing.photoUrls[0]
      window.model.order.snapshot.listing.photoUrls = [
        first,
        'data:image/svg+xml,' +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800"><rect width="640" height="800" fill="blue"/></svg>'
          ),
        'data:image/svg+xml,' +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800"><rect width="640" height="800" fill="green"/></svg>'
          ),
      ]
      window.renderModel()
    }, viewer)
    const listing = page.locator('[data-listing-preview]')
    const slider = listing.locator('[data-slot="image-slider"]')
    const slide = (index) =>
      slider.getByRole('group', { name: `${index} of 3`, exact: true })
    await slide(1).waitFor()
    assert.equal(
      await slider.getByRole('button', { name: /Go to slide/ }).count(),
      3
    )
    assert.equal(
      await slider.getByRole('button', { name: /slideshow/ }).count(),
      0
    )
    await slider
      .getByRole('button', { name: 'Next slide', exact: true })
      .click()
    await slide(2).waitFor()
    assert.equal(
      await slide(2).locator('img').getAttribute('src'),
      await page.evaluate(
        () => window.model.order.snapshot.listing.photoUrls[1]
      )
    )
    await slider
      .getByRole('button', { name: 'Previous slide', exact: true })
      .click()
    await slide(1).waitFor()
    await slider
      .getByRole('button', { name: 'Previous slide', exact: true })
      .click()
    await slide(3).waitFor()
    await slide(3).dispatchEvent('pointerdown', {
      pointerType: 'touch',
      clientX: 180,
      clientY: 80,
    })
    await slide(3).dispatchEvent('pointerup', {
      pointerType: 'touch',
      clientX: 80,
      clientY: 80,
    })
    await slide(1).waitFor()
    await slider
      .getByRole('button', { name: 'Go to slide 2', exact: true })
      .click()
    await slide(2).waitFor()
    const box = await slider.boundingBox()
    assert(Math.abs(box.width / box.height - 4 / 5) < 0.01)
    assert(box.width <= (width >= 768 ? 260 : width))
    assert.equal(
      await slide(2)
        .locator('img')
        .evaluate((e) => getComputedStyle(e).objectFit),
      'cover'
    )
    const nav = page.getByRole('navigation', { name: 'Order page navigation' })
    await nav.getByRole('button', { name: 'Next', exact: true }).click()
    await nav.getByRole('button', { name: 'Back', exact: true }).click()
    await slide(1).waitFor()
    assert.equal(
      await page.evaluate(
        () => window.requests.filter((r) => r.method === 'POST').length
      ),
      0
    )
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    )
  }
  // Buyer full-refund request stays an authoritative request, not immediate cancellation.
  await page.evaluate(() =>
    window.setScenario({
      viewer: 'buyer',
      mode: 'seller_delivery',
      phase: 'paid',
      startedDelivery: true,
    })
  )
  await page.waitForTimeout(120)
  let panel = page.getByRole('region', { name: 'Cancel Order', exact: true })
  await panel
    .getByRole('button', { name: 'Review cancellation', exact: true })
    .click()
  await panel.getByRole('combobox', { name: 'Cancellation context' }).click()
  await page
    .getByRole('option', {
      name: 'Request full refund: Seller / item / delivery issue',
      exact: true,
    })
    .click()
  assert.equal(
    await page.evaluate(
      () => window.requests.filter((r) => r.method === 'POST').length
    ),
    0
  )
  await panel
    .getByRole('button', { name: 'Request full refund', exact: true })
    .click()
  await page.waitForFunction(
    () => window.model.fulfillment.cancellation.state === 'awaiting_seller'
  )
  assert.equal(await page.evaluate(() => window.model.order.lifecycle), 'open')
  assert.equal(
    await panel
      .getByRole('button', { name: 'Review cancellation', exact: true })
      .count(),
    0
  )
  // Existing Seller response controls are inline when the pending request belongs to them.
  await page.evaluate(() => {
    window.model.viewer = 'seller'
    window.model.key += 'seller-response'
    window.renderModel()
  })
  await page.getByRole('button', { name: 'Dispute', exact: true }).waitFor()
  assert.equal(await page.locator('dialog').count(), 0)
  await page.getByRole('button', { name: 'Dispute', exact: true }).click()
  await page.waitForFunction(
    () => window.model.fulfillment.cancellation.state === 'disputed'
  )
  assert.equal(await page.evaluate(() => window.model.order.lifecycle), 'open')
  // Normal cancel unavailable after handoff/shipment; no disclosure/final action.
  for (const mode of ['campus', 'seller_delivery', 'courier']) {
    await page.evaluate(
      (mode) =>
        window.setScenario({
          viewer: 'seller',
          mode,
          phase: mode === 'courier' ? 'shipped' : 'protection',
        }),
      mode
    )
    await page.waitForTimeout(120)
    assert.equal(
      await page
        .getByRole('button', { name: 'Review cancellation', exact: true })
        .count(),
      0
    )
    assert.equal(
      await page
        .getByRole('button', { name: 'Confirm cancellation', exact: true })
        .count(),
      0
    )
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  console.log(
    `PASS ${width}: compact 4:5 single/multiple media, existing arrows/dots/touch/reset; exact copy/1000ms Check/repeated copy/reduced motion/zero shift; desktop-only 24px bottom space; Description and inline cancellation preserved.`
  )
}
