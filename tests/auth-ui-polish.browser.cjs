// Actual Auth modal/scroll timer/HoldButton; offline transport, no real Auth requests.
/* global window, document, getComputedStyle */
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
async function main() {
  fs.writeFileSync(
    path.join(root, 'polish-mocks.tsx'),
    `
export const Link=({children,...props})=><a {...props}>{children}</a>;
export function useRouter(){return {prefetch:async()=>{},push:async()=>{throw Error('Unexpected navigation')}}}
export function useMarketplaceSession(){return {refresh:async()=>{throw Error('Unexpected session change')}}}
export async function marketplaceRequest(url,method,body){window.calls.push({url,method});if(url.includes('pending-signup-state'))return {resumable:false};if(url.includes('username-availability'))return {available:true};if(url.endsWith('verify-signup')){await new Promise(r=>setTimeout(r,500));throw Error('Offline verification test error')};return null}
`
  )
  fs.writeFileSync(
    path.join(root, 'entry.tsx'),
    `
import 'tailwindcss/src/css/preflight.css';import React from 'react';import {createRoot} from 'react-dom/client';
import {AuthModalProvider,useAuthModal} from '@/components/auth/auth-modal';
import HoldButton from '@/components/react-bits/hold-button/hold-button';import authStyles from '@/components/velora/auth-signup-card.module.css';
function Open(){const {openAuth}=useAuthModal();return <button onClick={()=>openAuth({mode:'signin'})}>Open Auth</button>}
window.calls=[];createRoot(document.getElementById('root')).render(<AuthModalProvider><Open/></AuthModalProvider>);
window.showCompletion=()=>{const node=document.createElement('div');node.dataset.completionCheck='';document.querySelector('dialog').append(node);createRoot(node).render(<HoldButton className={authStyles.holdSubmit} holdTime={1000} doneLabel="Create account" onHold={()=>{}}>Visual Hold</HoldButton>)};
`
  )
  const alias = Object.fromEntries(
    [
      '@ui/link/link',
      'next/router',
      '@/components/listings/marketplace-session',
      '@/lib/listings-api',
    ].map((name) => [name, path.join(root, 'polish-mocks.tsx')])
  )
  await build(alias)
  for (const file of ['entry.tsx', 'api.ts', 'polish-mocks.tsx'])
    fs.unlinkSync(path.join(root, file))
  fs.writeFileSync(
    path.join(root, 'index.html'),
    '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;font-family:Arial}</style><div id="root"></div><script src="bundle.js"></script>'
  )
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const width of [390, 430, 1280, 1536]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        hasTouch: width < 500,
        isMobile: width < 500,
        serviceWorkers: 'block',
      })
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.route('https://**/*', (route) => route.abort())
      await page.goto(
        'file://' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      await page.getByRole('button', { name: 'Open Auth' }).click()
      const dialog = page.locator('dialog[aria-labelledby="auth-title"]')
      await dialog.waitFor()
      await page.waitForTimeout(300)
      const inspect = () =>
        dialog.evaluate((e) => ({
          width: e.clientWidth,
          top: e.scrollTop,
          height: e.clientHeight,
          scrollHeight: e.scrollHeight,
          color: getComputedStyle(e).scrollbarColor,
          transition: getComputedStyle(e).transitionProperty,
          duration: getComputedStyle(e).transitionDuration,
          overflow: getComputedStyle(e).overflowY,
          children: [...e.querySelectorAll('*')].filter(
            (c) =>
              getComputedStyle(c).overflowY === 'auto' &&
              c.scrollHeight > c.clientHeight
          ).length,
        }))
      for (const mode of ['signin', 'signup']) {
        if (mode === 'signup') {
          await dialog
            .getByRole('tab', { name: 'Sign up', exact: true })
            .click()
          await dialog.locator('form[data-auth-mode="signup"]').waitFor()
        }
        await page.setViewportSize({ width, height: 360 })
        await page.waitForTimeout(1000)
        const idle = await inspect()
        assert.equal(idle.overflow, 'auto')
        assert.equal(idle.children, 0)
        assert(idle.scrollHeight > idle.height)
        assert.equal(idle.color, 'rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)')
        assert.equal(idle.transition, 'scrollbar-color')
        assert.equal(idle.duration, '0.22s')
        const bounds = await dialog.boundingBox()
        await page.mouse.move(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2
        )
        await page.mouse.wheel(0, 90)
        await page.waitForFunction(() =>
          document
            .querySelector('dialog[aria-labelledby="auth-title"]')
            .hasAttribute('data-scrolling')
        )
        await page.waitForTimeout(260)
        const active = await inspect()
        assert.equal(active.color, 'rgb(245, 245, 245) rgba(0, 0, 0, 0)')
        assert.equal(active.width, idle.width)
        assert(active.top > idle.top)
        await page.waitForFunction(
          () =>
            !document
              .querySelector('dialog[aria-labelledby="auth-title"]')
              .hasAttribute('data-scrolling')
        )
        await page.waitForTimeout(60)
        const fading = await inspect()
        assert.notEqual(
          fading.color,
          idle.color,
          'Fade must be intermediate, not an instant switch'
        )
        await page.waitForTimeout(220)
        assert.equal((await inspect()).color, idle.color)
        assert.equal((await inspect()).width, idle.width)
        if (width < 500) {
          await dialog.evaluate((e) => {
            e.scrollTop = 0
          })
          await page.waitForTimeout(900)
          const cdp = await page.context().newCDPSession(page)
          const x = bounds.x + bounds.width / 2,
            y = bounds.y + bounds.height * 0.75
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ x, y }],
          })
          for (let step = 1; step <= 8; step++) {
            await cdp.send('Input.dispatchTouchEvent', {
              type: 'touchMove',
              touchPoints: [{ x, y: y - step * 12 }],
            })
            await page.waitForTimeout(30)
          }
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchEnd',
            touchPoints: [],
          })
          await page.waitForTimeout(100)
          assert((await inspect()).top > 0, 'Native touch scroll must work')
          await cdp.detach()
        }
      }
      await page.setViewportSize({ width, height: 900 })
      const hold = dialog.getByRole('button', {
        name: /Hold to create account/,
      })
      const visual = () =>
        hold.evaluate((e) => ({
          bg: getComputedStyle(e).backgroundColor,
          text: getComputedStyle(e).color,
          opacity: getComputedStyle(e).opacity,
          height: e.offsetHeight,
          radius: getComputedStyle(e).borderRadius,
          phase: e.dataset.phase,
          fill: getComputedStyle(e.querySelector('[class*="__fill"]'))
            .backgroundColor,
          hold: e.style.getPropertyValue('--hb-hold'),
        }))
      const disabled = await visual()
      assert.equal(await hold.isDisabled(), true)
      assert.equal(disabled.bg, 'rgb(39, 39, 42)')
      assert.equal(disabled.opacity, '0.5')
      await dialog.locator('#signup-email').fill('fixture@uwo.ca')
      await dialog.locator('#signup-username').fill('Polish_fixture')
      await dialog.locator('#signup-password').fill('SafeFixture1!')
      await dialog.getByRole('checkbox').check()
      await page.waitForTimeout(500)
      await dialog
        .getByRole('button', { name: 'Send code', exact: true })
        .click()
      await dialog
        .getByLabel('Verification code', { exact: true })
        .fill('123456')
      await page.waitForFunction(
        () => !document.querySelector('button[data-phase]').disabled
      )
      await page.waitForTimeout(200)
      const idle = await visual()
      assert.equal(idle.bg, 'rgb(255, 255, 255)')
      assert.equal(idle.text, 'rgb(17, 17, 17)')
      assert.equal(idle.height, disabled.height)
      assert.equal(idle.radius, disabled.radius)
      assert.equal(idle.hold, '1000ms')
      await hold.click()
      assert.equal(
        await page.evaluate(
          () =>
            window.calls.filter((c) => c.url.endsWith('verify-signup')).length
        ),
        0
      )
      await hold.scrollIntoViewIfNeeded()
      const box = await hold.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.waitForTimeout(350)
      const holding = await visual()
      assert.equal(holding.phase, 'holding')
      assert.equal(holding.fill, 'rgb(82, 39, 255)')
      assert.notEqual(holding.bg, idle.bg)
      await page.waitForTimeout(720)
      assert.equal(
        await page.evaluate(
          () =>
            window.calls.filter((c) => c.url.endsWith('verify-signup')).length
        ),
        1
      )
      await page.mouse.up()
      await dialog
        .getByText('Offline verification test error', { exact: true })
        .waitFor()
      await page.waitForTimeout(1300)
      await hold.focus()
      await page.keyboard.down('Space')
      await page.waitForTimeout(1100)
      await page.keyboard.up('Space')
      await page.waitForTimeout(1500)
      await hold.focus()
      await page.keyboard.down('Enter')
      await page.waitForTimeout(1100)
      await page.keyboard.up('Enter')
      assert.equal(
        await page.evaluate(
          () =>
            window.calls.filter((c) => c.url.endsWith('verify-signup')).length
        ),
        3
      )
      // Verify actual shared completion visuals separately from form mutation rerenders.
      await page.evaluate(() => window.showCompletion())
      const completion = dialog.locator('[data-completion-check] button')
      await completion.waitFor()
      await completion.focus()
      await page.keyboard.down('Space')
      await page.waitForTimeout(1100)
      assert.equal(await completion.getAttribute('data-phase'), 'done')
      assert.equal(
        await completion.evaluate(
          (e) =>
            getComputedStyle(e.querySelector('[class*="__fill"]'))
              .backgroundColor
        ),
        holding.fill
      )
      assert.equal(
        await completion.evaluate((e) => getComputedStyle(e).color),
        'rgb(245, 245, 245)'
      )
      assert.match(await completion.innerText(), /Create account/)
      await page.keyboard.up('Space')
      assert.deepEqual(errors, [])
      console.log(
        `PASS ${width}: real sign-in/signup scroll, smooth 220ms fade / 600ms idle, stable width, no nested scroll${
          width < 500 ? ', native touch scroll' : ''
        }; muted disabled / white idle / original progress and done, 1000ms pointer/Space/Enter holds.`
      )
      await page.close()
    }
  } finally {
    await browser.close()
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
