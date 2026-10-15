// Real Auth components/CSS with offline transport; never sends email or touches Auth data.
/* global window, document, getComputedStyle */
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { root, build } = require('./message-payload.browser.cjs')
const mocks = require('./browser-fixture-mocks.cjs')(root)
async function main() {
  fs.writeFileSync(
    path.join(root, 'link.tsx'),
    'export const Link=({children,...props})=><a {...props}>{children}</a>'
  )
  mocks['@ui/link/link'] = path.join(root, 'link.tsx')
  const old = execFileSync(
    'git',
    [
      'show',
      '3ce14cd211f1637d5a3ab7dc5cd65e7295a4abc3:components/velora/auth-signup-card.tsx',
    ],
    { encoding: 'utf8' }
  )
  fs.writeFileSync(
    path.join(root, 'historical.tsx'),
    old.replace("'./auth-signup-card.module.css'", "'./historical.module.css'")
  )
  fs.writeFileSync(
    path.join(root, 'historical.module.css'),
    execFileSync(
      'git',
      [
        'show',
        '3ce14cd211f1637d5a3ab7dc5cd65e7295a4abc3:components/velora/auth-signup-card.module.css',
      ],
      { encoding: 'utf8' }
    ).replaceAll('../animata/', '../../../components/animata/')
  )
  fs.writeFileSync(
    path.join(root, 'entry.tsx'),
    `
import 'tailwindcss/src/css/preflight.css';import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {AuthSignupCard} from '@/components/velora/auth-signup-card';import {AuthSignupCard as Historical} from './historical';
const root=createRoot(document.getElementById('root'));window.renderAuth=(historical=false)=>flushSync(()=>root.render(<div style={{width:'calc(100% - 32px)',maxWidth:448,margin:'16px auto'}}>{React.createElement(historical?Historical:AuthSignupCard,{key:String(historical)+Math.random(),initialMode:'signup',onClose:()=>{},onAuthenticated:async()=>{window.readyCalled++;await window.sessionGate;window.market=true}})}</div>));
`
  )
  await build(mocks)
  for (const file of ['entry.tsx', 'api.ts', 'historical.tsx', 'link.tsx'])
    fs.unlinkSync(path.join(root, file))
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  let checks = 0
  try {
    for (const width of [390, 430, 1280, 1536]) {
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
        reducedMotion: 'reduce',
      })
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.route('https://**/*', (route) => route.abort())
      await page.goto(
        'file://' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      assert.deepEqual(errors, [], 'Fixture bootstrap errors')
      await page.evaluate(() => {
        window.calls = []
        window.readyCalled = 0
        window.market = false
        window.resumable = false
        window.failVerify = true
        window.sessionGate = new Promise(
          (resolve) => (window.releaseSession = resolve)
        )
        window.fixtureRequest = async (url, method, body) => {
          window.calls.push({ url, method, body })
          if (url.includes('pending-signup-state'))
            return { resumable: window.resumable }
          if (url.includes('username-availability')) return { available: true }
          if (url.endsWith('verify-signup') && window.failVerify)
            throw Error(
              'This code is incorrect or expired. Request another code.'
            )
          return null
        }
        window.renderAuth()
      })
      const code = page.getByLabel('Verification code', { exact: true })
      await code.waitFor()
      assert.equal(
        await page
          .getByRole('button', { name: 'Resume verification', exact: true })
          .count(),
        0
      )
      assert.equal(
        await page
          .getByRole('button', { name: 'Send code', exact: true })
          .count(),
        1
      )
      const geometry = () =>
        page.evaluate(() =>
          Array.from(
            document.querySelectorAll('form label,form input,form button')
          )
            .filter(
              (e) =>
                e.tagName === 'INPUT' ||
                e.hasAttribute('data-phase') ||
                [
                  'Verification code',
                  'Send code',
                  'Hold to create account',
                ].includes(e.textContent.trim())
            )
            .map((e) => {
              const b = e.getBoundingClientRect(),
                s = getComputedStyle(e)
              return {
                tag: e.tagName,
                name: e.getAttribute('name') || e.textContent.trim(),
                width: Math.round(b.width),
                height: Math.round(b.height),
                x: Math.round(b.x),
                y: Math.round(b.y),
                font: s.fontSize,
              }
            })
        )
      const current = await geometry()
      await page.evaluate(() => window.renderAuth(true))
      await code.waitFor()
      assert.deepEqual(
        await geometry(),
        current,
        'Historical field/action geometry must match'
      )
      await page.evaluate(() => window.renderAuth())
      await page.locator('#signup-email').fill('fixture@uwo.ca')
      await page.locator('#signup-username').fill('Fixture_user')
      await page.locator('#signup-password').fill('SafeFixture1!')
      await page.getByRole('checkbox').check()
      await page.waitForTimeout(500)
      await page
        .getByRole('button', { name: 'Send code', exact: true })
        .dblclick()
      await page.locator('button[data-state="success"]').waitFor()
      assert.match(
        await page.locator('button[data-state="success"]').innerText(),
        /Sent/
      )
      assert.equal(
        await page.evaluate(
          () => window.calls.filter((c) => c.url.endsWith('signup-code')).length
        ),
        1
      )
      assert.equal(
        await page.evaluate(
          () =>
            window.calls.filter((c) => c.url.endsWith('resend-signup')).length
        ),
        0
      )
      await page
        .getByRole('button', { name: /Resend in (60|59|58)s/ })
        .waitFor()
      await code.fill('123456')
      const hold = page.getByRole('button', { name: /Hold to create account/ })
      await hold.click()
      assert.equal(
        await page.evaluate(
          () =>
            window.calls.filter((c) => c.url.endsWith('verify-signup')).length
        ),
        0
      )
      const box = await hold.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.waitForTimeout(1150)
      await page.mouse.up()
      await page
        .getByText('This code is incorrect or expired. Request another code.', {
          exact: true,
        })
        .waitFor()
      await page.waitForTimeout(1300)
      assert.equal(await hold.isEnabled(), true)
      await page.evaluate(() => (window.failVerify = false))
      await hold.focus()
      await page.keyboard.down('Space')
      await page.waitForTimeout(1150)
      await page.keyboard.up('Space')
      await page.waitForFunction(() => window.readyCalled === 1)
      assert.equal(await page.evaluate(() => window.market), false)
      assert.equal(
        await page.evaluate(
          () =>
            window.calls.filter((c) => c.url.endsWith('verify-signup')).length
        ),
        2
      )
      await page.evaluate(() => window.releaseSession())
      await page.waitForFunction(() => window.market)
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        ),
        true
      )
      await page.evaluate(() => {
        window.resumable = true
        window.renderAuth()
      })
      await page
        .getByRole('button', { name: 'Resume verification', exact: true })
        .waitFor()
      await page.evaluate(() => {
        window.resumable = false
        window.renderAuth()
      })
      await page.waitForTimeout(100)
      assert.equal(
        await page
          .getByRole('button', { name: 'Resume verification', exact: true })
          .count(),
        0
      )
      assert.deepEqual(errors, [])
      if (width === 390) {
        await page.evaluate(() => {
          window.calls = []
          window.renderAuth()
        })
        await page.locator('#signup-email').fill('fixture@uwo.ca')
        await page.locator('#signup-username').fill('Fixture_user')
        await page.locator('#signup-password').fill('SafeFixture1!')
        await page.getByRole('checkbox').check()
        await page.waitForTimeout(500)
        await page
          .getByRole('button', { name: 'Send code', exact: true })
          .click()
        await page.locator('button[data-state="success"]').waitFor()
        await page.getByRole('button', { name: /Resend in \d+s/ }).waitFor()
        // Only accelerate cooldown callbacks; HoldButton uses RAF + 1100ms fallback.
        await page.evaluate(() => {
          const native = window.setTimeout.bind(window)
          window.setTimeout = (fn, ms, ...args) =>
            native(fn, ms === 1000 ? 10 : ms, ...args)
        })
        await page
          .getByRole('button', { name: 'Resend code', exact: true })
          .waitFor()
        await page
          .getByRole('button', { name: 'Edit signup details', exact: true })
          .click()
        await page.locator('#signup-username').fill('Corrected_user')
        await page.locator('#signup-password').fill('EditedFixture2!')
        await page.waitForTimeout(500)
        await page
          .getByRole('button', { name: 'Send code', exact: true })
          .click()
        await page.waitForFunction(() =>
          window.calls.some((c) => c.url.endsWith('resend-signup'))
        )
        assert.deepEqual(
          await page.evaluate(() =>
            window.calls.filter((c) => c.method === 'POST').map((c) => c.url)
          ),
          [
            '/api/auth/signup-code',
            '/api/auth/correct-signup-username',
            '/api/auth/resend-signup',
          ]
        )
        assert.equal(await code.inputValue(), '')
        await code.fill('654321')
        await hold.focus()
        await page.keyboard.down('Enter')
        await page.waitForTimeout(1150)
        await page.keyboard.up('Enter')
        await page.waitForFunction(() =>
          window.calls.some((c) => c.url.endsWith('verify-signup'))
        )
        assert.equal(
          await page.evaluate(
            () =>
              window.calls.find((c) => c.url.endsWith('verify-signup')).body
                .updateSignupPassword
          ),
          true
        )
      }
      checks++
      await page.close()
    }
    console.log(
      'Auth restoration: historical field/action geometry, fresh/resume proof, one signup/zero resend, Sent/60s cooldown, short-click suppression, pointer/Space hold, OTP error retry and readiness callback gate passed at 390/430/1280/1536 (' +
        checks +
        ' widths; offline only).'
    )
  } finally {
    await browser.close()
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
