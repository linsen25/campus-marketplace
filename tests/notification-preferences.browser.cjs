/* global window, document, sessionStorage, getComputedStyle */
// Real Provider, Settings, supplied switch and popups; only session/API/Broadcast mocked.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
const session = path.join(root, 'preferences-session.js')
fs.writeFileSync(
  session,
  `export function useMarketplaceSession(){return {seller:window.user?{id:window.user}:null}};export function connectMessagesRealtime(id,on,recover,end,notify){window.signal=notify;window.reconnect=recover;window.end=end;window.channels++;return ()=>window.channels--}`
)
aliases['@/components/listings/marketplace-session'] = session
aliases['@/lib/messages-realtime'] = session
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {LazyMotion,domAnimation} from 'framer-motion';import {NotificationsProvider} from '@/components/notifications/notification-state';import {NotificationSettings} from '@/components/notifications/notification-settings';import {NotificationBell} from '@/components/notifications/notification-bell';
const root=createRoot(document.getElementById('root'));window.channels=0;window.actions=[];window.writes=0;window.store=JSON.parse(sessionStorage.getItem('preferenceStore')||'{}');window.feed=[];
window.show=user=>{window.user=user;flushSync(()=>root.render(<LazyMotion features={domAnimation}><NotificationsProvider><NotificationBell/><NotificationSettings/></NotificationsProvider></LazyMotion>))};
document.body.style.background='#0b0b0b';document.body.style.color='white';
window.fixtureRequest=async(url,method,input)=>{const owner=window.user;await new Promise(r=>setTimeout(r,30));if(url==='/api/notification-preferences'){window.store[owner]||={inApp:true,sounds:false,email:true};if(method==='POST'){if(window.failSave){window.failSave=false;throw Error('Controlled save failure')}window.store[owner][input.key]=input.value;window.writes++;}return {...window.store[owner]}}if(method==='POST'){const n=window.feed.find(n=>n.id===input.id);n.read_at||=new Date().toISOString();window.writes++;return {id:n.id,readAt:n.read_at}}return {notifications:window.feed.filter(n=>!n.read_at).slice(0,50),unreadCount:window.feed.filter(n=>!n.read_at).length,hasMore:false}};
const request=window.fixtureRequest;window.saveQueue={};
window.fixtureRequest=(url,method,input)=>{
 if(window.deferReads&&url==='/api/notification-preferences'&&method==='GET'){
  const snapshot={...window.store[window.user]};return new Promise(resolve=>{window.finishRead=()=>resolve(snapshot)})
 }
 if(window.deferSaves&&url==='/api/notification-preferences'&&method==='POST'){
  const owner=window.user;const snapshot={...window.store[owner],[input.key]:input.value};
  return new Promise((resolve,reject)=>{window.saveQueue[input.key]=fail=>{delete window.saveQueue[input.key];if(fail)reject(Error('Controlled keyed failure'));else{window.store[owner][input.key]=input.value;resolve(snapshot)}}});
 }return request(url,method,input)
};
window.emit=(type,destination={})=>{const n={id:crypto.randomUUID(),event_type:type,destination,read_at:null,created_at:new Date().toISOString()};window.feed.unshift(n);window.signal({changed:true,inserted:true,notification:n});return n};
`
)
async function main() {
  await build(aliases)
  for (const name of ['entry.tsx', 'api.ts'])
    fs.unlinkSync(path.join(root, name))
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const b = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const width of [390, 430, 820, 1280, 1536]) {
      const p = await b.newPage({
        viewport: { width, height: 900 },
        serviceWorkers: 'block',
      })
      await p.route(/^https?:/, (r) => r.abort())
      await p.goto(
        'file://' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      await p.evaluate(() => {
        window.feed = [
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            event_type: 'new_message',
            destination: {},
            created_at: '2026-01-01T00:00:00Z',
            read_at: null,
          },
        ]
        window.show('buyer')
      })
      const toggle = (label) =>
        p.getByRole('switch', { name: label, exact: true })
      await toggle('In-app notifications').waitFor()
      assert.equal(
        await p.getByRole('button', { name: /Open notification:/ }).count(),
        0,
        'initial history never pops'
      )
      assert.equal(
        await toggle('In-app notifications').getAttribute('aria-checked'),
        'true'
      )
      assert.equal(
        await toggle('Notification sounds').getAttribute('aria-checked'),
        'false'
      )
      assert.equal(
        await toggle('Email notifications').getAttribute('aria-checked'),
        'true'
      )
      for (const label of [
        'In-app notifications',
        'Notification sounds',
        'Email notifications',
      ]) {
        const rect = await toggle(label).boundingBox()
        assert.equal(rect.width, 56)
        assert.equal(rect.height, 30)
        assert.equal(
          await toggle(label).evaluate((node) =>
            getComputedStyle(node).getPropertyValue('--ss-track-on').trim()
          ),
          '#7C3AED'
        )
        await p.waitForFunction(
          (node) =>
            getComputedStyle(node.querySelector('[class*="track"]'))
              .backgroundColor ===
            (node.getAttribute('aria-checked') === 'true'
              ? 'rgb(124, 58, 237)'
              : 'rgb(39, 39, 42)'),
          await toggle(label).elementHandle()
        )
      }
      const positions = await p
        .getByRole('switch')
        .evaluateAll((nodes) =>
          nodes.map((n) => n.getBoundingClientRect().right)
        )
      assert(
        positions.every((x) => x === positions[0]),
        'right-aligned switches'
      )
      const labels = {
        inApp: 'In-app notifications',
        sounds: 'Notification sounds',
        email: 'Email notifications',
      }
      const defaults = { inApp: true, sounds: false, email: true }
      const checkValues = async (values) => {
        for (const [key, value] of Object.entries(values))
          assert.equal(
            await toggle(labels[key]).getAttribute('aria-checked'),
            String(value)
          )
      }
      const finishSave = async (key, fail = false, settled = true) => {
        await p.evaluate(
          ([key, fail]) => window.saveQueue[key](fail),
          [key, fail]
        )
        if (settled)
          await p.waitForFunction(
            (label) =>
              document
                .querySelector(`[role="switch"][aria-label="${label}"]`)
                .closest('[aria-busy]')
                .getAttribute('aria-busy') === 'false',
            labels[key]
          )
        else
          await p.waitForFunction((key) => Boolean(window.saveQueue[key]), key)
      }
      await p.evaluate(() => (window.deferSaves = true))
      for (const key of Object.keys(labels)) {
        await toggle(labels[key]).click()
        await p.waitForFunction((key) => Boolean(window.saveQueue[key]), key)
        await checkValues({ ...defaults, [key]: !defaults[key] })
        for (const other of Object.keys(labels))
          assert.equal(
            await toggle(labels[other]).getAttribute('aria-disabled'),
            null,
            'all switches remain interactive while saving'
          )
        await finishSave(key, true)
        await checkValues(defaults)
        assert.equal(await p.getByRole('alert').count(), 1)
        assert(
          await toggle(labels[key])
            .locator('xpath=ancestor::*[@aria-busy][1]')
            .getByRole('alert')
            .isVisible(),
          'failure belongs to its row'
        )
        await toggle(labels[key]).click()
        await finishSave(key)
        await checkValues({ ...defaults, [key]: !defaults[key] })
        await toggle(labels[key]).click()
        await finishSave(key)
      }
      // Same-key requests never overlap; queued toggles retain only latest intent.
      await toggle(labels.sounds).click()
      await toggle(labels.sounds).click()
      await toggle(labels.sounds).click()
      await checkValues({ ...defaults, sounds: true })
      await finishSave('sounds', false, false)
      await checkValues({ ...defaults, sounds: true })
      await finishSave('sounds')
      assert.equal(await p.evaluate(() => window.store.buyer.sounds), true)
      await toggle(labels.sounds).click()
      await finishSave('sounds')
      await toggle(labels.email).click()
      await toggle(labels.email).click()
      await finishSave('email', false, false)
      await checkValues(defaults)
      await finishSave('email')
      assert.equal(await p.evaluate(() => window.store.buyer.email), true)
      // Roll back a failed latest intent to the preceding successful write,
      // rather than the value from before the entire rapid-toggle sequence.
      await toggle(labels.email).click()
      await toggle(labels.email).click()
      await finishSave('email', false, false)
      await finishSave('email', true)
      await checkValues({ ...defaults, email: false })
      await toggle(labels.email).click()
      await finishSave('email')
      // An obsolete failed request must not roll back a newer queued choice.
      await toggle(labels.inApp).click()
      await toggle(labels.inApp).click()
      await finishSave('inApp', true, false)
      await checkValues(defaults)
      assert.equal(await p.getByRole('alert').count(), 0)
      await finishSave('inApp')
      // Both responses contain snapshots captured before the sibling saved.
      // Complete in reverse order to expose full-response stale overwrites.
      for (const first of ['inApp', 'sounds']) {
        await p.evaluate(() => {
          window.deferReads = true
          window.reconnect()
        })
        await p.waitForFunction(() => typeof window.finishRead === 'function')
        await toggle(labels.inApp).click()
        await toggle(labels.sounds).click()
        assert.equal(
          await toggle(labels.email).getAttribute('aria-disabled'),
          null
        )
        await finishSave(first)
        await finishSave(first === 'inApp' ? 'sounds' : 'inApp')
        await checkValues({ inApp: false, sounds: true, email: true })
        await p.evaluate(() => {
          window.deferReads = false
          window.finishRead()
          delete window.finishRead
        })
        await p.waitForTimeout(100)
        await checkValues({ inApp: false, sounds: true, email: true })
        await p.evaluate(() => window.reconnect())
        await p.waitForTimeout(100)
        await checkValues({ inApp: false, sounds: true, email: true })
        await toggle(labels.inApp).click()
        await finishSave('inApp')
        await toggle(labels.sounds).click()
        await finishSave('sounds')
      }
      await toggle(labels.email).click()
      await toggle(labels.sounds).click()
      await finishSave('sounds')
      await finishSave('email', true)
      await checkValues({ inApp: true, sounds: true, email: true })
      await toggle(labels.sounds).click()
      await finishSave('sounds')
      await toggle(labels.email).click()
      await finishSave('email')
      await toggle(labels.email).click()
      await finishSave('email')
      await p.evaluate(() => (window.deferSaves = false))
      await p.evaluate(() => window.show(null))
      await p.evaluate(() => window.show('buyer'))
      await toggle(labels.inApp).waitFor()
      await checkValues(defaults)
      await toggle('Notification sounds').press('Space')
      await p.waitForFunction(() => window.store.buyer.sounds === true)
      await p.waitForTimeout(80)
      assert.equal(
        await toggle('Notification sounds').getAttribute('aria-checked'),
        'true'
      )
      await p.evaluate(() => (window.failSave = true))
      await toggle('Email notifications').click()
      await p.getByRole('alert').waitFor()
      assert.equal(
        await toggle('Email notifications').getAttribute('aria-checked'),
        'true',
        'failed save retains server truth'
      )
      await toggle('Email notifications').press('Enter')
      await p.waitForFunction(() => window.store.buyer.email === false)
      await p.waitForTimeout(80)
      assert.equal(
        await toggle('Email notifications').getAttribute('aria-checked'),
        'false'
      )
      await p.evaluate(() => window.show(null))
      assert.equal(await p.evaluate(() => window.channels), 0)
      await p.evaluate(() => window.show('buyer'))
      await toggle('Email notifications').waitFor()
      assert.equal(
        await toggle('Email notifications').getAttribute('aria-checked'),
        'false',
        'logout/login persistence'
      )
      assert.equal(
        await toggle('Notification sounds').getAttribute('aria-checked'),
        'true'
      )
      await p.evaluate(() => window.reconnect())
      await p.waitForTimeout(100)
      assert.equal(
        await p.getByRole('button', { name: /Open notification:/ }).count(),
        0,
        'reconnect hydration never pops'
      )
      const destination = {
        section: 'messages',
        conversationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        destination: 'buying',
      }
      const message = await p.evaluate(
        (dest) => window.emit('new_message', dest),
        destination
      )
      const popup = p.getByRole('button', {
        name: 'Open notification: New message',
        exact: true,
      })
      await popup.waitFor()
      await p
        .getByRole('button', { name: 'Notifications, 2 unread', exact: true })
        .waitFor()
      const popupBox = await popup.boundingBox()
      assert(popupBox.x >= 0 && popupBox.x + popupBox.width <= width)
      assert(popupBox.y < 50, 'popup at top')
      if (width >= 1024) assert(popupBox.x > width / 2, 'desktop top-right')
      await p.evaluate(
        (n) =>
          window.signal({ changed: true, inserted: true, notification: n }),
        message
      )
      await p.waitForTimeout(80)
      assert.equal(await popup.count(), 1, 'identity dedupe')
      await popup.click()
      await p.waitForFunction(() => window.actions.length === 1)
      await popup.waitFor({ state: 'hidden' })
      assert(
        (await p.evaluate(() => window.actions[0])).includes(
          'conversation=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
        )
      )
      await p
        .getByRole('button', { name: 'Notifications, 1 unread', exact: true })
        .waitFor()
      await p.evaluate(() =>
        window.emit('order_cancelled', {
          section: 'orders',
          orderId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          destination: 'purchases',
        })
      )
      await p
        .getByRole('button', {
          name: 'Open notification: Order cancelled',
          exact: true,
        })
        .waitFor()
      const before = await p.evaluate(() => window.writes)
      await p
        .getByRole('button', { name: 'Dismiss notification', exact: true })
        .click()
      await p.waitForTimeout(200)
      assert.equal(
        await p.evaluate(() => window.writes),
        before,
        'dismiss never marks read'
      )
      await toggle('In-app notifications').click()
      await p.waitForFunction(() => window.store.buyer.inApp === false)
      await p.waitForTimeout(60)
      const suppressed = await p.evaluate(() =>
        window.emit('price_drop', {
          section: 'listing',
          listingId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        })
      )
      await p
        .getByRole('button', { name: 'Notifications, 3 unread', exact: true })
        .waitFor()
      assert.equal(
        await p.getByRole('button', { name: /Open notification:/ }).count(),
        0,
        'popup OFF preserves unread only'
      )
      await toggle('In-app notifications').click()
      await p.waitForFunction(() => window.store.buyer.inApp === true)
      await p.waitForTimeout(80)
      await p.evaluate(
        (n) =>
          window.signal({ changed: true, inserted: true, notification: n }),
        suppressed
      )
      await p.waitForTimeout(100)
      assert.equal(
        await p.getByRole('button', { name: /Open notification:/ }).count(),
        0,
        'disabled-period events never replay'
      )
      await p.evaluate(() => {
        window.emit('price_drop', {
          section: 'listing',
          listingId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        })
        window.emit('notification_test', {
          section: 'settings',
          panel: 'payments-payouts',
        })
        window.emit('notification_test', {})
        for (let i = 0; i < 8; i++) window.emit('new_message', {})
      })
      await p.waitForTimeout(400)
      const dismiss = p.getByRole('button', {
        name: 'Dismiss notification',
        exact: true,
      })
      assert.equal(
        await dismiss.count(),
        width >= 1024 ? 3 : 1,
        'bounded visible stack'
      )
      await p
        .getByRole('button', {
          name: 'Open notification: Saved Listing price dropped',
          exact: true,
        })
        .click()
      await p.waitForFunction(() => window.actions.length === 2)
      assert.equal(
        await p.evaluate(() => window.actions.at(-1)),
        '/listings/dddddddd-dddd-4ddd-8ddd-dddddddddddd'
      )
      await p
        .getByRole('button', {
          name: 'Open notification: Staging email test',
          exact: true,
        })
        .waitFor()
      await p
        .getByRole('button', {
          name: 'Open notification: Staging email test',
          exact: true,
        })
        .click()
      await p.waitForFunction(() => window.actions.length === 3)
      assert.equal(
        await p.evaluate(() => window.actions.at(-1)),
        '/home?section=settings'
      )
      await p
        .getByRole('button', {
          name: 'Open notification: Staging email test',
          exact: true,
        })
        .waitFor({ state: 'hidden' })
      await p.waitForTimeout(200)
      assert.equal(
        await p
          .getByRole('button', {
            name: 'Open notification: Staging email test',
            exact: true,
          })
          .count(),
        0,
        'system with no target is not clickable'
      )
      assert.equal(await p.evaluate(() => window.channels), 1)
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      )
      await p.screenshot({
        path: 'tests/artifacts/notification-preferences-' + width + '.png',
      })
      if (width === 390) {
        await toggle('In-app notifications').click()
        await p.waitForFunction(() => window.store.buyer.inApp === false)
        await p.waitForTimeout(80)
        await toggle('In-app notifications').click()
        await p.waitForFunction(() => window.store.buyer.inApp === true)
        await p.waitForTimeout(80)
        await p.evaluate(() => window.emit('notification_test', {}))
        await p
          .getByRole('button', { name: 'Dismiss notification', exact: true })
          .waitFor()
        await p.mouse.move(380, 850)
        const writesBeforeDismiss = await p.evaluate(() => window.writes)
        await p
          .getByRole('button', { name: 'Dismiss notification', exact: true })
          .waitFor({ state: 'hidden', timeout: 8000 })
        assert.equal(await p.evaluate(() => window.writes), writesBeforeDismiss)
      }
      await p.evaluate(() => window.show(null))
      assert.equal(await p.evaluate(() => window.channels), 0)
      const persisted = await p.evaluate(() => {
        sessionStorage.setItem('preferenceStore', JSON.stringify(window.store))
        return window.store.buyer
      })
      await p.reload()
      await p.waitForFunction(() => typeof window.show === 'function')
      await p.evaluate(() => window.show('buyer'))
      await toggle(labels.inApp).waitFor()
      await checkValues(persisted)
      console.log(
        'PASS preferences/popups ' +
          width +
          ': optimistic non-blocking switches, latest-intent same-key queue, concurrent cross-key saves, stale response protection, isolated rollback, reload persistence, popup regressions, no overflow'
      )
      await p.close()
    }
  } finally {
    await b.close()
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
