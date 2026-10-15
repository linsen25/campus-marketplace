// Read-only formal staging UI/Places check. Existing Demo login only; no form submit.
/* global document, innerWidth */
const fs = require('node:fs'),
  assert = require('node:assert/strict')
const {
  chromium,
} = require('./artifacts/browser-tools/node_modules/playwright-core')
const base = 'http://localhost:3000'
async function run() {
  const credentials = JSON.parse(
    fs.readFileSync('tests/artifacts/staging-demo/credentials.json', 'utf8')
  )
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    const context = await browser.newContext(),
      account = credentials['seller-a']
    const login = await context.request.post(base + '/api/auth/sign-in', {
      headers: { Origin: base, 'X-Marketplace-Request': '1' },
      data: { email: account.email, password: account.password },
    })
    assert.equal(login.status(), 200, 'Existing staging Demo sign-in succeeds')
    const p = await context.newPage(),
      errors = []
    p.on('pageerror', (e) => errors.push(e.message))
    await p.goto(base + '/listings/new')
    await p
      .getByLabel('Meeting location', { exact: true })
      .waitFor({ timeout: 60000 })
    for (const width of [390, 430, 820, 1280, 1536]) {
      await p.setViewportSize({ width, height: 900 })
      const input = p.getByLabel('Meeting location', { exact: true })
      assert.equal(
        await p.getByRole('combobox', { name: 'Place', exact: true }).count(),
        0
      )
      assert.equal(await input.getAttribute('required'), '')
      await input.fill('Western University')
      const response = await p.waitForResponse(
        (r) => r.url() === base + '/api/places/autocomplete',
        { timeout: 20000 }
      )
      assert.equal(response.status(), 200, 'Live Google autocomplete succeeds')
      const data = await response.json()
      assert(data.suggestions.length > 0)
      assert.deepEqual(Object.keys(data.suggestions[0]).sort(), [
        'displayText',
        'placeId',
        'primaryText',
        'secondaryText',
      ])
      const options = p.getByRole('option')
      await options.first().waitFor()
      const box = await p.getByRole('listbox').locator('..').boundingBox()
      assert(
        box.x >= 0 &&
          box.x + box.width <= width &&
          box.y >= 0 &&
          box.y + box.height <= 900
      )
      const details = p.waitForResponse(
        (r) => r.url() === base + '/api/places/details'
      )
      await options.first().click()
      const detail = await details
      assert.equal(detail.status(), 200)
      assert.deepEqual(Object.keys(await detail.json()).sort(), [
        'displayName',
        'formattedAddress',
        'placeId',
      ])
      assert.equal(await input.inputValue(), data.suggestions[0].primaryText)
      await input.fill('User confirmed front entrance')
      await input.press('Tab')
      const fulfillment = p.getByRole('combobox', {
        name: 'Preferred fulfillment',
        exact: true,
      })
      await fulfillment.click()
      await p.getByRole('option', { name: 'Delivery', exact: true }).click()
      assert.equal(await input.getAttribute('required'), '')
      const estimate = p.getByLabel('Estimated delivery fee (CA$)', {
        exact: true,
      })
      await estimate.fill('10.50')
      await fulfillment.click()
      await p.getByRole('option', { name: 'Meeting', exact: true }).click()
      assert.equal(await estimate.count(), 0)
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        ),
        true
      )
      console.log(
        'PASS formal staging Create Listing ' +
          width +
          ': actual Google autocomplete/details, minimal DTO, editable suggestion text, viewport bounds; no save'
      )
    }
    assert.deepEqual(errors, [])
    await context.close()
  } finally {
    await browser.close()
  }
}
run().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
