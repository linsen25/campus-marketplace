const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { chromium, request } = require('./artifacts/browser-tools/node_modules/playwright-core')

const base = process.env.B32_BROWSER_BASE || 'http://localhost:3050'
const browserPath = process.env.BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const createFixtures = process.env.B32_E2E_CREATE_FIXTURES === '1'
const parsedBase = new URL(base)
assert.ok(
  ['localhost', '127.0.0.1'].includes(parsedBase.hostname),
  'B32 browser E2E may only target an isolated local Next.js origin'
)
const credentials = JSON.parse(fs.readFileSync('tests/artifacts/b32/credentials.json', 'utf8'))
const artifactDir = path.join('tests', 'artifacts', 'b32', 'browser-transaction-e2e')
fs.mkdirSync(artifactDir, { recursive: true })
const image = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/AP/EABQQAQAAAAAAAAAAAAAAAAAAACD/2gAIAQEAAQUCX//EABQRAQAAAAAAAAAAAAAAAAAAACD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAACD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAACD/2gAIAQEABj8Cf//Z',
  'base64'
)

async function signIn(api, user) {
  const response = await api.post(`${base}/api/auth/sign-in`, {
    headers: { Origin: base, 'X-Marketplace-Request': '1' },
    data: user,
  })
  assert.equal(response.status(), 200, `sign-in failed: ${response.status()}`)
}

async function setupFixtures() {
  assert.equal(
    createFixtures,
    true,
    'Fixture creation is disabled by default. Set B32_E2E_CREATE_FIXTURES=1 only for an intentional fresh B32 E2E run.'
  )
  const api = await request.newContext()
  await signIn(api, credentials.users.seller)
  const run = Date.now()
  const fixtures = []
  for (const [name, mode] of [
    ['desktop-direct', 'external'],
    ['desktop-interac', 'interac_etransfer'],
    ['mobile-direct', 'external'],
    ['mobile-interac', 'interac_etransfer'],
  ]) {
    const create = await api.post(`${base}/api/listings`, {
      headers: { Origin: base, 'X-Marketplace-Request': '1' },
      data: {
        title: `B32 browser ${name} ${run}`,
        description: 'Isolated B32 browser transaction fixture.',
        price: 1200,
        currency: 'CAD',
        category: 'Electronics',
        subcategory: 'Cameras',
        condition: 'good',
        pickupArea: 'B32 Test Campus',
        preferredFulfillment: 'ON_CAMPUS',
        preferredPaymentMode: mode,
        meetingLocation: null,
        estimatedDeliveryFeeCents: 0,
        photoUrls: [],
        expectedImageCount: 1,
      },
    })
    assert.equal(create.status(), 201, `fixture create ${name}: ${create.status()}`)
    const listing = await create.json()
    const upload = await api.post(
      `${base}/api/listing-images/${listing.id}?slot=1`,
      {
        headers: {
          Origin: base,
          'X-Marketplace-Request': '1',
          'Content-Type': 'image/jpeg',
        },
        data: image,
      }
    )
    assert.equal(upload.status(), 200, `fixture upload ${name}: ${upload.status()}`)
    const finalize = await api.post(`${base}/api/listings/${listing.id}/finalize`, {
      headers: { Origin: base, 'X-Marketplace-Request': '1' },
    })
    assert.equal(finalize.status(), 200, `fixture finalize ${name}: ${finalize.status()}`)
    const published = await finalize.json()
    assert.equal(published.status, 'available')
    assert.ok(published.publishedAt)
    fixtures.push({ name, mode, listingId: listing.id, title: published.title })
  }
  await api.dispose()
  fs.writeFileSync(path.join(artifactDir, 'fixtures.json'), JSON.stringify({ base, fixtures }, null, 2))
  return fixtures
}

async function waitReady(page) {
  await page.waitForFunction(
    () => {
      const body = document.body
      return Boolean(body && getComputedStyle(body).display !== 'none' && body.innerText.length > 80)
    },
    { timeout: 60000 }
  )
  await page.waitForFunction(
    async () => {
      try {
        const response = await fetch('/api/auth/session', { credentials: 'same-origin' })
        if (!response.ok) return false
        const body = await response.json()
        return Boolean(body?.seller?.id || body?.buyer?.id || body?.user?.id)
      } catch {
        return false
      }
    },
    { timeout: 60000 }
  )
  await page.waitForFunction(
    () => !document.body.innerText.includes('Log in with your UU account.'),
    { timeout: 60000 }
  )
  await page.waitForTimeout(12000)
}

