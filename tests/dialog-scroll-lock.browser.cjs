/* global window, document */
// Native dialogs and real wheel/touch input; offline, no accounts or persistence.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {LazyMotion,domAnimation,AnimatePresence} from 'framer-motion';import {FadingDialog} from '@/components/ui/fading-dialog';import profile from '@/components/home/profile.module.css';
function App(){const [a,A]=useState(false),[b,B]=useState(false);window.removeParent=()=>A(false);window.routeAway=()=>{A(false);B(false)};return <LazyMotion features={domAnimation}><div id="marker" style={{width:'80%',margin:'auto'}}><button id="opener" onClick={()=>A(true)}>Open Settings</button></div><div style={{height:3000}}/><AnimatePresence>{a&&<FadingDialog key="a" className={profile.dialog} aria-label="Parent" onRequestClose={()=>A(false)}><h3>Settings</h3><button onClick={()=>B(true)}>Open nested</button><button onClick={()=>A(false)}>Cancel</button><div style={{height:1400}}>Internal scroll content</div><button onClick={()=>A(false)}>Success</button></FadingDialog>}{b&&<FadingDialog key="b" className={profile.dialog} aria-label="Child" onRequestClose={()=>B(false)}><button onClick={()=>B(false)}>Close child</button></FadingDialog>}</AnimatePresence></LazyMotion>};createRoot(document.getElementById('root')).render(<App/>);
`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}html{scrollbar-gutter:stable;scroll-behavior:smooth}body{margin:0;padding:12px 7px;overflow:auto!important;background:#160f1d;color:white}#marker{position:relative;top:420px}</style><div id="root"></div><script src="bundle.js"></script>'
)
async function main() {
  await build()
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--disable-features=OverlayScrollbar'],
  })
  try {
    for (const width of [390, 430, 820, 1280, 1536]) {
      const context = await browser.newContext({
        viewport: { width, height: 720 },
        hasTouch: true,
      })
      const page = await context.newPage()
      let network = 0
      await page.route(/^https?:/, (r) => {
        network++
        return r.abort()
      })
      await page.goto(
        'file://' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      await page.getByRole('button', { name: 'Open Settings' }).waitFor()
      const snapshot = () =>
        page.evaluate(() => {
          const r = document.getElementById('marker').getBoundingClientRect()
          return {
            x: r.x,
            width: r.width,
            y: window.scrollY,
            body: document.body.style.overflow,
            root: document.documentElement.style.overflow,
            padding: document.body.style.paddingRight,
            priority: document.body.style.getPropertyPriority('overflow-y'),
            behavior: document.documentElement.style.scrollBehavior,
          }
        })
      await page.evaluate(() => {
        document.documentElement.style.scrollBehavior = 'auto'
        window.scrollTo(0, 300)
      })
      const before = await snapshot()
      await page.getByRole('button', { name: 'Open Settings' }).click()
      const d = page.getByRole('dialog', { name: 'Parent', exact: true })
      await d.waitFor()
      const locked = await snapshot()
      assert.equal(locked.body, 'hidden')
      assert.equal(locked.root, 'hidden')
      assert.equal(locked.x, before.x)
      assert.equal(locked.width, before.width)
      assert.equal(
        locked.padding,
        before.padding,
        'stable gutter must not double compensate'
      )
      await page.mouse.move(3, 100)
      await page.mouse.wheel(0, 600)
      const cdp = await context.newCDPSession(page)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: 3, y: 500 }],
      })
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: 3, y: 180 }],
      })
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      })
      assert.equal(
        (await snapshot()).y,
        before.y,
        'background wheel/touch must not move document'
      )
      const box = await d.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.wheel(0, 450)
      await page.waitForFunction(
        () => document.querySelector('dialog').scrollTop > 0
      )
      assert.equal(
        (await snapshot()).y,
        before.y,
        'internal scroll is isolated'
      )
      await page.keyboard.press('Escape')
      await d.waitFor({ state: 'detached' })
      assert.deepEqual(await snapshot(), before)
      assert(
        await page
          .locator('#opener')
          .evaluate((e) => e === document.activeElement),
        'focus returned'
      )
      // Cancel, success and route/unmount all release the lock after exit.
      for (const action of ['Cancel', 'Success', 'route']) {
        await page.locator('#opener').click()
        await d.waitFor()
        if (action === 'route') await page.evaluate(() => window.routeAway())
        else await d.getByRole('button', { name: action, exact: true }).click()
        await d.waitFor({ state: 'detached' })
        assert.deepEqual(await snapshot(), before)
      }
      // Removing one modal cannot unlock another, even when released out of order.
      await page.locator('#opener').click()
      await d.getByRole('button', { name: 'Open nested' }).click()
      const child = page.getByRole('dialog', { name: 'Child', exact: true })
      await child.waitFor()
      await page.evaluate(() => window.removeParent())
      await d.waitFor({ state: 'detached' })
      assert.equal((await snapshot()).root, 'hidden')
      await child.getByRole('button', { name: 'Close child' }).click()
      await child.waitFor({ state: 'detached' })
      assert.deepEqual(await snapshot(), before)
      // Browsers without a stable gutter receive measured, temporary compensation.
      await page.evaluate(
        () => (document.documentElement.style.scrollbarGutter = 'auto')
      )
      const fallback = await snapshot()
      await page.locator('#opener').click()
      await d.waitFor()
      const fallbackLocked = await snapshot()
      assert(Math.abs(fallbackLocked.x - fallback.x) < 1)
      assert(Math.abs(fallbackLocked.width - fallback.width) < 1)
      await d.getByRole('button', { name: 'Cancel', exact: true }).click()
      await d.waitFor({ state: 'detached' })
      assert.deepEqual(await snapshot(), fallback)
      assert.equal(network, 0)
      console.log(
        'PASS dialog document lock',
        width,
        'stable/fallback geometry, wheel/touch, internal scroll, Escape/Cancel/success/unmount, nested locks, exact restoration/focus'
      )
      await context.close()
    }
  } finally {
    await browser.close()
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
