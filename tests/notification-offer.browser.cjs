/* global window */
// Actual OfferCard notification entry, offline data and callbacks only.
const fs = require('fs'),
  path = require('path'),
  assert = require('assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const source = fs.readFileSync(
  'tests/messages-offer-correction.browser.cjs',
  'utf8'
)
new Function(
  'require',
  source.slice(0, source.indexOf('async function run()'))
)(require)
const entry = path.join(root, 'entry.tsx')
fs.writeFileSync(
  entry,
  fs
    .readFileSync(entry, 'utf8')
    .replace(
      'const card=<OfferCard',
      'const card=<OfferCard notificationEntry={v.deepLink?offer.id:undefined}'
    )
)
;(async () => {
  await build(require('./browser-fixture-mocks.cjs')(root))
  for (const n of ['entry.tsx', 'api.ts']) fs.unlinkSync(path.join(root, n))
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const width of [390, 430, 820, 1280, 1536]) {
      const p = await browser.newPage({ viewport: { width, height: 900 } })
      await p.addInitScript(() => (window.process = { env: {} }))
      await p.route(/^https?:/, (r) => r.abort())
      await p.goto(
        'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      for (const status of ['Active', 'Replaced', 'Accepted', 'Expired']) {
        await p.evaluate(
          (status) =>
            window.showCase({
              viewer: 'buyer',
              sender: 'seller',
              status,
              deepLink: true,
            }),
          status
        )
        await p.getByRole('dialog').waitFor()
        assert.equal(await p.getByRole('dialog').count(), 1)
        assert.deepEqual(
          await p.evaluate(() => window.actions),
          [],
          'Opening a notification must not mutate'
        )
      }
      console.log(
        'PASS Offer notification opens exact current/historical detail without mutation at ' +
          width
      )
      await p.close()
    }
  } finally {
    await browser.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
