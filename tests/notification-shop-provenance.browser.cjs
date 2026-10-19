/* global window, document */
// Real Notification Center/provider; offline enriched DTOs only. Popup remains generic.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const source = fs.readFileSync('tests/notification-bell.browser.cjs', 'utf8')
new Function('require', source.slice(0, source.indexOf(';(async () =>')))(
  require
)
const aliases = require('./browser-fixture-mocks.cjs')(root)
aliases['@/components/listings/marketplace-session'] = path.join(
  root,
  'notification-mock.js'
)
aliases['@/lib/messages-realtime'] = path.join(root, 'notification-mock.js')
fs.appendFileSync(
  path.join(root, 'entry.tsx'),
  `
window.setup=()=>{window.writes=0;window.posts=[];window.feed={unreadCount:54,notifications:Array.from({length:54},(_,i)=>({id:'00000000-0000-4000-8000-'+String(9000-i).padStart(12,'0'),event_type:i===0?'new_message':i===5?'price_drop':i===6?'payout_needs_attention':'payment_paid',created_at:'2026-10-17T00:00:00Z',read_at:null,destination:i===0?{section:'messages',conversationId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',destination:'buying'}:i===5?{section:'listing',listingId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}:i===6?{section:'settings',panel:'payments-payouts'}:{section:'orders',orderId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',destination:'purchases'},...(i<3?{listingProvenance:{channel:'shop',shopName:i===0?'Vintage Loop':i===1?'Chris Vintage':'LongShopNameWithoutSpacesABCDEFGHIJKLMNO'}}:{})}))};window.show('buyer')};
`
)
;(async () => {
  await build(aliases)
  for (const n of ['entry.tsx', 'api.ts']) fs.unlinkSync(path.join(root, n))
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const b = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const width of [390, 430, 820, 1280, 1536])
      for (const reducedMotion of ['reduce', 'no-preference']) {
        const p = await b.newPage({
          viewport: { width, height: 900 },
          reducedMotion,
        })
        p.setDefaultTimeout(6000)
        const errors = []
        p.on('pageerror', (e) => errors.push(e.message))
        await p.addInitScript(() => (window.process = { env: {} }))
        await p.route(/^https?:/, (r) => r.abort())
        await p.goto(
          'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
        )
        await p.evaluate(() => window.setup())
        const feed = p.getByRole('region', {
          name: 'Notifications feed',
          exact: true,
        })
        await feed
          .getByText('Vintage Loop \u00b7 Shop', { exact: true })
          .waitFor()
        await feed
          .getByText('Chris Vintage \u00b7 Shop', { exact: true })
          .waitFor()
        assert.equal(await feed.locator('li').count(), 50)
        assert.equal(await feed.getByText(/\u00b7 Shop/).count(), 3)
        assert.equal(await p.getByText('PRO', { exact: true }).count(), 0)
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        )
        await feed
          .getByRole('button', {
            name: 'Open notification: New message',
            exact: true,
          })
          .click()
        const detail = p.getByRole('dialog')
        await detail
          .getByText('Vintage Loop \u00b7 Shop', { exact: true })
          .waitFor()
        assert.equal(await p.evaluate(() => window.writes), 1)
        await p.waitForTimeout(reducedMotion === 'reduce' ? 30 : 220)
        const box = await detail.boundingBox()
        assert(Math.abs(box.x + box.width / 2 - width / 2) < 2)
        assert(Math.abs(box.y + box.height / 2 - 450) < 2)
        await detail.evaluate((node) => {
          const body = node.querySelector('h3').parentElement.querySelector('p')
          body.textContent = Array(100)
            .fill('Long notification content for layout stress testing.')
            .join(' ')
        })
        const longBox = await detail.boundingBox()
        assert(longBox.height <= 766 && longBox.y >= 0)
        assert(Math.abs(longBox.y + longBox.height / 2 - 450) < 2)
        const content = detail.locator('h3').locator('..')
        assert(
          await content.evaluate(
            (node) => node.scrollHeight > node.clientHeight
          )
        )
        await content.evaluate((node) => (node.scrollTop = node.scrollHeight))
        const closeBox = await detail
          .getByRole('button', { name: 'Close', exact: true })
          .boundingBox()
        assert(
          closeBox.y >= longBox.y &&
            closeBox.y + closeBox.height <= longBox.y + longBox.height
        )
        await detail.getByRole('button', { name: 'Close', exact: true }).focus()
        await p.keyboard.press('Tab')
        await p.keyboard.press('Tab')
        assert(
          await detail.evaluate((node) =>
            node.contains(document.activeElement)
          ),
          'focus remains trapped'
        )

        await detail.getByRole('button', { name: 'Close', exact: true }).click()
        await detail.waitFor({ state: 'hidden' })
        await p
          .getByRole('button', {
            name: 'Notifications, 53 unread',
            exact: true,
          })
          .waitFor()
        await feed
          .getByRole('button', { name: 'Load more', exact: true })
          .click()
        await p.waitForFunction(
          () => document.querySelectorAll('li').length === 53
        )
        assert.equal(
          await feed
            .getByText('Vintage Loop \u00b7 Shop', { exact: true })
            .count(),
          0
        )
        await feed
          .getByText('Chris Vintage \u00b7 Shop', { exact: true })
          .waitFor()
        await feed
          .getByRole('button', {
            name: 'Open notification: Payment confirmed',
            exact: true,
          })
          .first()
          .click()
        await p
          .getByRole('dialog')
          .getByRole('button', { name: 'Open in app', exact: true })
          .click()
        await p.waitForFunction(() =>
          window.actions.at(-1)?.includes('section=orders')
        )
        assert.deepEqual(errors, [])
        await p.close()
        console.log(
          'PASS',
          width,
          reducedMotion,
          'feed/detail frozen Shop, long name, generic fallback, read/unread, load more and original Order navigation'
        )
      }
  } finally {
    await b.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