async function clickFirst(page, pattern) {
  const locator = page.getByRole('button', { name: pattern }).first()
  await locator.waitFor({ state: 'visible', timeout: 60000 })
  await locator.click()
}

async function clickIfVisible(page, name, timeout = 1500) {
  const locator = page.getByRole('button', { name, exact: true }).first()
  if (!(await locator.count())) return false
  try {
    await locator.waitFor({ state: 'visible', timeout })
    if (await locator.isDisabled()) return false
    await locator.click()
    return true
  } catch {
    return false
  }
}

async function waitOrderFlowReady(page) {
  await page.waitForFunction(
    () => {
      const text = document.body.innerText
      return (
        text.includes('Current Step') &&
        !text.includes('Loading current step…') &&
        !text.includes('Loading authoritative transaction information.')
      )
    },
    { timeout: 60000 }
  )
}

async function recoverOffers(page) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const retry = page.getByRole('button', { name: 'Retry Offers', exact: true }).first()
    if (await retry.count()) {
      try {
        await retry.waitFor({ state: 'visible', timeout: 3000 })
        await retry.click()
        await page.waitForTimeout(2500)
      } catch {}
    }
    const card = page.getByText(/Buyer\s*·\s*Offer/i).first()
    if (await card.count()) {
      try {
        await card.waitFor({ state: 'visible', timeout: 5000 })
        return card
      } catch {}
    }
    await page.waitForTimeout(2000)
  }
  return page.getByText(/Buyer\s*·\s*Offer/i).first()
}

async function createOffer(page, mode) {
  await clickFirst(page, 'Add to conversation')
  await clickFirst(page, /Make Offer|Make New Offer|Revise Offer|Send Offer/i)
  const form = page.getByRole('form', { name: 'Offer terms' })
  await form.waitFor({ state: 'visible', timeout: 60000 })
  const price = form.locator('input').first()
  await price.fill('12')
  const payment = form.getByRole('button', { name: /Payment method/i }).first()
  if (await payment.count()) {
    await payment.click()
    const option = page.getByText(mode === 'interac_etransfer' ? /Interac/i : /Pay in person|In person/i).last()
    if (await option.count()) await option.click()
  }
  const date = page.getByRole('button', { name: /Choose a date/i }).first()
  if (await date.count()) {
    const box = await date.boundingBox()
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    else await date.click({ force: true })
    if (!(await page.getByRole('dialog', { name: 'Schedule calendar' }).count()))
      await date.evaluate((element) => (element instanceof HTMLElement ? element.click() : undefined))
    await page.waitForTimeout(300)
    const calendarDebug = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].map((node) => ({
      label: node.getAttribute('aria-label'),
      text: node.textContent?.slice(0, 200),
      display: getComputedStyle(node).display,
      visibility: getComputedStyle(node).visibility,
      open: node.matches(':popover-open'),
    })))
    if (!calendarDebug.some((item) => item.label === 'Schedule calendar' && item.open))
      throw new Error(`Schedule calendar did not open: ${JSON.stringify(calendarDebug)}`)
    const enabledDay = page
      .getByRole('dialog', { name: 'Schedule calendar' })
      .getByRole('gridcell')
      .locator('button:not([disabled])')
      .first()
    await enabledDay.click()
  }
  const time = page.getByRole('button', { name: /Choose a time/i }).first()
  if (await time.count()) {
    await time.click()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
  }
  await page.getByRole('button', { name: 'Review Offer', exact: true }).click()
  await page.getByRole('heading', { name: 'Review your Offer' }).waitFor({ state: 'visible', timeout: 60000 })
  await clickFirst(page, /Send Offer|Send Revised Offer/i)
  await page.waitForTimeout(1500)
}

