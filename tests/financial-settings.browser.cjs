// Controlled staging capability writes only; finally restores both demo capabilities.
const fs = require('node:fs'),
  assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
const base = 'http://localhost:3000'
const empty = {
  paymentMethod: { status: 'unset', brand: null, last4: null },
  payoutAccount: { status: 'unset', institution: null, last4: null },
}
let stage = 'initial',
  browser,
  buyer,
  seller
async function read(c) {
  const r = await c.request.get(base + '/api/financial-capabilities')
  assert.equal(r.status(), 200)
  return r.json()
}
async function write(c, capability, status, extra = {}) {
  const r = await c.request.post(
    base + '/api/financial-capabilities/test-state',
    {
      headers: { Origin: base, 'X-Marketplace-Request': '1' },
      data: { capability, status, ...extra },
    }
  )
  assert.equal(r.status(), 200)
  return r.json()
}
;(async () => {
  // Reuse independently verified served staging-config/default-account/secret audit first.
  const cp = require('node:child_process')
  const pre = cp.spawnSync(
    process.execPath,
    ['tests/financial-capabilities.browser.cjs'],
    { encoding: 'utf8', env: process.env }
  )
  assert.equal(
    pre.status,
    0,
    'Default demo and staging runtime guard must pass'
  )
  console.log(pre.stdout.trim())
  const credentials = JSON.parse(
    fs.readFileSync('tests/artifacts/staging-demo/credentials.json', 'utf8')
  )
  browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
  })
  console.log('Browser launched')
  async function login(identity) {
    const c = await browser.newContext({ serviceWorkers: 'block' })
    c.setDefaultTimeout(12000)
    const a = credentials[identity]
    assert.equal(
      (
        await c.request.post(base + '/api/auth/sign-in', {
          headers: { Origin: base, 'X-Marketplace-Request': '1' },
          data: { email: a.email, password: a.password },
        })
      ).status(),
      200
    )
    return c
  }
  console.log('Starting controlled staging login')
  buyer = await login('buyer-a')
  seller = await login('seller-a')
  const p = await buyer.newPage()
  p.setDefaultNavigationTimeout(20000)
  let errors = 0
  p.on('pageerror', () => errors++)
  await p.addInitScript(() =>
    window.addEventListener('unhandledrejection', () => {
      window.__financialRejections = (window.__financialRejections || 0) + 1
    })
  )
  // Do not enter transaction workspaces or touch their read/write/expiry boundaries.
  await p.route('**/api/order-requests/**', (r) => r.abort())
  await p.route('**/api/orders**', (r) => r.abort())
  await p.setViewportSize({ width: 1280, height: 900 })
  console.log('Opening Profile')
  await p.goto(base + '/home', { waitUntil: 'domcontentloaded' })
  const area = p.getByRole('region', { name: 'Payments & payouts' })
  await area
    .locator('[data-financial-capability="payment_method"]')
    .getByText('Unset', { exact: true })
    .waitFor()
  await area.getByRole('button', { name: 'Manage in Settings' }).click()
  await p
    .getByRole('complementary', { name: 'Staging financial test controls' })
    .waitFor()
  const controls = p.getByRole('complementary', {
    name: 'Staging financial test controls',
  })
  async function click(capability, name) {
    const block = controls
      .locator('div')
      .filter({ has: p.getByText(capability + ' test state', { exact: true }) })
      .first()
    await block.getByRole('button', { name, exact: true }).click()
  }
  stage = 'payment set'
  await click('Payment method', 'Simulate Set')
  await area
    .locator('[data-financial-capability="payment_method"]')
    .getByText('Set', { exact: true })
    .waitFor()
  assert.equal((await read(buyer)).paymentMethod.status, 'set')
  assert.deepEqual(await read(seller), empty)
  await p.reload()
  await area
    .locator('[data-financial-capability="payment_method"]')
    .getByText('Set', { exact: true })
    .waitFor()
  await area.getByRole('button', { name: 'Manage in Settings' }).click()
  await area.getByText('Test Card •••• 4242', { exact: true }).waitFor()
  stage = 'payout ready'
  await click('Payout account', 'Simulate Ready')
  await area
    .locator('[data-financial-capability="payout_account"]')
    .getByText('Ready', { exact: true })
    .waitFor()
  assert.equal((await read(buyer)).payoutAccount.status, 'ready')
  await p.reload()
  await area
    .locator('[data-financial-capability="payout_account"]')
    .getByText('Ready', { exact: true })
    .waitFor()
  await area.getByRole('button', { name: 'Manage in Settings' }).click()
  await area.getByText('Test Bank •••• 6789', { exact: true }).waitFor()
  fs.mkdirSync('tests/artifacts/financial-settings', { recursive: true })
  for (const width of [390, 430, 1280, 1536]) {
    stage = 'responsive ' + width
    await p.setViewportSize({ width, height: 1000 })
    // Switching responsive branch retains authoritative data; Settings remains selected.
    await area.getByText('Test Bank •••• 6789', { exact: true }).waitFor()
    assert(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      ),
      'No document overflow'
    )
    assert(await controls.isVisible())
    await p.screenshot({
      path: `tests/artifacts/financial-settings/settings-${width}.png`,
      fullPage: true,
    })
    console.log(
      'PASS Settings ' +
        width +
        ': real Set/Ready, masked metadata, separated test controls, no overflow'
    )
  }
  stage = 'needs attention'
  await click('Payment method', 'Simulate Needs attention')
  await area
    .locator('[data-financial-capability="payment_method"]')
    .getByText('Needs attention', { exact: true })
    .waitFor()
  await click('Payout account', 'Simulate Needs attention')
  await area
    .locator('[data-financial-capability="payout_account"]')
    .getByText('Needs attention', { exact: true })
    .waitFor()
  stage = 'cross-user injection'
  const sellerSession = await seller.request.get(base + '/api/auth/session')
  const session = await sellerSession.json()
  await write(buyer, 'payment_method', 'set', {
    userId: session.seller?.id,
    providerKey: 'ATTACKER',
    providerInstrumentRef: 'ATTACKER',
  })
  assert.deepEqual(await read(seller), empty)
  assert.equal((await read(buyer)).paymentMethod.brand, 'Test Card')
  stage = 'clear'
  await click('Payment method', 'Clear')
  await area
    .locator('[data-financial-capability="payment_method"]')
    .getByText('Unset', { exact: true })
    .waitFor()
  await click('Payout account', 'Clear')
  await area
    .locator('[data-financial-capability="payout_account"]')
    .getByText('Unset', { exact: true })
    .waitFor()
  assert.deepEqual(await read(buyer), empty)
  await p.reload()
  await area.getByRole('button', { name: 'Manage in Settings' }).waitFor()
  assert.deepEqual(await read(buyer), empty)
  for (const width of [390, 430, 1280, 1536]) {
    await p.setViewportSize({ width, height: 1000 })
    await area
      .locator('[data-financial-capability="payment_method"]')
      .getByText('Unset', { exact: true })
      .waitFor()
    assert(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    )
    console.log('PASS Overview ' + width + ': persisted Unset/Unset summary')
  }
  // Deterministic UI transports only: no fake persisted data or live mutations.
  stage = 'loading/error/refetch'
  let release
  let hold = true,
    fail = false
  const gate = new Promise((r) => (release = r))
  await p.route('**/api/financial-capabilities', async (r) => {
    if (hold) await gate
    if (fail)
      return r.fulfill({
        status: 503,
        json: { error: 'Controlled read failure' },
      })
    return r.continue()
  })
  await p.reload({ waitUntil: 'domcontentloaded' })
  await area
    .locator('[data-slot="skeleton"]')
    .first()
    .waitFor()
    .catch(() => {})
  assert.equal(
    await area.getByText('Unset', { exact: true }).count(),
    0,
    'No premature Unset'
  )
  hold = false
  release()
  await area
    .locator('[data-financial-capability="payment_method"]')
    .getByText('Unset', { exact: true })
    .waitFor()
  fail = true
  await p.evaluate(() => dispatchEvent(new Event('focus')))
  await area.getByRole('alert').waitFor()
  assert.equal(
    await area.getByText('Unset', { exact: true }).count(),
    2,
    'Background error retains data'
  )
  fail = false
  await area.getByRole('button', { name: 'Retry', exact: true }).click()
  await area.getByRole('alert').waitFor({ state: 'hidden' })
  assert.equal(errors, 0)
  assert.equal(await p.evaluate(() => window.__financialRejections || 0), 0)
  console.log(
    'PASS actual UI Set/Ready/Needs attention/Clear, refresh + Profile persistence, cross-user protection, loading/error/retry, zero runtime errors'
  )
})()
  .catch((e) => {
    console.error('FAIL ' + stage + ': ' + e.message)
    process.exitCode = 1
  })
  .finally(async () => {
    if (buyer) {
      try {
        await write(buyer, 'payment_method', 'unset')
        await write(buyer, 'payout_account', 'unset')
        assert.deepEqual(await read(buyer), empty)
        console.log(
          'RESTORED canonical Buyer A Unset/Unset; Seller A unchanged'
        )
      } catch {
        console.error('RESTORE FAILED — inspect staging before continuing')
        process.exitCode = 1
      }
    }
    if (browser) await browser.close()
  })
