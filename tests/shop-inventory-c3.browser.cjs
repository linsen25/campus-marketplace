/* C3 UI verification: all API responses are local fixtures; no database writes. */
const assert = require('node:assert/strict')

if (!process.env.PLAYWRIGHT_MODULE || !process.env.BROWSER_EXECUTABLE) {
  console.error(
    'BLOCKED C3 browser test: set PLAYWRIGHT_MODULE and BROWSER_EXECUTABLE from the local browser-test runner.'
  )
  process.exitCode = 2
  return
}

const { chromium } = require(process.env.PLAYWRIGHT_MODULE)

const membership = {
  evaluatedAt: '2026-11-16T00:00:00.000Z',
  revision: 1,
  status: 'active',
  reason: null,
  effectiveTier: 'plus',
  currentTermStart: '2026-11-01T00:00:00.000Z',
  currentTermEnd: '2026-12-01T00:00:00.000Z',
  graceEndsAt: null,
  nextBoundaryAt: null,
  trialClaimed: false,
  trialEligible: false,
  maxActiveProducts: 40,
  canOperateShop: true,
  canUseShopAnalytics: true,
  proPromotionEligible: false,
  accessCycleId: 'fixture-cycle',
  scheduledTier: null,
  scheduledAt: null,
  purchaseMode: 'one_month',
}

let product = {
  id: '50000000-0000-4000-8000-000000000005',
  listingChannel: 'shop',
  title: 'Fixture product',
  description: 'C3 inventory browser fixture.',
  price: 1200,
  currency: 'CAD',
  category: 'Electronics',
  condition: 'new',
  preferredPaymentMode: 'in_person',
  preferredFulfillment: 'ON_CAMPUS',
  photoUrls: [],
  seller: { id: 'owner', displayName: 'Owner' },
  shop: {
    id: '30000000-0000-4000-8000-000000000003',
    shopName: 'Owner Shop',
    username: 'owner',
  },
  status: 'available',
  createdAt: '2026-11-16T00:00:00.000Z',
  updatedAt: '2026-11-16T00:00:00.000Z',
  publishedAt: '2026-11-16T00:00:00.000Z',
  inventory: {
    onHandQuantity: 1,
    reservedQuantity: 0,
    availableQuantity: 1,
    lowStockThreshold: 0,
    revision: 1,
    updatedAt: '2026-11-16T00:00:00.000Z',
  },
  inventoryStatus: 'in_stock',
}

;(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  })
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      serviceWorkers: 'block',
    })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/api/**', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const send = (json, status = 200) => route.fulfill({ status, json })
      if (url.pathname === '/api/auth/session')
        return send({ seller: { id: 'owner', displayName: 'Owner' } })
      if (url.pathname === '/api/profile/account')
        return send({
          username: 'owner',
          email: 'owner@example.test',
          emailVerified: true,
          createdAt: '2026-01-01T00:00:00.000Z',
        })
      if (url.pathname === '/api/profile/categories') return send([])
      if (url.pathname === '/api/shop/membership') return send(membership)
      if (
        url.pathname === '/api/listings' &&
        url.searchParams.get('mine') === 'true'
      )
        return send([product])
      if (
        url.pathname === '/api/shop/inventory' &&
        request.method() === 'PATCH'
      ) {
        const body = request.postDataJSON()
        assert.match(body.actionId, /^[0-9a-f-]{36}$/i)
        assert.equal(body.expectedRevision, product.inventory.revision)
        assert.equal(body.delta, 2)
        product = {
          ...product,
          inventory: {
            ...product.inventory,
            onHandQuantity: 3,
            availableQuantity: 3,
            revision: 2,
          },
        }
        return send(product.inventory)
      }
      return send(
        { error: `Unexpected ${request.method()} ${url.pathname}` },
        501
      )
    })
    await page.goto(
      'http://localhost:3100/home?section=shop&destination=my-shop',
      { waitUntil: 'networkidle' }
    )
    await page.getByText('Fixture product', { exact: true }).waitFor()
    assert(await page.getByText('1 in stock', { exact: true }).isVisible())
    await page
      .getByRole('button', { name: 'Manage Fixture product', exact: true })
      .click()
    await page.getByRole('menuitem', { name: /Adjust Inventory/ }).click()
    await page
      .getByRole('heading', { name: 'Adjust inventory', exact: true })
      .waitFor()
    await page.getByLabel('Quantity', { exact: true }).fill('2')
    await page
      .getByRole('button', { name: 'Save adjustment', exact: true })
      .click()
    await page.getByText('3 in stock', { exact: true }).waitFor()
    assert.equal(errors.length, 0, errors.join('\n'))
    console.log(
      'PASS C3 browser: inventory state, action ID/revision, and row refresh'
    )
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
