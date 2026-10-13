// Real staging cookie sessions. No Request/Order writes; only own test capability
// transitions, restored to Unset in finally. Buyer error transport is intercepted.
const assert = require('node:assert/strict'),
  fs = require('node:fs')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
const base = 'http://localhost:3000'
const cid = '08c740e5-48b4-40a1-926e-922eef639bc8'
const rid = '88260b5b-0851-4bf2-a100-8a5c11edd8c9'
const cp = require('node:child_process')
let browser,
  seller,
  buyer,
  stage = 'runtime guard'
async function set(status) {
  const r = await seller.request.post(
    base + '/api/financial-capabilities/test-state',
    {
      headers: { Origin: base, 'X-Marketplace-Request': '1' },
      data: { capability: 'payout_account', status },
    }
  )
  assert.equal(r.status(), 200)
}
;(async () => {
  const guard = cp.spawnSync(
    process.execPath,
    ['tests/financial-capabilities.browser.cjs'],
    { env: process.env, encoding: 'utf8' }
  )
  assert.equal(guard.status, 0, guard.stdout + guard.stderr)
  console.log(guard.stdout.trim())
  const credentials = JSON.parse(
    fs.readFileSync('tests/artifacts/staging-demo/credentials.json', 'utf8')
  )
  browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
  })
  async function login(identity) {
    const context = await browser.newContext({
      serviceWorkers: 'block',
      viewport: { width: 1280, height: 900 },
    })
    context.setDefaultTimeout(20000)
    assert.equal(
      (
        await context.request.post(base + '/api/auth/sign-in', {
          headers: { Origin: base, 'X-Marketplace-Request': '1' },
          data: {
            email: credentials[identity].email,
            password: credentials[identity].password,
          },
        })
      ).status(),
      200
    )
    return context
  }
  seller = await login('seller-b')
  buyer = await login('buyer-a')
  let runtimeErrors = 0,
    mutations = 0,
    intercepted = 0
  async function open(context, role) {
    const page = await context.newPage()
    page.setDefaultNavigationTimeout(60000)
    page.on('pageerror', () => runtimeErrors++)
    await page.route('**/api/messages/**/read', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          conversationId: cid,
          lastReadSequence: 0,
          unreadCount: 0,
        }),
      })
    )
    await page.route('**/api/order-requests/**', (r) => {
      if (r.request().method() === 'POST') {
        mutations++
        if (role === 'buying' && r.request().url().endsWith('/accept')) {
          intercepted++
          return r.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({
              code: 'seller_payout_not_ready',
              error:
                'Seller payout setup is not ready yet. This Order Request cannot be accepted right now. The seller needs to update their payout account first.',
            }),
          })
        }
        return r.abort()
      }
      return r.continue()
    })
    await page.goto(base + '/home?section=messages&destination=' + role, {
      waitUntil: 'domcontentloaded',
    })
    await page
      .locator('[data-conversation-id="' + cid + '"]')
      .first()
      .click()
    await page.locator('[data-timeline-request="' + rid + '"]').waitFor()
    return page
  }
  stage = 'seller workspace'
  const s = await open(seller, 'selling')
  fs.mkdirSync('tests/artifacts/order-payout', { recursive: true })
  for (const width of [1280, 390, 430, 1536]) {
    await s.setViewportSize({ width, height: 900 })
    await s.waitForTimeout(500)
    if (
      !(await s
        .getByRole('button', { name: 'Add to conversation', exact: true })
        .count())
    ) {
      await s
        .locator('[data-conversation-id="' + cid + '"]')
        .first()
        .click()
    }
    for (const status of ['unset', 'needs_attention']) {
      stage = 'seller ' + width + ' ' + status
      await set(status)
      await s
        .getByRole('button', { name: 'Add to conversation', exact: true })
        .click()
      await s
        .getByRole('button', { name: 'Send Order Request', exact: true })
        .click()
      const title =
        status === 'unset'
          ? 'Set up payouts first'
          : 'Payout account needs attention'
      const dialog = s.getByRole('dialog', { name: title, exact: true })
      await dialog.waitFor()
      const bounds = await dialog.boundingBox()
      assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1)
      assert.equal(await dialog.locator('input').count(), 0)
      await s.screenshot({
        path:
          'tests/artifacts/order-payout/seller-' +
          width +
          '-' +
          status +
          '.png',
      })
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    }
    console.log(
      'PASS Seller ' +
        width +
        ': discoverable Send; Unset/Needs attention dialogs fit viewport'
    )
  }
  stage = 'ready editor'
  await set('ready')
  await s
    .getByRole('button', { name: 'Add to conversation', exact: true })
    .click()
  await s
    .getByRole('button', { name: 'Send Order Request', exact: true })
    .click()
  const editor = s.getByRole('dialog', {
    name: 'Order Request editor',
    exact: true,
  })
  await editor.waitFor()
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  console.log(
    'PASS Ready opens existing Request editor; no transaction submitted'
  )
  stage = 'settings navigation'
  await set('unset')
  await s
    .getByRole('button', { name: 'Add to conversation', exact: true })
    .click()
  await s
    .getByRole('button', { name: 'Send Order Request', exact: true })
    .click()
  await s
    .getByRole('button', { name: 'Go to Payout Settings', exact: true })
    .click()
  await s
    .getByRole('complementary', { name: 'Staging financial test controls' })
    .waitFor()
  assert(new URL(s.url()).searchParams.get('section') === 'settings')
  console.log('PASS Settings navigation to Payments & payouts')
  stage = 'buyer workspace'
  const b = await open(buyer, 'buying')
  await b
    .getByRole('button', { name: 'Add to conversation', exact: true })
    .click()
  assert.equal(
    await b
      .getByRole('button', { name: 'Send Order Request', exact: true })
      .count(),
    0
  )
  await b
    .getByRole('button', { name: 'Add to conversation', exact: true })
    .click()
  await b
    .locator('[data-timeline-request="' + rid + '"]')
    .getByRole('button', { name: 'Expand Order Request', exact: true })
    .click()
  await b.getByRole('button', { name: 'Accept', exact: true }).click()
  const confirmation = b.getByRole('dialog', {
    name: 'Accept this Order Request?',
    exact: true,
  })
  await confirmation
    .getByRole('button', { name: 'Accept & Reserve', exact: true })
    .click()
  await confirmation
    .getByRole('alert')
    .filter({ hasText: 'Seller payout setup is not ready yet.' })
    .waitFor()
  assert.equal(intercepted, 1)
  assert.equal(mutations, 1)
  assert.equal(runtimeErrors, 0)
  console.log(
    'PASS Buyer Active Accept displays safe domain error; intercepted transport only; no Request consumed; zero runtime errors'
  )
})()
  .catch((e) => {
    console.error('FAIL ' + stage + ': ' + e.message)
    process.exitCode = 1
  })
  .finally(async () => {
    if (seller) {
      await set('unset')
      console.log('PASS Seller test capability restored to Unset')
    }
    if (browser) await browser.close()
  })
