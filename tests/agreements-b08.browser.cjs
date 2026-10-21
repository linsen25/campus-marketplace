// Reuse existing offline UI fixtures, but write ONLY a fresh ignored scratch dir.
/* global window, document */
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const root = fs.mkdtempSync(
  path.resolve('tests/artifacts/agreements-b08-browser-')
)
const fixtureModule = { exports: {} }
const fixtureSource = fs
  .readFileSync('tests/message-payload.browser.cjs', 'utf8')
  .replace(
    "const root = path.resolve('tests/artifacts/message-payload-qualification')",
    'const root = ' + JSON.stringify(root)
  )
function localRequire(name) {
  if (name === './message-payload.browser.cjs') return fixtureModule.exports
  return require(name)
}
localRequire.resolve = require.resolve
new Function('require', 'module', 'exports', fixtureSource)(
  localRequire,
  fixtureModule,
  fixtureModule.exports
)
const existing = fs.readFileSync(
  'tests/order-agreement-handoff.browser.cjs',
  'utf8'
)
new Function(
  'require',
  existing.slice(0, existing.indexOf('async function run()'))
)(localRequire)
async function main() {
  const aliases = require('./browser-fixture-mocks.cjs')(root)
  fs.writeFileSync(
    path.join(root, 'link-mock.tsx'),
    'export const Link=({children,...props})=><a {...props}>{children}</a>'
  )
  aliases['@ui/link/link'] = path.join(root, 'link-mock.tsx')
  await fixtureModule.exports.build(aliases)
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const width of [390, 430, 820, 1280, 1536]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        reducedMotion: 'reduce',
      })
      page.setDefaultTimeout(8000)
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.route(/^https?:/, (r) => r.abort())
      await page.goto(
        'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      await page.evaluate(() =>
        window.setScenario({ mode: 'campus', viewer: 'buyer', phase: 'review' })
      )
      await page
        .locator('[data-current-step]:not([data-current-step="loading"])')
        .waitFor()
      assert(
        await page
          .getByRole('button', { name: 'Next', exact: true })
          .isDisabled()
      )
      await page
        .getByRole('button', { name: 'Confirm Agreement', exact: true })
        .click()
      await page
        .getByText(/Agreement confirmed. Waiting for the Seller/)
        .waitFor()
      assert(
        await page
          .getByRole('button', { name: 'Next', exact: true })
          .isDisabled()
      )
      await page.evaluate(() => {
        window.model.viewer = 'seller'
        window.renderModel()
      })
      await page
        .getByRole('button', { name: 'Confirm Agreement', exact: true })
        .click()
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-formal-order]')
            ?.getAttribute('data-order-page') === 'payment'
      )
      assert.deepEqual(errors, [])
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      )
      console.log(
        `PASS B08 offline browser ${width}: existing Buyer waiting state; only dual confirmation advances to Payment; no overflow`
      )
      await page.close()
    }
  } finally {
    await browser.close()
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
