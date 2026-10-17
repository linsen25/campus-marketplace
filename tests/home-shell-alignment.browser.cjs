/* global window,document,getComputedStyle */
// Actual Home/navigation/header with offline leaf data surfaces; no hosted requests.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const mocks = require('./browser-fixture-mocks.cjs')(root)
fs.writeFileSync(
  path.join(root, 'home-leaves.tsx'),
  `
import React from 'react';import {ShopListingWorkspace} from '@/components/shops/shop-listing-workspace';
export const HomeListings=({page})=>page==='my-shop'?<ShopListingWorkspace/>:<p>Listings</p>;
export const ProfileOverview=()=> <p>Account content</p>;
export const AccountAnalysis=()=> <p>Analysis content</p>;
export const Messages=()=>null;export const Orders=()=>null;export const NotificationsView=()=>null;
export const SettingsLogout=()=>null;export const useProfileLogout=()=>()=>{};
const order={selection:null,showList(){}};export const useOrderVisual=()=>order;
export const useDesktopRouteTransition=()=>()=>{};export const usePendingDestination=()=>null;
`
)
fs.writeFileSync(
  path.join(root, 'router-mock.js'),
  `const listeners=new Set();const router={query:{},events:{on:(e,f)=>listeners.add(f),off:(e,f)=>listeners.delete(f)},push:async()=>{}};window.routeTo=section=>{router.query={section};listeners.forEach(f=>f())};export const useRouter=()=>router;`
)
fs.writeFileSync(
  path.join(root, 'next-dynamic.js'),
  `export default ()=>()=>null`
)
fs.writeFileSync(
  path.join(root, 'link-mock.tsx'),
  `import React from 'react';export const Link=props=><a {...props}/>;`
)
fs.writeFileSync(
  path.join(root, 'notification-bell-mock.tsx'),
  `import React from 'react';import {Bell} from 'lucide-react';import styles from '@/components/notifications/notification-bell.module.css';export const NotificationBell=()=> <button className={styles.bell} aria-label="Header notifications"><Bell size={22}/></button>;`
)
const leaves = path.join(root, 'home-leaves.tsx')
for (const name of [
  'profile-overview',
  'account-analysis',
  'messages',
  'orders',
  'settings-logout',
  'profile-logout',
  'order-visual-context',
])
  mocks['./' + name + '$'] = leaves
