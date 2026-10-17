/* global window, document, getComputedStyle */
// Real shared Bell/feed state and StatefulButton, offline API/Broadcast transport only.
const fs = require('fs'),
  path = require('path'),
  assert = require('assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
fs.writeFileSync(
  path.join(root, 'notification-mock.js'),
  `export function useMarketplaceSession(){return {seller:window.user?{id:window.user}:null}};export function connectMessagesRealtime(id,on,recover,end,notify){window.signal=notify;window.end=end;window.channels++;return ()=>window.channels--}`
)
aliases['@/components/listings/marketplace-session'] = path.join(
  root,
  'notification-mock.js'
)
aliases['@/lib/messages-realtime'] = path.join(root, 'notification-mock.js')
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `import 'tailwindcss/src/css/preflight.css';import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {LazyMotion,domAnimation} from 'framer-motion';import {NotificationsProvider} from '@/components/notifications/notification-state';import {NotificationsView} from '@/components/notifications/notifications-view';import {NotificationBell} from '@/components/notifications/notification-bell';const root=createRoot(document.getElementById('root'));window.channels=0;window.actions=[];window.show=user=>{window.user=user;flushSync(()=>root.render(<LazyMotion features={domAnimation}><NotificationsProvider><NotificationBell/><nav>Notifications  Settings</nav><NotificationsView/></NotificationsProvider></LazyMotion>))};document.body.style.background='#0b0b0b';document.body.style.color='#f5f5f5';const style=document.createElement('style');style.textContent='.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}';document.head.append(style);window.fixtureRequest=async(url,method,input)=>{if(url.startsWith('/api/notification-preferences'))return {inApp:true,sounds:false,email:true};if(window.fail){window.fail=false;throw Error('Controlled error')}await new Promise(r=>setTimeout(r,50));if(method==='POST'){window.writes++;(window.posts||=[]).push(input);if(input.action==='delete')window.feed.notifications=window.feed.notifications.filter(n=>!input.ids.includes(n.id));else if(input.action==='markRead')window.feed.notifications.forEach(n=>{if(input.ids.includes(n.id)&&!n.read_at)n.read_at=new Date().toISOString()});else if(input.action==='markAllRead')window.feed.notifications.forEach(n=>n.read_at=new Date().toISOString());else window.feed.notifications.find(n=>n.id===input.id).read_at=new Date().toISOString();window.feed.unreadCount=window.feed.notifications.filter(n=>!n.read_at).length;if(input.id)return {id:input.id,readAt:window.feed.notifications.find(n=>n.id===input.id).read_at};}const q=new URL(url,'https://fixture.invalid').searchParams;const category=n=>n.event_type==='new_message'?'message':n.event_type==='price_drop'?'listing':n.event_type==='notification_test'?'system':'order';let rows=window.feed.notifications.filter(n=>(!q.get('category')||category(n)===q.get('category'))&&(!q.get('status')||(q.get('status')==='read'?Boolean(n.read_at):!n.read_at)));const index=rows.findIndex(n=>n.id===q.get('beforeId'));if(index>=0)rows=rows.slice(index+1);if(window.delayCategory && q.get('category')==='message')await new Promise(r=>setTimeout(r,1000));const part=rows.slice(0,50),last=part.at(-1);return structuredClone({notifications:part,unreadCount:window.feed.unreadCount,hasMore:rows.length>50,nextCursor:rows.length>50?{before:last.created_at,beforeId:last.id}:null})};`
)
;(async () => {
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
  try {
    for (const width of [390, 430, 820, 1280, 1536]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        serviceWorkers: 'block',
      })
      page.setDefaultTimeout(5000)
      await page.goto(
        'file://' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      await page.evaluate(() => {
        window.feed = { notifications: [], unreadCount: 0 }
        window.writes = 0
        window.show('buyer')
      })
      const expectUnread = async (count = 0) => {
        await page.waitForFunction(
          (count) =>
            document.querySelector(
              `button[aria-label="Notifications, ${count} unread"]`
            ),
          count
        )
        assert.equal(
          await page.getByText(/^\d+ unread$/, { exact: true }).count(),
          0
        )
      }
      const chooseStatus = async (label) => {
        await page
          .getByRole('button', { name: 'Notification status', exact: true })
          .click()
        const panel = page.getByRole('region', {
          name: 'Notification status options',
          exact: true,
        })
        await panel
          .getByRole('button', { name: label, exact: true })
          .press('Enter')
        await panel.waitFor({ state: 'hidden' })
      }
      assert(
        (
          await page
            .getByRole('button', { name: 'Notification status', exact: true })
            .textContent()
        ).includes('Unread')
      )
      const bell = page.getByRole('button', {
        name: 'Notifications, 0 unread',
        exact: true,
      })
      await bell.click()
      await page.getByText(/No notifications match/).waitFor()
      assert.equal(await page.getByRole('dialog').count(), 0)
      assert.equal(
        await page.evaluate(() => window.actions.at(-1)),
        '/home?section=notifications'
      )
      await page.evaluate(() => (window.actions = []))

      await page.waitForTimeout(250)
      await page.evaluate(() => {
        window.feed = {
          unreadCount: 1,
          notifications: [
            {
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              event_type: 'incoming_offer',
              created_at: '2026-10-15T12:00:00Z',
              read_at: null,
              destination: {
                section: 'messages',
                conversationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                destination: 'buying',
              },
            },
          ],
        }
        window.signal()
      })
      await page
        .getByRole('button', { name: 'Notifications, 1 unread' })
        .click()
      const dialog = page.getByRole('region', { name: 'Notifications feed' })
      await dialog.getByText('New offer received', { exact: true }).waitFor()
      assert.equal(await page.evaluate(() => window.channels), 1)
      assert.equal(await page.locator('nav [aria-label="1 unread"]').count(), 0)
      assert.equal(await dialog.locator('[data-unread]').count(), 1)
      assert.equal(await page.getByRole('checkbox').count(), 0)
      assert.equal(
        await page.getByRole('button', { name: 'Mark all as read' }).count(),
        0
      )
      const normalCategoryX = await dialog
        .locator('li > span')
        .first()
        .evaluate((e) => e.getBoundingClientRect().x)
      await page.screenshot({
        path: 'tests/artifacts/notifications-default-' + width + '.png',
      })
      const selectBox = await page
        .getByRole('button', { name: 'Select', exact: true })
        .boundingBox()
      await page.getByRole('button', { name: 'Select', exact: true }).click()
      assert.deepEqual(
        await page
          .getByRole('button', { name: 'Done', exact: true })
          .boundingBox(),
        selectBox
      )
      await page.waitForTimeout(180)
      assert.equal(
        await page
          .getByRole('button', { name: 'Done', exact: true })
          .locator('span span')
          .last()
          .evaluate((e) => Number(getComputedStyle(e).opacity)),
        1
      )
      await page.getByRole('button', { name: 'Done', exact: true }).waitFor()
      assert.equal(await page.getByRole('checkbox').count(), 1)
      const selectionCategoryX = await dialog
        .locator('li > span')
        .first()
        .evaluate((e) => e.getBoundingClientRect().x)
      assert(selectionCategoryX > normalCategoryX)
      await page.getByRole('checkbox').check()
      await page.getByText('1 selected', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Delete', exact: true }).click()
      await page
        .getByRole('group', { name: 'Confirm notification deletion' })
        .waitFor()
      await page.getByRole('button', { name: 'Done', exact: true }).click()
      assert.equal(await page.getByRole('checkbox').count(), 0)
      assert.equal(
        await page
          .getByRole('group', { name: 'Confirm notification deletion' })
          .count(),
        0
      )
      assert.equal(
        await page.getByRole('button', { name: 'Delete', exact: true }).count(),
        0
      )
      await expectUnread(1)
      assert.equal(
        await dialog
          .locator('li > span')
          .first()
          .evaluate((e) => e.getBoundingClientRect().x),
        normalCategoryX
      )
      assert.equal(await page.evaluate(() => window.writes), 0)
      await page.getByRole('button', { name: 'Select', exact: true }).click()
      assert.equal(
        await page.getByRole('checkbox', { checked: true }).count(),
        0
      )
      const bounds = await dialog.boundingBox()
      assert(bounds.x >= 0 && bounds.x + bounds.width <= width)
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      )
      // A View detail survives removal of its source row under default Unread.
      await page
        .getByRole('button', { name: 'View New offer received', exact: true })
        .click()
      await page.getByRole('dialog').waitFor()
      await expectUnread()
      assert.equal(await dialog.locator('li').count(), 0)
      assert.equal(await page.getByRole('dialog').count(), 1)
      await page.waitForTimeout(200)
      assert.equal(await page.getByRole('dialog').count(), 1)
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      assert.equal(await dialog.locator('li').count(), 0)
      await page.evaluate(() => {
        window.feed.notifications[0].read_at = null
        window.feed.unreadCount = 1
        window.signal()
      })
      await page
        .getByRole('button', {
          name: 'Open destination: New offer received',
          exact: true,
        })
        .click()
      await page.waitForFunction(() =>
        window.actions.some((x) => x.includes('conversation='))
      )
      await expectUnread()
      assert.equal(await dialog.locator('li').count(), 0)
      await page.evaluate(() => {
        window.actions = []
        window.writes = 0
        window.feed.notifications[0].read_at = null
        window.feed.unreadCount = 1
        window.signal()
      })
      await page.getByRole('checkbox').waitFor()
      await page.getByRole('button', { name: 'Mark all as read' }).click()
      await page
        .getByText('No notifications match these filters.', { exact: true })
        .waitFor()
      assert(
        (
          await page
            .getByRole('button', { name: 'Notification status', exact: true })
            .textContent()
        ).includes('Unread')
      )
      await chooseStatus('All status')
      await dialog.locator('li').waitFor()
      await page.waitForFunction(() => window.writes === 1)
      await expectUnread()
      assert.equal(await page.locator('nav [aria-label="1 unread"]').count(), 0)
      await page.evaluate(() => (window.actions = []))
      await dialog
        .getByRole('button', { name: 'View New offer received', exact: true })
        .click()
      const report = page.getByRole('dialog')
      await report
        .getByText('Review the offer and its proposed terms in Messages.', {
          exact: true,
        })
        .waitFor()
      assert.equal(await page.evaluate(() => window.actions.length), 0)
      assert.equal(
        await page.evaluate(() => window.writes),
        1,
        'already-read View must not write'
      )
      await page.keyboard.press('Escape')
      await report.waitFor({ state: 'hidden' })
      await dialog
        .getByRole('button', {
          name: 'Open destination: New offer received',
          exact: true,
        })
        .click()
      await page.waitForFunction(() =>
        window.actions.some((x) => x.includes('conversation='))
      )
      assert(
        (
          await page.evaluate(() =>
            window.actions.find((x) => x.includes('conversation='))
          )
        ).includes('conversation=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
      )
      await page.waitForTimeout(250)
      await page.evaluate(() => {
        window.fail = true
        window.signal()
      })
      await page
        .getByRole('button', { name: 'Notifications, 0 unread', exact: true })
        .click()
      await page.getByRole('alert').waitFor()
      await page.getByRole('button', { name: 'Retry', exact: true }).click()
      await page.waitForFunction(
        () => !document.querySelector('[role="alert"]')
      )
      await page.keyboard.press('Escape')
      await page.waitForTimeout(250)

      await page.evaluate(() => {
        window.actions = []
        window.writes = 0
        window.feed = {
          unreadCount: 4,
          notifications: [
            'new_message',
            'order_cancelled',
            'price_drop',
            'notification_test',
          ].map((event_type, i) => ({
            id: '0000000' + i + '-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            event_type,
            created_at: new Date(Date.now() - 120000).toISOString(),
            read_at: null,
            destination:
              i === 0
                ? {
                    section: 'messages',
                    conversationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                    destination: 'buying',
                  }
                : i === 1
                ? {
                    section: 'orders',
                    orderId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                    destination: 'purchases',
                  }
                : i === 2
                ? {
                    section: 'listing',
                    listingId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
                  }
                : {},
            ...(i === 2
              ? { original_price_cents: 8000, latest_price_cents: 7000 }
              : {}),
          })),
        }
        window.signal()
      })
      await page
        .getByRole('button', { name: 'View New message', exact: true })
        .waitFor()
      const rows = dialog.locator('li')
      assert.equal(await rows.count(), 4)
      await rows.first().locator('strong').click()
      assert.equal(
        await page.evaluate(() => window.actions.length + window.writes),
        0
      )
      await page.evaluate(() => (window.fail = true))
      await page
        .getByRole('button', { name: 'View New message', exact: true })
        .click()
      await page.getByRole('alert').waitFor()
      assert.equal(await page.getByRole('dialog').count(), 0)
      assert.equal(await rows.locator('[data-unread]').count(), 0)
      assert.equal(await dialog.locator('li[data-unread]').count(), 4)
      assert.equal(await page.evaluate(() => window.writes), 0)
      await page.getByRole('button', { name: 'Retry', exact: true }).click()
      await page.waitForFunction(
        () => !document.querySelector('[role="alert"]')
      )
      await page
        .getByRole('button', { name: 'View New message', exact: true })
        .click()
      assert.equal(
        await page.getByRole('dialog').count(),
        0,
        'detail waits for read response'
      )
      await page.getByRole('dialog').waitFor()
      await page
        .getByRole('dialog')
        .getByText(
          'You have a new message. Open the conversation to read it.',
          { exact: true }
        )
        .waitFor()
      await expectUnread(3)
      assert.equal(await page.evaluate(() => window.actions.length), 0)
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      await page.waitForFunction(
        () =>
          document.activeElement?.getAttribute('aria-label') ===
          'View New message'
      )
      await page
        .getByRole('button', {
          name: 'View Saved Listing price dropped',
          exact: true,
        })
        .click()
      await page
        .getByRole('dialog')
        .getByText('CAD 80.00', { exact: true })
        .waitFor()
      await page
        .getByRole('dialog')
        .getByText('CAD 70.00', { exact: true })
        .waitFor()
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Close', exact: true })
        .click()
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      const labels = {
        message: 'Messages',
        order: 'Orders',
        listing: 'Listings',
        system: 'System',
        '': 'All notifications',
      }
      const choose = async (name, label) => {
        await page.getByRole('button', { name, exact: true }).click()
        const panel = page.getByRole('region', {
          name: name + ' options',
          exact: true,
        })
        await panel
          .getByRole('button', { name: label, exact: true })
          .press('Enter')
        await panel.waitFor({ state: 'hidden' })
      }
      const filter = {
        selectOption: (value) => choose('Notification category', labels[value]),
      }
      const statusFilter = (value) =>
        choose(
          'Notification status',
          value === 'read'
            ? 'Read'
            : value === 'unread'
            ? 'Unread'
            : 'All status'
        )
      assert.equal(await page.locator('select').count(), 0)
      for (const value of ['message', 'order', 'listing', 'system']) {
        await filter.selectOption(value)
        await page.waitForFunction(
          () => document.querySelectorAll('li').length === 1
        )
        assert.equal(await page.evaluate(() => window.channels), 1)
        if (value === 'system')
          assert.equal(
            await dialog
              .getByRole('button', { name: /Open destination:/ })
              .count(),
            0
          )
      }
      await page.evaluate(() => (window.delayCategory = true))
      await filter.selectOption('message')
      await filter.selectOption('order')
      await page.waitForTimeout(1100)
      await dialog.getByText('Order cancelled', { exact: true }).waitFor()
      assert.equal(await rows.count(), 1)
      assert(
        (
          await page
            .getByRole('button', { name: 'Notification category', exact: true })
            .textContent()
        ).includes('Orders')
      )
      assert.equal(await page.evaluate(() => window.channels), 1)
      await page.evaluate(() => (window.delayCategory = false))
      await filter.selectOption('')
      await page.waitForFunction(
        () => document.querySelectorAll('li').length === 4
      )
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      )

      await page.screenshot({
        path: 'tests/artifacts/notifications-management-' + width + '.png',
      })
      const alignment = await dialog.locator('li').evaluateAll((rows) =>
        rows.map((row) => ({
          checkbox: row.querySelector('input').getBoundingClientRect().x,
          category: row.querySelector('input + span').getBoundingClientRect().x,
        }))
      )
      assert(
        alignment.every(
          (r) =>
            r.checkbox === alignment[0].checkbox &&
            r.category === alignment[0].category
        )
      )
      const checkbox = (title) =>
        page.getByRole('checkbox', { name: 'Select ' + title, exact: true })
      const writesBefore = await page.evaluate(() => window.writes)
      await checkbox('New message').check()
      await checkbox('Order cancelled').check()
      await page.getByText('2 selected', { exact: true }).waitFor()
      await page.screenshot({
        path: 'tests/artifacts/notifications-selected-' + width + '.png',
      })
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      )
      assert.equal(await page.evaluate(() => window.writes), writesBefore)
      assert.equal(
        await page
          .getByRole('button', { name: 'Mark all as read', exact: true })
          .count(),
        0
      )
      await page
        .getByRole('button', { name: 'Mark as read', exact: true })
        .click()
      await page
        .getByRole('button', { name: 'Mark all as read', exact: true })
        .waitFor()
      assert.equal(
        await page.getByRole('checkbox', { checked: true }).count(),
        0
      )
      const post = await page.evaluate(() => window.posts.at(-1))
      assert.equal(post.action, 'markRead')
      assert.equal(post.ids.length, 1)
      await checkbox('New message').check()
      assert(
        await page
          .getByRole('button', { name: 'Mark as read', exact: true })
          .isDisabled()
      )
      await statusFilter('read')
      assert.equal(
        await page.getByRole('checkbox', { checked: true }).count(),
        0
      )
      await filter.selectOption('order')
      await page.waitForFunction(
        () => document.querySelectorAll('li').length === 1
      )
      await filter.selectOption('')
      await statusFilter('unread')
      await page.waitForFunction(
        () => document.querySelectorAll('li').length === 1
      )
      await checkbox('Staging email test').check()
      await page.evaluate(() => {
        window.feed.notifications.find(
          (n) => n.event_type === 'notification_test'
        ).read_at = new Date().toISOString()
        window.feed.unreadCount = 0
        window.signal()
      })
      await page.waitForFunction(
        () => document.querySelectorAll('li').length === 0
      )
      assert.equal(
        await page.getByRole('checkbox', { checked: true }).count(),
        0
      )
      await statusFilter('')
      await checkbox('Staging email test').check()
      await page.getByRole('button', { name: 'Delete', exact: true }).click()
      const confirmation = page.getByRole('group', {
        name: 'Confirm notification deletion',
      })
      const beforeCancel = await page.evaluate(() => window.writes)
      await confirmation
        .getByRole('button', { name: 'Cancel', exact: true })
        .click()
      assert.equal(await page.evaluate(() => window.writes), beforeCancel)
      await page.getByRole('button', { name: 'Delete', exact: true }).click()
      await page.evaluate(() => (window.fail = true))
      await confirmation
        .getByRole('button', { name: 'Delete notifications', exact: true })
        .click()
      await page.getByRole('alert').waitFor()
      assert.equal(
        await page.getByRole('checkbox', { checked: true }).count(),
        1
      )
      await checkbox('New message').check()
      await page.getByRole('button', { name: 'Delete', exact: true }).click()
      await confirmation
        .getByRole('button', { name: 'Delete notifications', exact: true })
        .click()
      await page.waitForFunction(
        () => document.querySelectorAll('li').length === 2
      )
      assert.equal(
        await page.getByRole('checkbox', { checked: true }).count(),
        0
      )
      await expectUnread()
      await checkbox('Saved Listing price dropped').check()
      await page.evaluate(() => {
        window.feed.notifications = window.feed.notifications.filter(
          (n) => n.event_type !== 'price_drop'
        )
        window.signal()
      })
      await page.waitForFunction(
        () => document.querySelectorAll('li').length === 1
      )
      assert.equal(
        await page.getByRole('checkbox', { checked: true }).count(),
        0
      )
      assert.equal(await page.evaluate(() => window.channels), 1)
      await page
        .getByRole('button', { name: 'Notification category', exact: true })
        .click()
      await page.keyboard.press('Escape')
      await page
        .getByRole('region', {
          name: 'Notification category options',
          exact: true,
        })
        .waitFor({ state: 'hidden' })
      assert(
        await page
          .getByRole('button', { name: 'Notification category', exact: true })
          .evaluate((e) => document.activeElement === e)
      )
      await page.screenshot({
        path: 'tests/artifacts/notifications-inbox-' + width + '.png',
      })
      await page.evaluate(() => {
        window.feed = {
          unreadCount: 55,
          notifications: Array.from({ length: 55 }, (_, i) => ({
            id: String(i).padStart(8, '0') + '-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            event_type: 'order_completed',
            created_at: '2026-10-15T12:00:00Z',
            read_at: null,
            destination: {},
          })),
        }
        window.signal()
      })
      await page.waitForFunction(
        () => document.querySelectorAll('li').length === 50
      )
      await page.getByRole('button', { name: 'Load more', exact: true }).click()
      await page.waitForFunction(
        () => document.querySelectorAll('li').length === 55
      )
      assert.equal(
        await page
          .getByRole('button', { name: 'Load more', exact: true })
          .count(),
        0
      )
      await filter.selectOption('order')
      await page.waitForFunction(
        () => document.querySelectorAll('li').length === 50
      )
      await page.getByRole('button', { name: 'Load more', exact: true }).click()
      await page.waitForFunction(
        () => document.querySelectorAll('li').length === 55
      )
      await page.evaluate(() => window.signal())
      await page.waitForFunction(
        () => document.querySelectorAll('li').length === 55
      )
      assert.equal(await page.evaluate(() => window.channels), 1)
      const checks = page.getByRole('checkbox')
      await checks.first().check()
      await checks.last().check()
      await page
        .getByRole('button', { name: 'Mark as read', exact: true })
        .click()
      await page
        .getByRole('button', { name: 'Mark all as read', exact: true })
        .waitFor()
      assert.equal(await dialog.locator('li').count(), 55)
      assert.equal(
        await page.getByRole('checkbox', { checked: true }).count(),
        0
      )
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      )
      await chooseStatus('Unread')
      await page.waitForFunction(
        () => document.querySelectorAll('li').length === 50
      )
      const originalLast = await page
        .locator('li')
        .last()
        .getAttribute('data-unread')
      assert.equal(originalLast, 'true')
      await page.getByRole('checkbox').first().check()
      await page
        .getByRole('button', { name: 'Mark as read', exact: true })
        .click()
      await page.waitForFunction(
        () =>
          document.querySelectorAll('li').length === 50 &&
          document.querySelectorAll('input:checked').length === 0
      )
      await page
        .getByRole('button', { name: 'Mark all as read', exact: true })
        .waitFor()
      const remainingBeforeView = await page.evaluate(
        () => window.feed.unreadCount
      )
      const viewedId = await page.evaluate(
        () => window.feed.notifications.find((n) => !n.read_at).id
      )
      await page
        .getByRole('button', { name: 'View Order completed', exact: true })
        .first()
        .click()
      await page.getByRole('dialog').waitFor()
      assert.equal(
        await dialog.locator('li').count(),
        50,
        'next unread item fills loaded window'
      )
      assert.equal(
        await page.evaluate(() => window.feed.unreadCount),
        remainingBeforeView - 1
      )
      assert(
        await page.evaluate(
          (id) =>
            Boolean(window.feed.notifications.find((n) => n.id === id).read_at),
          viewedId
        )
      )
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      await page
        .getByRole('button', { name: 'Mark all as read', exact: true })
        .click()
      await expectUnread()
      await page
        .getByText('No notifications match these filters.', { exact: true })
        .waitFor()
      assert.equal(await page.getByRole('checkbox').count(), 0)
      assert(
        (
          await page
            .getByRole('button', { name: 'Notification status', exact: true })
            .textContent()
        ).includes('Unread')
      )
      await page.evaluate(() => window.show(null))
      assert.equal(
        await page.getByRole('button', { name: /Notifications,/ }).count(),
        0
      )
      assert.equal(await page.evaluate(() => window.channels), 0)
      console.log(
        'PASS notifications ' +
          width +
          ': unread/realtime, empty/feed, mark all, safe navigation, error retry, compact four-category feed, View/read/focus, arrow navigation, combined filters, batch read/delete/retry, selection pruning, loaded-window preservation, logout teardown, bounded panel/no overflow'
      )
      await page.close()
    }
  } finally {
    await browser.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
