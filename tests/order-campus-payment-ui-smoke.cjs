const assert = require('node:assert/strict'), path = require('node:path')
const h = require('./order-meetup-fixtures.cjs')
const { chromium } = require('./artifacts/browser-tools/node_modules/playwright-core')
const origin = 'http://localhost:3000'
;(async () => {
  const baseline = await h.fingerprint(), contexts = [], errors = []
  let browser, failure
  try {
    await h.setup()
    await h.capability('set', 1, 'payment_method')
    const f = await h.accepted('on_campus', true)
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
    const pages = []
    for (const i of [1, 0]) {
      const c = await browser.newContext({viewport: {width:1280,height:900}, timezoneId:'America/Toronto'})
      contexts.push(c)
      await c.addInitScript(() => { const interval = window.setInterval.bind(window); window.setInterval = (fn,ms,...args) => interval(ms === 15000 ? () => {} : fn, ms, ...args) })
      const r = await c.request.post(origin+'/api/auth/sign-in', {headers: {Origin:origin,'X-Marketplace-Request':'1'},data:h.accounts[i]})
      assert.equal(r.status(),200)
      const p=await c.newPage(); pages.push(p)
      p.on('pageerror',e=>errors.push(e.message))
      await p.goto(origin+'/home?section=orders&destination='+(i===1?'purchases':'sales')+'&order='+f.order.id)
      await p.locator('[data-campus-payment="pending"]').waitFor({timeout:60000})
    }
    const [buyer,seller]=pages
    await buyer.getByRole('button',{name:'Continue to payment',exact:true}).click()
    await seller.locator('[data-campus-payment]').getByText('The Buyer has inspected the item and chosen to continue to payment.',{exact:true}).waitFor({timeout:45000})
    await buyer.getByRole('button',{name:'Pay (staging test)',exact:true}).click()
    for (const p of pages) {
      await p.locator('[data-campus-payment="paid"]').waitFor({timeout:45000})
      assert.equal(await p.getByRole('button',{name:'Cancel Order',exact:true}).count(),0)
      assert.equal(await p.getByRole('button',{name:'Pay (staging test)',exact:true}).count(),0)
      for(const width of [390,430,1280,1536]) {
        await p.setViewportSize({width,height:900})
        await p.waitForTimeout(800)
        const card=p.locator('[data-campus-payment="paid"]')
        await card.waitFor({timeout:10000})
        await card.scrollIntoViewIfNeeded()
        const box=await card.boundingBox()
        assert(box && box.x>=0 && box.x+box.width<=width+1)
        await card.screenshot({path:path.join(h.root,`d2a-paid-card-${p===buyer?'buyer':'seller'}-${width}.png`)})
      }
    }
    const state=(await h.query(`select o.lifecycle_status,o.payment_status,o.payout_status,l.status listing,(select count(*) from marketplace_private.campus_payment_attempts where order_id=o.id) attempts,(select count(*) from public.transaction_events where order_id=o.id and event_type='payment_paid') paid_events from public.orders o join public.listings l on l.id=o.listing_id where o.id=${h.q(f.order.id)};`))[0]
    assert.equal(state.lifecycle_status,'open');assert.equal(state.payment_status,'paid');assert.equal(state.payout_status,'not_eligible');assert.equal(state.listing,'pending');assert.equal(state.attempts,1);assert.equal(state.paid_events,1);assert.deepEqual(errors,[])
    console.log(JSON.stringify({freshBuyerUiPay:true, sellerRealtimePaid:true, pollingDisabled:true, visiblePaidCards:'390/430/1280/1536',runtimeErrors:errors.length,...state}))
  } catch(e) {failure=e} finally {
    for(const c of contexts) await c.close()
    if(browser) await browser.close()
    await h.cleanup()
    assert.deepEqual(await h.fingerprint(),baseline)
  }
  if(failure) throw failure
  console.log('PASS fresh Pending Buyer UI inspection/Pay, Seller private update, visible payment-card matrix, exact synthetic cleanup')
})().catch(e=>{console.error(e.message);process.exitCode=1})
