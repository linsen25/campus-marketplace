/* global window, document */
// B27-B browser qualification: real notification components, local API/session/Realtime only.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)

const session = path.join(root, 'b27-notification-session.js')
fs.writeFileSync(
  session,
  `export function useMarketplaceSession(){return {seller:window.user?{id:window.user}:null}};export function connectMessagesRealtime(id,on,recover,end,notify){window.signal=notify;window.channels++;return ()=>window.channels--}`
)
aliases['@/components/listings/marketplace-session'] = session
aliases['@/lib/messages-realtime'] = session

fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {LazyMotion,domAnimation} from 'framer-motion';import {NotificationsProvider} from '@/components/notifications/notification-state';import {NotificationsView} from '@/components/notifications/notifications-view';
const root=createRoot(document.getElementById('root'));window.channels=0;window.actions=[];window.feed=[];window.user=null;window.writes=0;
window.show=user=>{window.user=user;flushSync(()=>root.render(<LazyMotion features={domAnimation}><NotificationsProvider><NotificationsView/></NotificationsProvider></LazyMotion>))};
window.fixtureRequest=async(url,method,input)=>{if(url==='/api/notification-preferences')return {inApp:true,sounds:false,email:false};if(method==='POST'){window.writes++;if(input.id){const item=window.feed.find(n=>n.id===input.id);if(item)item.read_at||=new Date().toISOString();return {id:input.id,readAt:item?.read_at||new Date().toISOString()}}return {unreadCount:window.feed.filter(n=>!n.read_at).length}}return {notifications:structuredClone(window.feed),unreadCount:window.feed.filter(n=>!n.read_at).length,hasMore:false}};
window.emit=value=>{window.feed.unshift(value);window.signal({changed:true,inserted:true,notification:value})};
document.body.style.background='#0b0b0b';document.body.style.color='#f5f5f5';
`
)

const events = [
  [
    'shop_trial_activated',
    'Shop trial activated',
    'SYSTEM',
    { section: 'shop', destination: 'my-shop' },
  ],
  [
    'shop_membership_access_started',
    'Shop membership active',
    'SYSTEM',
    { section: 'shop', destination: 'my-shop' },
  ],
  [
    'shop_membership_access_upgraded',
    'Shop membership upgraded',
    'SYSTEM',
    { section: 'shop', destination: 'my-shop' },
  ],
  [
    'shop_suspended',
    'Shop temporarily suspended',
    'SYSTEM',
    { section: 'shop', destination: 'my-shop' },
  ],
  [
    'shop_reopened',
    'Shop reopened',
    'SYSTEM',
    { section: 'shop', destination: 'my-shop' },
  ],
  [
    'order_refund_succeeded',
    'Refund confirmed',
    'ORDER',
    {
      section: 'orders',
      destination: 'purchases',
      orderId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
  ],
  [
    'order_refund_failed',
    'Refund unsuccessful',
    'ORDER',
    {
      section: 'orders',
      destination: 'purchases',
      orderId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
  ],
  [
    'order_refund_unresolved',
    'Refund status needs review',
    'ORDER',
    {
      section: 'orders',
      destination: 'purchases',
      orderId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
  ],
  [
    'seller_transfer_succeeded',
    'Seller transfer confirmed',
    'ORDER',
    {
      section: 'orders',
      destination: 'sales',
      orderId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    },
  ],
  [
    'seller_transfer_failed',
    'Seller transfer unsuccessful',
    'ORDER',
    {
      section: 'orders',
      destination: 'sales',
      orderId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    },
  ],
  [
    'seller_transfer_unresolved',
    'Seller transfer status needs review',
    'ORDER',
    {
      section: 'orders',
      destination: 'sales',
      orderId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    },
  ],
  [
    'seller_transfer_reversed',
    'Seller transfer reversed',
    'ORDER',
    {
      section: 'orders',
      destination: 'sales',
      orderId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    },
  ],
  [
    'seller_transfer_partially_reversed',
    'Seller transfer partly reversed',
    'ORDER',
    {
      section: 'orders',
      destination: 'sales',
      orderId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    },
  ],
  [
    'connected_bank_payout_paid',
    'Bank payout marked paid',
    'SYSTEM',
    { section: 'settings', panel: 'payments-payouts' },
  ],
  [
    'connected_bank_payout_failed',
    'Bank payout failed',
    'SYSTEM',
    { section: 'settings', panel: 'payments-payouts' },
  ],
  [
    'connected_bank_payout_canceled',
    'Bank payout canceled',
    'SYSTEM',
    { section: 'settings', panel: 'payments-payouts' },
  ],
]

async function main() {
  await build(aliases)
  for (const name of ['entry.tsx', 'api.ts'])
    fs.unlinkSync(path.join(root, name))
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  let passed = 0
  try {
    for (const reducedMotion of ['no-preference', 'reduce'])
      for (const width of [390, 430, 820, 1280, 1536]) {
        const page = await browser.newPage({
          viewport: { width, height: 900 },
          reducedMotion,
          serviceWorkers: 'block',
        })
        const errors = []
        page.on('pageerror', (error) => errors.push(error.message))
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(message.text())
        })
        await page.route(/^https?:/, (route) => route.abort())
        await page.goto(
          'file://' + path.join(root, 'index.html').replaceAll('\\', '/')
        )
        await page.evaluate((values) => {
          window.feed = values.map(([event_type, , , destination], index) => ({
            id: `00000000-0000-4000-8000-${String(index + 1).padStart(
              12,
              '0'
            )}`,
            event_type,
            destination,
            created_at: new Date(Date.now() - index * 1000).toISOString(),
            read_at: null,
          }))
          window.show('b27-owner')
        }, events)
        await page
          .getByRole('button', {
            name: 'Open notification: Shop trial activated',
            exact: true,
          })
          .waitFor()
        assert.equal(
          await page.getByText('Transaction update', { exact: true }).count(),
          0,
          'no generic fallback'
        )
        for (const [, title, category] of events) {
          const row = page.getByRole('button', {
            name: `Open notification: ${title}`,
            exact: true,
          })
          await row.waitFor()
          assert.match(await row.innerText(), new RegExp(`^${category}\\s`))
        }
        const shop = page.getByRole('button', {
          name: 'Open notification: Shop trial activated',
          exact: true,
        })
        await shop.click()
        await page.getByRole('button', { name: 'Open in app' }).click()
        await page.waitForFunction(() => window.actions.length === 1)
        assert.equal(
          await page.evaluate(() => window.actions.at(-1)),
          '/home?section=my-shop'
        )
        await page
          .getByRole('button', { name: 'Close notification detail' })
          .click()
        const payout = page.getByRole('button', {
          name: 'Open notification: Bank payout failed',
          exact: true,
        })
        await payout.click()
        await page.getByRole('button', { name: 'Open in app' }).click()
        await page.waitForFunction(() => window.actions.length === 2)
        assert.equal(
          await page.evaluate(() => window.actions.at(-1)),
          '/home?section=settings&focus=payments-payouts'
        )
        await page
          .getByRole('button', { name: 'Close notification detail' })
          .click()
        const popupValue = {
          id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          event_type: 'seller_transfer_succeeded',
          destination: {
            section: 'orders',
            destination: 'sales',
            orderId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          },
          created_at: new Date().toISOString(),
          read_at: null,
        }
        await page.evaluate((value) => window.emit(value), popupValue)
        const popup = page
          .getByRole('complementary', { name: 'New notifications' })
          .getByRole('button', {
            name: 'Open notification: Seller transfer confirmed',
            exact: true,
          })
        await popup.waitFor()
        await page.evaluate(
          (value) =>
            window.signal({
              changed: true,
              inserted: true,
              notification: value,
            }),
          popupValue
        )
        await page.waitForTimeout(80)
        assert.equal(
          await popup.count(),
          1,
          'duplicate broadcast is deduplicated'
        )
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          ),
          'no horizontal overflow'
        )
        assert.deepEqual(errors, [])
        assert.equal(await page.evaluate(() => window.channels), 1)
        await page.evaluate(() => window.show(null))
        assert.equal(await page.evaluate(() => window.channels), 0)
        passed++
        console.log(`PASS B27-B browser ${width}px ${reducedMotion}`)
        await page.close()
      }
  } finally {
    await browser.close()
  }
  assert.equal(passed, 10)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