Object.assign(mocks, {
  '@/components/listings/home-listings': leaves,
  '@/components/navigation/desktop-route-transition': leaves,
  '@/components/notifications/notifications-view': leaves,
  '@/components/notifications/notification-bell': path.join(
    root,
    'notification-bell-mock.tsx'
  ),
  '@ui/link/link': path.join(root, 'link-mock.tsx'),
  'next/dynamic': path.join(root, 'next-dynamic.js'),
})
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import '@/styles/desktop-app-tokens.css';import '@/components/animata/button/shining-button.css';import React from 'react';import {createRoot} from 'react-dom/client';import {LazyMotion,domAnimation} from 'framer-motion';import {AnimatedSidebarDemo} from '@/components/home/animated-sidebar-demo';
window.actions=[];window.requests=[];const root=createRoot(document.getElementById('root'));root.render(<LazyMotion features={domAnimation}><AnimatedSidebarDemo/></LazyMotion>);
`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;font-family:Arial}html{scrollbar-gutter:stable}</style><div id="root"></div><script src="bundle.js"></script>'
)
async function measure(page) {
  return page.locator('[data-slot="sidebar-body"]').evaluate((nav) => {
    const rect = (e) => e.getBoundingClientRect().toJSON(),
      cx = (e) => {
        const b = rect(e)
        return b.x + b.width / 2
      }
    const icons = {
      back: cx(nav.querySelector('[aria-label="Back to Market"]')),
    }
    for (const label of [
      'Profile',
      'Listings',
      'Messages',
      'Orders',
      'Notifications',
      'Settings',
    ]) {
      const el = [...nav.querySelectorAll('a')].find(
        (a) => a.textContent.trim() === label
      )
      icons[label] = cx(el.querySelector('svg'))
    }
    icons.chevron = cx(nav.querySelector('button[aria-pressed] svg'))
    const active = nav.querySelector('a[aria-current="page"]')
    return {
      rail: rect(nav),
      padding: getComputedStyle(nav).paddingInline,
      icons,
      active: rect(active),
      main: rect(nav.closest('[data-slot="sidebar"]').querySelector('main')),
    }
  })
}

const near = (a, b, label) =>
  assert(Math.abs(a - b) <= 0.5, `${label}: ${a} vs ${b}`)
function centered(m, axis = m.rail.x + 32) {
  for (const [name, x] of Object.entries(m.icons)) near(x, axis, name)
  near(
    m.active.x + m.active.width / 2,
    m.rail.x + m.rail.width / 2,
    'active background center'
  )
  near(
    m.active.x - m.rail.x,
    m.rail.right - m.active.right,
    'equal active side insets'
  )
}
async function headerState(page, width) {
  return page
    .locator(
      width >= 1024 ? '[data-home-section-header]' : '[data-home-mobile-header]'
    )
    .evaluate((el) => {
      const title = el.querySelector('h1,h2'),
        t = title.getBoundingClientRect(),
        css = getComputedStyle(title)
      return {
        box: el.getBoundingClientRect().toJSON(),
        title: {
          x: t.x,
          y: t.y,
          font: css.fontSize,
          line: css.lineHeight,
          weight: css.fontWeight,
        },
        bell: el
          .querySelector('[aria-label="Header notifications"]')
          .getBoundingClientRect()
          .toJSON(),
      }
    })
}
(async () => {
  await build(mocks)
  for (const name of [
    'entry.tsx',
    'home-leaves.tsx',
    'link-mock.tsx',
    'notification-bell-mock.tsx',
  ])
    fs.unlinkSync(path.join(root, name))
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const width of [390, 430, 820, 1280, 1536])
      for (const reducedMotion of ['reduce', 'no-preference']) {
        const page = await browser.newPage({
          viewport: { width, height: 900 },
          reducedMotion,
        })
        page.setDefaultTimeout(6000)
        const errors = []
        let network = 0
        page.on('pageerror', (e) => errors.push(e.message))
        await page.route(/^https?:/, (r) => {
          network++
          return r.abort()
        })
        await page.goto(
          'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
        )
        await page
          .getByRole('heading', {
            name: width >= 1024 ? 'Profile' : 'Overview',
            exact: true,
          })
          .waitFor()
        const profile = await headerState(page, width)
        const nav = page.locator('[data-slot="sidebar-body"]')
        const settle = async () => {
          if (width >= 1024) {
            await page
              .locator('[data-home-section-header]')
              .click({ position: { x: 200, y: 10 } })
            await page.mouse.move(width - 20, 880)
            await page.waitForTimeout(350)
          }
        }
        let initial
        if (width >= 1024) {
          await settle()
          initial = await measure(page)
          centered(initial)
          near(initial.rail.width, 64, 'collapsed rail width')
          console.log('RAIL', width, reducedMotion, JSON.stringify(initial))
        }
        // Switch actual navigation, not a separate imitation of the Home shell.
        if (width >= 1024)
          await nav.getByRole('link', { name: 'Settings', exact: true }).click()
        else {
          await page
            .getByRole('button', { name: 'Open Home navigation', exact: true })
            .click()
          await page
            .locator('[data-smooth-menu]')
            .getByRole('button', { name: 'Settings', exact: true })
            .click()
        }
        await page
          .getByRole('heading', { name: 'Settings', exact: true })
          .waitFor()
        await settle()
        const settings = await headerState(page, width)
        if (width >= 1024) {
          await nav.getByRole('link', { name: 'Listings', exact: true }).click()
          await nav
            .getByRole('button', { name: 'My Shop', exact: true })
            .click()
        } else {
          await page
            .getByRole('button', { name: 'Open Home navigation', exact: true })
            .click()
          const menu = page.locator('[data-smooth-menu]')
          await menu
            .getByRole('button', { name: 'Listings', exact: true })
            .click()
          await menu
            .getByRole('button', { name: 'My Shop', exact: true })
            .click()
        }
        await page
          .getByRole('heading', { name: 'My Shop', exact: true })
          .waitFor()
        await settle()
        const shop = await headerState(page, width)
        assert.deepEqual(
          shop,
          settings,
          'My Shop header exactly matches Settings'
        )
        assert.deepEqual(
          shop,
          profile,
          'My Shop header exactly matches Profile'
        )
        const pricing = page.locator('[data-shop-pro-pricing]:visible')
        assert.equal(await pricing.locator('label').count(), 3)
        assert(
          await pricing.getByRole('radio', { name: /^3 Months/ }).isChecked()
        )
        if (width >= 1024) {
          const current = await measure(page)
          centered(current)
          assert.deepEqual(
            current.rail,
            initial.rail,
            'rail does not move across tabs'
          )
          assert.deepEqual(
            current.main,
            initial.main,
            'workspace does not move across tabs'
          )
          // Reverse base/style insertion order to guard against CSS chunk/HMR ordering.
          await page.evaluate(() => {
            const nav = document.querySelector('[data-slot="sidebar-body"]')
            const token = [...nav.classList].find((x) => x.endsWith('_panel'))
            const style = [...document.querySelectorAll('style')].find((s) =>
              s.textContent.includes('.' + token)
            )
            document.head.appendChild(style)
          })
          centered(await measure(page))
          await nav.hover()
          await page.waitForTimeout(350)
          const hover = await measure(page)
          near(hover.rail.width, 240, 'hover expanded width')
          centered(hover)
          near(
            hover.main.x,
            initial.main.x,
            'hover does not displace workspace'
          )
          await nav
            .getByRole('button', { name: 'Keep expanded', exact: true })
            .click()
          await settle()
          const pinned = await measure(page)
          centered(pinned)
          near(
            pinned.main.x,
            initial.main.x + 176,
            'pin reserves existing sidebar width'
          )
          await nav.getByRole('link', { name: 'Settings', exact: true }).click()
          await settle()
          const pinnedSettings = await headerState(page, width)
          await nav.getByRole('link', { name: 'Listings', exact: true }).click()
          await nav
            .getByRole('button', { name: 'My Shop', exact: true })
            .click()
          await settle()
          assert.deepEqual(
            await headerState(page, width),
            pinnedSettings,
            'pinned header parity'
          )
          await nav
            .getByRole('button', { name: 'Keep expanded', exact: true })
            .click()
          await settle()
          centered(await measure(page))
        }
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          ),
          'no horizontal overflow'
        )
        assert.equal(network, 0)
        assert.deepEqual(errors, [])
        if (reducedMotion === 'reduce')
          await page.screenshot({
            path: 'tests/artifacts/home-shell-alignment-' + width + '.png',
          })
        console.log(
          'PASS',
          width,
          reducedMotion,
          'actual Home nav, Profile/Settings/My Shop header parity, rail icon/background/back/pin axis, CSS ordering, no requests/overflow'
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
