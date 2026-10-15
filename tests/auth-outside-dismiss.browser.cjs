// Actual Auth modal outside-interaction regression; offline transport, no real Auth requests.
/* global document */
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
export async function marketplaceRequest(url,method,body){window.calls.push({url,method});if(url.includes('pending-signup-state'))return {resumable:false};if(url.includes('username-availability'))return {available:true};if(url.endsWith('sign-in'))throw Error('Offline sign-in test error');if(url.endsWith('verify-signup')){await new Promise(r=>setTimeout(r,500));throw Error('Offline verification test error')};return null}
`
  )
  fs.writeFileSync(
    path.join(root, 'entry.tsx'),
    `
import 'tailwindcss/src/css/preflight.css';import React from 'react';import {createRoot} from 'react-dom/client';
import {AuthModalProvider,useAuthModal} from '@/components/auth/auth-modal';

function Open(){const {openAuth}=useAuthModal();return <button onClick={()=>openAuth({mode:'signin'})}>Open Auth</button>}
window.calls=[];createRoot(document.getElementById('root')).render(<AuthModalProvider><Open/></AuthModalProvider>);

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
    for (const width of [390, 430, 820, 1280, 1536]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        hasTouch: width < 500,
        isMobile: width < 500,
        serviceWorkers: 'block',
      })
      page.setDefaultTimeout(5000)
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

      const assertOpen = async () =>
        assert(
          await dialog.evaluate((e) => e.open),
          'Outside interaction must leave Auth open'
        )
      const outside = async () => {
        await page.mouse.click(2, 2)
        await assertOpen()
        if (width < 500) {
          await page.touchscreen.tap(2, 2)
          await assertOpen()
        }
        for (const name of ['Western email', 'Password']) {
          const input = dialog.getByLabel(name, { exact: true })
          if (await input.isDisabled()) continue
          await input.fill(
            name === 'Password' ? 'Password1!' : 'selection@uwo.ca'
          )
          const box = await input.boundingBox()
          await page.mouse.move(box.x + 30, box.y + box.height / 2)
          await page.mouse.down()
          await page.mouse.move(2, 2, { steps: 12 })
          await page.mouse.up()
          await assertOpen()
          await input.focus()
          await page.keyboard.press('Control+a')
          if (name === 'Password')
            assert.deepEqual(
              await input.evaluate((e) => [e.selectionStart, e.selectionEnd]),
              [0, (await input.inputValue()).length]
            )
          else {
            await page.keyboard.type('edited@uwo.ca')
            assert.equal(await input.inputValue(), 'edited@uwo.ca')
          }
        }
      }
      await outside()
      // Existing login validation/error feedback still works with offline transport.
      await dialog.getByRole('button', { name: 'Log in', exact: true }).click()
      await dialog
        .getByText('Offline sign-in test error', { exact: true })
        .waitFor()
      await assertOpen()
      await dialog.getByRole('tab', { name: 'Sign up', exact: true }).click()
      await dialog.getByLabel('Verification code', { exact: true }).waitFor()
      await outside()
      await dialog.getByLabel('Username', { exact: true }).fill('Outside_test')
      await dialog.getByRole('checkbox').check()
      await dialog
        .getByRole('button', { name: 'Send code', exact: true })
        .click()
      await dialog
        .getByText('Verification code sent', { exact: false })
        .first()
        .waitFor()
      await outside()
      assert(
        await dialog
          .getByLabel('Verification code', { exact: true })
          .isEditable()
      )
      for (let i = 0; i < 14; i++) {
        await page.keyboard.press('Tab')
        assert(
          await dialog.evaluate((e) => e.contains(document.activeElement)),
          'Focus stays in Auth'
        )
      }
      await dialog.getByRole('button', { name: 'Close authentication' }).click()
      await dialog.waitFor({ state: 'detached' })
      await page.getByRole('button', { name: 'Open Auth' }).click()
      await dialog.waitFor()
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached' })
      assert.deepEqual(errors, [])
      console.log(
        'PASS ' +
          width +
          ': login/signup/verification outside click, touch where mobile, field drag/release, selection/edit, Send code, focus trap, X and unchanged Escape'
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