async function runScenario(fixture, viewport, mode) {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true })
  const buyer = await browser.newContext({ viewport })
  const seller = await browser.newContext({ viewport })
  const result = { fixture, viewport, mode, events: [], status: 'FAIL' }
  for (const context of [buyer, seller]) {
    context.on('response', async (response) => {
      const url = response.url()
      if (url.startsWith(base) && (url.includes('/api/offers') || url.includes('/api/orders') || url.includes('/api/interac') || url.includes('/api/order-domain'))) {
        const event = { status: response.status(), method: response.request().method(), path: new URL(url).pathname }
        if (url.includes('/api/order-domain') && response.request().method() === 'GET') {
          try {
            const text = await response.text()
            event.body = text.slice(0, 600).replace(/[\r\n]+/g, ' ')
          } catch {}
        }
        result.events.push(event)
      }
    })
  }
  let buyerPage
  let sellerPage
  try {
    await signIn(buyer.request, credentials.users.buyer)
    buyerPage = await buyer.newPage()
    await buyerPage.goto(`${base}/listings/${fixture.listingId}`, { waitUntil: 'commit', timeout: 60000 })
    await waitReady(buyerPage)
    await clickFirst(buyerPage, /^Message Seller$/)
    await buyerPage.waitForURL(/section=messages/, { timeout: 60000 })
    await waitReady(buyerPage)
    const conversationCard = buyerPage.getByText(fixture.title, { exact: false }).first()
    if (await conversationCard.count()) {
      await conversationCard.click()
      await buyerPage.waitForTimeout(1000)
    }
    await createOffer(buyerPage, mode)

    await signIn(seller.request, credentials.users.seller)
    sellerPage = await seller.newPage()
    const conversationId = new URL(buyerPage.url()).searchParams.get('conversation')
    await sellerPage.goto(`${base}/home?section=messages&destination=selling${conversationId ? `&conversation=${conversationId}` : ''}`, { waitUntil: 'commit', timeout: 60000 })
    await waitReady(sellerPage)
    if (!(await sellerPage.locator('body').innerText()).includes(fixture.title)) {
      await clickFirst(sellerPage, /^Messages$/)
      await sellerPage.waitForTimeout(2500)
    }
    await sellerPage.getByText(fixture.title, { exact: false }).first().click()
    await sellerPage.waitForTimeout(1200)
    const sellerOfferCard = await recoverOffers(sellerPage)
    if (await sellerOfferCard.count()) {
      await sellerOfferCard.click()
      await sellerPage.waitForTimeout(800)
    }
    await clickFirst(sellerPage, /Confirm|Accept Offer|Accept/i)
    await sellerPage.waitForTimeout(1500)
    const viewOrder = sellerPage.getByRole('button', { name: 'View Order', exact: true }).first()
    await viewOrder.waitFor({ state: 'visible', timeout: 60000 })
    await viewOrder.click()
    await sellerPage.waitForTimeout(1500)
    await sellerPage.waitForTimeout(4000)
    await waitOrderFlowReady(sellerPage)
    result.sellerOrderUrl = sellerPage.url()
    result.sellerOrderBody = (await sellerPage.locator('body').innerText()).slice(0, 5000)

    const orderId = new URL(sellerPage.url()).searchParams.get('order')
    if (!orderId) throw new Error('Seller order URL did not contain an order id.')
    const drive = async (page, role) => {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await page.waitForTimeout(1200)
        if (role === 'buyer' && mode === 'interac_etransfer') {
          const reference = page.getByLabel('Reference number (optional)', { exact: true })
          if (await reference.count()) await reference.fill(`B32-${fixture.name}`)
          if (await clickIfVisible(page, "I've sent the payment", 8000)) {
            await page.waitForTimeout(2500)
            continue
          }
        }
        if (role === 'seller' && mode === 'interac_etransfer' && await clickIfVisible(page, "I've received the payment", 8000)) {
          await page.waitForTimeout(2500)
          continue
        }
        if (await clickIfVisible(page, 'Confirm Agreement', 8000)) {
          await page.waitForTimeout(2500)
          continue
        }
        if (await clickIfVisible(page, 'Confirm exchange', 8000)) {
          await page.waitForTimeout(2500)
          continue
        }
        if (await clickIfVisible(page, 'Next', 5000)) {
          await page.waitForTimeout(2500)
          continue
        }
        if (await clickIfVisible(page, 'Refresh Order', 3000)) {
          await page.waitForTimeout(2500)
          continue
        }
        break
      }
    }
    await drive(sellerPage, 'seller')

    await buyerPage.goto(`${base}/home?section=orders&destination=purchases${orderId ? `&order=${orderId}` : ''}`, { waitUntil: 'commit', timeout: 60000 })
    await waitReady(buyerPage)
    await buyerPage.waitForTimeout(2000)
    const buyerView = buyerPage.getByRole('button', { name: 'View Order', exact: true }).first()
    if (await buyerView.count()) {
      await buyerView.waitFor({ state: 'visible', timeout: 60000 })
      await buyerView.click()
    }
    await buyerPage.waitForTimeout(4000)
    await waitOrderFlowReady(buyerPage)
    await clickIfVisible(buyerPage, 'Refresh Order', 3000)
    await buyerPage.waitForTimeout(1200)
    result.buyerConfirmAgreement = await buyerPage
      .getByRole('button', { name: 'Confirm Agreement', exact: true })
      .count()
    await drive(buyerPage, 'buyer')
    // The first Seller pass happens before Buyer Agreement/Payment actions.
    // Revisit both contexts after each participant action so the second
    // Agreement and exchange attestations are performed through the UI too.
    await sellerPage.bringToFront()
    await drive(sellerPage, 'seller')
    await buyerPage.bringToFront()
    await drive(buyerPage, 'buyer')
    result.orderId = orderId
    result.buyerOrderUrl = buyerPage.url()
    await sellerPage.bringToFront()
    await sellerPage.waitForTimeout(1500)
    result.sellerOrderBody = (await sellerPage.locator('body').innerText()).slice(0, 5000)
    await buyerPage.bringToFront()
    await buyerPage.waitForTimeout(1500)
    result.buyerOrderBody = (await buyerPage.locator('body').innerText()).slice(0, 5000)

    const sellerCompleted = /Current Step\s+Completed/.test(result.sellerOrderBody || '')
    const buyerCompleted = /Current Step\s+Completed/.test(result.buyerOrderBody || '')
    result.status = sellerCompleted && buyerCompleted ? 'PASS' : 'PARTIAL'
    result.note = sellerCompleted && buyerCompleted
      ? 'Browser flow reached Completed for both Seller and Buyer.'
      : 'Offer and Order UI reached; one or both participant flows did not reach Completed.'
    fs.writeFileSync(path.join(artifactDir, `${fixture.name}-${viewport.width}.json`), JSON.stringify(result, null, 2))
  } catch (error) {
    result.error = String(error?.message || error)
    if (typeof buyerPage !== 'undefined') {
      try {
        result.url = buyerPage.url()
        result.body = (await buyerPage.locator('body').innerText()).slice(0, 5000)
        result.buttons = await buyerPage.locator('button').allTextContents()
        await buyerPage.screenshot({ path: path.join(artifactDir, `${fixture.name}-${viewport.width}-failure.png`), fullPage: true })
      } catch {}
    }
    if (typeof sellerPage !== 'undefined') {
      try {
        result.sellerUrl = sellerPage.url()
        result.sellerBody = (await sellerPage.locator('body').innerText()).slice(0, 5000)
        result.sellerButtons = await sellerPage.locator('button').allTextContents()
        await sellerPage.screenshot({ path: path.join(artifactDir, `${fixture.name}-${viewport.width}-seller-failure.png`), fullPage: true })
      } catch {}
    }
    fs.writeFileSync(path.join(artifactDir, `${fixture.name}-${viewport.width}.json`), JSON.stringify(result, null, 2))
  } finally {
    await buyer.close()
    await seller.close()
    await browser.close()
  }
  return result
}

;(async () => {
  const fixtures = await setupFixtures()
  const selected = process.env.B32_BROWSER_ONLY
    ? fixtures.filter((fixture) => fixture.name === process.env.B32_BROWSER_ONLY)
    : fixtures
  const results = []
  for (const fixture of selected) {
    const mobile = fixture.name.startsWith('mobile')
    results.push(await runScenario(fixture, mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, fixture.mode))
  }
  console.log(JSON.stringify({ fixtures, results }, null, 2))
})().catch((error) => {
  console.error(error.stack || error)
  process.exitCode = 1
})
