/* global window */
// Real B21 Buyer component with local API/Stripe mocks; no network or provider call.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)

fs.writeFileSync(
  path.join(root, 'b21-mocks.jsx'),
  `
export const useRouter=()=>({push:async()=>{}});
export const useFinancialCapabilities=()=>({data:{paymentMethod:{status:'set'}},error:null,refresh:async()=>{window.capabilityRefreshes++}});
export const mutateCampusOrder=async()=>{window.starts++;if(window.holdStart)await new Promise(r=>window.releaseStart=r);return window.startResult};
export const getStripeClient=async()=>({confirmCardPayment:async(secret)=>{window.confirms++;window.secret=secret;if(window.confirmError)return {error:{type:window.confirmError}};return {paymentIntent:{id:'pi_Order',status:window.confirmStatus}}}});
`
)
aliases['next/router'] = path.join(root, 'b21-mocks.jsx')
aliases['@/hooks/use-financial-capabilities'] = path.join(root, 'b21-mocks.jsx')
aliases['@/lib/orders-api'] = path.join(root, 'b21-mocks.jsx')
aliases['@/lib/stripe-client'] = path.join(root, 'b21-mocks.jsx')

fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import React from 'react';import {createRoot} from 'react-dom/client';import {OrderCampusPayment} from '@/components/home/order-campus-payment';
const order={id:'21222222-2222-4222-8222-222222222222',requestId:'r',conversationId:'c',listingId:'l',buyerId:'b',sellerId:'s',snapshot:{listing:{id:'l',liveId:'l',title:'Item',price:10000,currency:'CAD',category:'Other',availability:'unavailable',photoUrls:[]},draft:{price:10000,fulfillment:'shipping',location:'',scheduleMode:'tbd',shippingCost:'included',shippingFee:null,shippingMethod:'',note:''},buyer:'Buyer',seller:'Seller'},lifecycle:'open',holdsListing:true,moneyStatus:'finalized',paymentStatus:'pending',paymentPaidAt:null,payoutStatus:'not_eligible',fulfillmentStatus:'awaiting_payment',itemAmount:10000,shippingAmount:0,serviceFee:825,totalAmount:10825,createdAt:new Date().toISOString(),reservationStartedAt:null,reservationExpiresAt:null,campusPayment:{inspectionConfirmedAt:new Date().toISOString(),itemCents:10000,feeCents:825,totalCents:10825,feeRule:'test'}};
window.starts=0;window.confirms=0;window.refreshes=0;window.capabilityRefreshes=0;window.confirmStatus='succeeded';window.startResult={order:{...order,paymentStatus:'processing'},serverTime:new Date().toISOString(),paymentConfirmation:{orderId:order.id,attemptId:'a',paymentIntentId:'pi_Order',clientSecret:'pi_Order_secret_Synthetic',nextAction:'confirm'}};
createRoot(document.getElementById('root')).render(<OrderCampusPayment order={order} role="buyer" onRefresh={async()=>{window.refreshes++}} onUpdated={(value)=>{window.updated=value.paymentStatus}}/>);
`
)

async function main() {
  await build(aliases)
  for (const file of ['entry.tsx', 'api.ts'])
    if (fs.existsSync(path.join(root, file)))
      fs.unlinkSync(path.join(root, file))
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    const page = await browser.newPage({
      viewport: { width: 430, height: 800 },
    })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route(/^https?:/, (route) => route.abort())
    await page.goto(
      'file://' + path.join(root, 'index.html').replaceAll('\\', '/')
    )
    const pay = page.getByRole('button', { name: 'Pay by UU', exact: true })
    await pay.waitFor()
    await page.evaluate(() => {
      window.holdStart = true
    })
    await pay.click({ noWaitAfter: true })
    await page.waitForFunction(() => window.starts === 1)
    await page.evaluate(() =>
      document
        .querySelector('button')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    )
    assert.equal(await page.evaluate(() => window.starts), 1)
    await page.evaluate(() => window.releaseStart())
    await page.waitForFunction(() => window.confirms === 1)
    assert.equal(
      await page.evaluate(() => window.secret),
      'pi_Order_secret_Synthetic'
    )
    assert.equal(await page.evaluate(() => window.updated), 'processing')
    assert.equal(
      await page.getByRole('heading', { name: 'Payment confirmed' }).count(),
      0
    )
    assert.equal(await page.evaluate(() => window.refreshes), 1)
    assert.deepEqual(errors, [])
    console.log(
      'PASS B21 Buyer Pay normal click, duplicate-submit guard, Stripe.js confirmation, authoritative refresh, and no client-side Paid projection'
    )
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
