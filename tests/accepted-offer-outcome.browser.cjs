// Actual Messages -> OfferCard wiring with independent authoritative fixture relations.
/* global window, document, getComputedStyle, Event */
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const original = fs.readFileSync(
  path.join(__dirname, 'messages-focused-mobile.browser.cjs'),
  'utf8'
)
new Function(
  'require',
  original.slice(0, original.indexOf('async function run()'))
)(require)
let entry = fs.readFileSync(path.join(root, 'entry.tsx'), 'utf8')
entry = entry.replace(
  'window.show=(destination)=>{',
  'window.show=(destination)=>{window.fixtureRevision=(window.fixtureRevision||0)+1;'
)
entry = entry.replace(
  'key={destination}',
  "key={destination+'-'+window.fixtureRevision}"
)
entry = entry.replace(
  'window.offerHistory={offers:[],agreements:[]};',
  `
const terms={itemAmountCents:8000,currency:'CAD',note:'',fulfillment:'on_campus',meetupLocation:'Weldon',scheduledAt:'2099-10-01T12:00:00Z'};
const cases=['cancelled','open','completed','expired','unmatched','Active','Replaced','Declined','Closed','Expired'];
const offers=cases.flatMap((state,i)=>['buyer','seller'].map(sender=>({id:state+'-'+sender,protocolVersion:2,conversationId:'conversation-'+destination,listingId:'listing',buyerId:'buyer',sellerId:'seller',senderId:sender,recipientId:sender==='buyer'?'seller':'buyer',status:i<5?'Accepted':state,terms,askingPriceCents:8000,linkedOrderId:i<5?'order-'+state+'-'+sender:null,canWithdraw:false,canAccept:false,changedFields:['Price'],mutationKind:'create',createdAt:new Date(Date.parse('2026-10-01T12:01:00Z')+i*60000).toISOString()})));
const agreements=offers.filter(o=>o.linkedOrderId&&!o.id.startsWith('unmatched')).map(o=>({id:o.linkedOrderId,offerId:o.id,createdAt:o.createdAt,status:o.id.split('-')[0],listingTitle:'Frozen item',buyerId:'buyer',sellerId:'seller',terms})).reverse();
// Same-looking Order with wrong offerId must not be treated as a match.
agreements.push({id:'order-unmatched-buyer',offerId:'not-this-offer',createdAt:'2026-10-01T13:00:00Z',status:'cancelled',listingTitle:'Frozen item',buyerId:'buyer',sellerId:'seller',terms});
window.offerHistory={offers,agreements};window.historyBefore=JSON.stringify(window.offerHistory);
`
)
fs.writeFileSync(path.join(root, 'entry.tsx'), entry)
async function run() {
  const aliases = require('./browser-fixture-mocks.cjs')(root)
  const names = [
    '@/components/listings/marketplace-session',
    '@/components/loader/loader',
    '@/components/navigation/desktop-route-transition',
    '@/components/home/order-visual-context',
    '@/hooks/use-formal-order-requests',
    '@/hooks/use-formal-offers',
    '@/lib/messages-realtime',
    '@/lib/messages-api',
  ]
  names.forEach(
    (name, i) => (aliases[name] = path.join(root, 'focused-' + i + '.js'))
  )
  aliases['./order-visual-context'] =
    aliases['@/components/home/order-visual-context']
  await build(aliases)
  for (const n of ['entry.tsx', 'api.ts']) fs.unlinkSync(path.join(root, n))
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  let count = 0
  try {
    for (const width of [390, 430, 1280, 1536]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        reducedMotion: 'reduce',
      })
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.route(/^https?:/, (r) => r.abort())
      await page.addInitScript(
        () =>
          (window.process = {
            env: {
              NEXT_PUBLIC_MESSAGES_ENV: 'staging',
              NEXT_PUBLIC_SUPABASE_URL:
                'https://pcaqxezdfxofysghssyo.supabase.co',
            },
          })
      )
      await page.goto(
        'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      for (const destination of ['buying', 'selling']) {
        for (let remount = 0; remount < 2; remount++) {
          await page.evaluate((v) => window.show(v), destination)
          if (width < 1024) await page.locator('[data-conversation-id]').click()
          await page.locator('[data-offer-id]').first().waitFor()
          for (const state of [
            'cancelled',
            'open',
            'completed',
            'expired',
            'unmatched',
            'Active',
            'Replaced',
            'Declined',
            'Closed',
            'Expired',
          ])
            for (const sender of ['buyer', 'seller']) {
              const card = page.locator(
                '[data-offer-id="' + state + '-' + sender + '"]'
              )
              await card.scrollIntoViewIfNeeded()
              const values = await card.evaluate((e) => {
                const body = e.querySelector('[class*="offerButton"]'),
                  badge = e.querySelector('[class*="offerStatus"]')
                const measure = () =>
                  [e, body, ...body.children, badge].map((n) => {
                    const r = n.getBoundingClientRect()
                    return [r.x, r.y, r.width, r.height]
                  })
                const before = measure()
                const color = getComputedStyle(badge).backgroundColor
                badge.style.backgroundColor = '#166534'
                const after = measure()
                badge.style.removeProperty('background-color')
                return {
                  label: badge.textContent,
                  color,
                  body: getComputedStyle(body).backgroundColor,
                  outline: getComputedStyle(body).outlineColor,
                  gap:
                    body.getBoundingClientRect().top -
                    badge.getBoundingClientRect().bottom,
                  before,
                  after,
                  own: e.dataset.offerOwn,
                }
              })
              const accepted = [
                'cancelled',
                'open',
                'completed',
                'expired',
                'unmatched',
              ].includes(state)
              assert.equal(
                values.label,
                accepted
                  ? 'Accepted'
                  : state === 'Closed'
                  ? 'No longer available'
                  : state
              )
              const red = accepted
                ? ['cancelled', 'expired'].includes(state)
                : state !== 'Active'
              assert.equal(
                values.color,
                red ? 'rgb(185, 28, 28)' : 'rgb(22, 101, 52)'
              )
              assert.equal(values.gap, 4)
              assert.deepEqual(values.before, values.after)
              if (accepted || state !== 'Active') {
                assert.equal(values.body, 'rgb(33, 30, 40)')
                assert.equal(
                  values.outline,
                  values.own === 'true'
                    ? 'rgb(96, 165, 250)'
                    : 'rgb(119, 84, 151)'
                )
              }
              count++
            }
          assert.equal(
            await page.evaluate(() => JSON.stringify(window.offerHistory)),
            await page.evaluate(() => window.historyBefore)
          )
          assert.equal(await page.evaluate(() => window.sends), 0)
          assert(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth
            )
          )
        }
        // Refetched server history changes color without changing Offer.status or local badge state.
        await page.evaluate(() => {
          window.offerHistory = {
            ...window.offerHistory,
            agreements: window.offerHistory.agreements.map((a) =>
              a.id === 'order-open-buyer' ? { ...a, status: 'cancelled' } : a
            ),
          }
          window.dispatchEvent(new Event('marketplace-messages-invalidated'))
        })
        await page.waitForFunction(() => {
          const badge = document.querySelector(
            '[data-offer-id="open-buyer"] [class*="offerStatus"]'
          )
          return (
            badge &&
            getComputedStyle(badge).backgroundColor === 'rgb(185, 28, 28)'
          )
        })
        assert.equal(
          await page
            .locator('[data-offer-id="open-buyer"] [class*="offerStatus"]')
            .textContent(),
          'Accepted'
        )
        assert.equal(
          await page
            .locator('[data-offer-id="completed-buyer"] [class*="offerStatus"]')
            .evaluate((e) => getComputedStyle(e).backgroundColor),
          'rgb(22, 101, 52)'
        )
      }
      assert.deepEqual(errors, [])
      console.log(
        'PASS ' +
          width +
          ': exact per-Offer Order relation; independent cancelled/open/completed/expired; Buyer/Seller/remount/refetch; Accepted label/gray body/outlines and geometry unchanged.'
      )
      await page.close()
    }
    console.log(
      'PASS ' + count + ' badge cases, offline only; no hosted mutations.'
    )
  } finally {
    await browser.close()
  }
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
