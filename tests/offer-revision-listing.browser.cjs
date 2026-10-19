const { readTestPictureJpeg } = require('../scripts/lib/test-pictures.cjs')
/* global document */
// Disposable staging listing + real UI. Never uses canonical listings for mutations.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const h = require('./order-meetup-fixtures.cjs')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
const base = 'http://localhost:3000'
const ok = (r) => {
  assert(
    !r.error,
    (r.error?.code || 'Staging operation') + ': ' + (r.error?.message || '')
  )
  return r.data
}
const button = (p, name) => p.getByRole('button', { name, exact: true })
async function preference(page, value) {
  await page
    .getByRole('combobox', { name: 'Preferred fulfillment', exact: true })
    .click()
  await page.getByRole('option', { name: value, exact: true }).click()
}
async function run() {
  const baseline = await h.fingerprint(),
    errors = [],
    checks = []
  let browser
  try {
    await h.setup()
    const f = await h.fixture('on_campus', false)
    const original = (
      await h.query(
        `select title,category,subcategory,condition,pickup_area from public.listings where id=${h.q(
          f.lid
        )}`
      )
    )[0]
    browser = await chromium.launch({
      executablePath: process.env.BROWSER_EXECUTABLE,
      headless: true,
      args: ['--enable-unsafe-swiftshader'],
    })
    const pages = []
    for (const i of [0, 1]) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        serviceWorkers: 'block',
        timezoneId: 'America/Toronto',
      })
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
      page.on('dialog', (dialog) => dialog.accept())
      page.on('pageerror', (e) => errors.push(e.message))
      pages.push(page)
    }
    const [seller, buyer] = pages
    for (const width of [390, 430, 1280, 1536]) {
      await seller.setViewportSize({ width, height: 900 })
      await seller.goto(base + '/listings/new', {
        waitUntil: 'domcontentloaded',
      })
      const select = seller.getByRole('combobox', {
        name: 'Preferred fulfillment',
        exact: true,
      })
      await select.waitFor({ timeout: 60000 })
      assert((await select.innerText()).includes('On Campus'))
      await preference(seller, 'Delivery')
      assert((await select.innerText()).includes('Delivery'))
      if (width === 390) {
        for (const [label, value] of [
          ['Title', original.title],
          [
            'Description',
            'Disposable staging Listing fulfillment qualification',
          ],
        ])
          await seller.getByLabel(label, { exact: true }).fill(value)
        await seller.locator('input[name="price"]').fill('80')
        for (const [label, value] of [
          ['Category', original.category],
          ['Subcategory', original.subcategory],
          [
            'Condition',
            original.condition === 'like-new'
              ? 'Like new'
              : original.condition.charAt(0).toUpperCase() +
                original.condition.slice(1),
          ],
          ['Place', original.pickup_area],
        ]) {
          await seller
            .getByRole('combobox', { name: label, exact: true })
            .click()
          await seller.getByRole('option', { name: value, exact: true }).click()
        }
        await seller.locator('input[type="file"]').setInputFiles({
          name: 'synthetic-listing.jpg',
          mimeType: 'image/jpeg',
          buffer: readTestPictureJpeg('chair'),
        })
        const creating = seller.waitForResponse(
          (r) =>
            r.url().endsWith('/api/listings') &&
            r.request().method() === 'POST',
          { timeout: 60000 }
        )
        await button(seller, 'Create').click()
        const response = await creating
        assert.equal(response.status(), 201)
        const created = await response.json()
        h.listings.push(created.id)
        h.journal()
        await seller
          .getByRole('dialog', { name: 'Listing created', exact: true })
          .waitFor({ timeout: 60000 })
        assert.equal(
          (
            await h.query(
              `select preferred_fulfillment,published_at is not null published from public.listings where id=${h.q(
                created.id
              )}`
            )
          )[0].preferred_fulfillment,
          'DELIVERY'
        )
        assert(
          (
            await h.query(
              `select published_at is not null published from public.listings where id=${h.q(
                created.id
              )}`
            )
          )[0].published
        )
        console.log(
          'Real Listing Create/upload/publish preserves Delivery preference'
        )
      }
      await seller.goto(`${base}/listings/${f.lid}/edit`, {
        waitUntil: 'domcontentloaded',
      })
      await select.waitFor({ timeout: 60000 })
      await preference(seller, 'Delivery')
      const saving = seller.waitForResponse(
        (r) =>
          r.url().endsWith('/api/listings/' + f.lid) &&
          r.request().method() === 'PATCH',
        { timeout: 20000 }
      )
      await button(seller, 'Save changes').click()
      const saved = await saving
      assert.equal(saved.status(), 200, 'Listing preference save response')
      // Persistence is checked directly; navigation animation is not this test's authority.
      const row = (
        await h.query(
          `select preferred_fulfillment,pickup_area from public.listings where id=${h.q(
            f.lid
          )}`
        )
      )[0]
      assert.equal(row.preferred_fulfillment, 'DELIVERY')
      assert.equal(row.pickup_area, original.pickup_area)
      console.log(`Listing edit persisted at ${width}`)
      await buyer.setViewportSize({ width, height: 900 })
      await buyer.goto(`${base}/listings/${f.lid}`, {
        waitUntil: 'domcontentloaded',
      })
      await button(buyer, 'Make Offer').click({ timeout: 60000 })
      const editor = buyer.getByRole('dialog', {
        name: 'Make an Offer',
        exact: true,
      })
      await editor.waitFor({ timeout: 60000 })
      assert.equal(
        await editor
          .getByLabel('Offer price (CA$)', { exact: true })
          .inputValue(),
        '80.00'
      )
      await editor.getByLabel('Delivery fee (CA$)', { exact: true }).fill('10')
      await editor
        .getByRole('button', { name: 'Courier / shipping', exact: true })
        .click()
      await editor.getByLabel('Delivery city', { exact: true }).fill('London')
      await editor
        .getByLabel('Postal prefix (first 3 characters)', { exact: true })
        .fill('n6a')
      await button(buyer, 'Review Offer').click()
      const review = buyer.getByRole('dialog', {
        name: 'Review your Offer',
        exact: true,
      })
      await review.waitFor()
      const text = await review.innerText()
      assert(text.includes('Delivery'))
      assert(text.includes('N6A'))
      assert(!text.includes('Changed terms: Fulfillment'))
      assert(text.includes('CA$0.80'))
      assert(text.includes('CA$90.80'))
      await review.getByRole('button', { name: 'Go Back', exact: true }).click()
      await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
      await button(buyer, 'Discard').click()
      await buyer.waitForFunction(
        () => document.querySelectorAll('dialog[open]').length === 0
      )
      checks.push({
        width,
        createPreference: true,
        editPersisted: true,
        makeOfferDefault: true,
        deliveryFeeExcluded: true,
      })
    }
    const terms = {
      item_amount_cents: 8000,
      fulfillment: 'delivery',
      delivery_fee_cents: 1000,
      delivery_method: 'courier',
      delivery_area: {
        country_code: 'CA',
        province_code: 'ON',
        city_label: 'London',
        postal_prefix: 'N6A',
      },
      note: 'Synthetic listing qualification',
    }
    const offer = ok(
      await h.clients[1].rpc('marketplace_submit_offer', {
        p_conversation_id: f.conversationId,
        p_terms: terms,
        p_client_action_id: crypto.randomUUID(),
      })
    )
    h.offers.push(offer.id)
    h.journal()
    const captured = ok(
      await h.clients[1].rpc('marketplace_offer_history', {
        p_conversation_id: f.conversationId,
      })
    ).offers.find((value) => value.id === offer.id)
    assert(
      !captured.changed_fields.includes('Fulfillment'),
      'Server comparison retains Listing Delivery baseline'
    )
    await buyer.goto(`${base}/listings/${f.lid}`)
    await button(buyer, 'Revise Offer').waitFor({ timeout: 60000 })
    ok(
      await h.clients[1].rpc('marketplace_withdraw_offer', {
        p_offer_id: offer.id,
        p_client_action_id: crypto.randomUUID(),
      })
    )
    await buyer.reload()
    await button(buyer, 'Make New Offer').waitFor({ timeout: 60000 })
    const next = ok(
      await h.clients[0].rpc('marketplace_submit_offer', {
        p_conversation_id: f.conversationId,
        p_terms: terms,
        p_client_action_id: crypto.randomUUID(),
      })
    )
    h.offers.push(next.id)
    h.journal()
    const candidate = { ...f, offer: next.id },
      command = crypto.randomUUID(),
      media = await h.prepare(candidate, command, 1)
    ok(await h.accept(candidate, media, command, 1))
    await buyer.reload()
    await button(buyer, 'View Order').waitFor({ timeout: 60000 })
    await button(buyer, 'View Order').click()
    await buyer.waitForURL(
      (url) => url.searchParams.get('section') === 'orders'
    )
    assert(buyer.url().includes('section=orders'))
    assert.deepEqual(errors, [])
    console.log(
      JSON.stringify({
        checks,
        contextualCtas: [
          'Make Offer',
          'Revise Offer',
          'Make New Offer',
          'View Order',
        ],
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
run().catch((e) => {
  console.error('Listing revision qualification failed:', e.message)
  process.exitCode = 1
})
