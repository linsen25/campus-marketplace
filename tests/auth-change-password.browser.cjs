/* global window */
// Real Settings ChangeDialog, input rules, shared button/dialog and CSS. Offline.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
async function main() {
  fs.writeFileSync(
    path.join(root, 'b04-stubs.js'),
    'export function FinancialSettings(){return null} export function ShopSettings(){return null} export function NotificationSettings(){return null}'
  )
  aliases[path.resolve('components/home/financial-settings.tsx')] = path.join(
    root,
    'b04-stubs.js'
  )
  aliases['@/components/shops/shop-settings'] = path.join(root, 'b04-stubs.js')
  aliases['@/components/notifications/notification-settings'] = path.join(
    root,
    'b04-stubs.js'
  )
  fs.writeFileSync(
    path.join(root, 'entry.tsx'),
    `
import 'tailwindcss/src/css/preflight.css';import React from 'react';import {createRoot} from 'react-dom/client';import {LazyMotion,domAnimation} from 'framer-motion';import {ProfileOverview} from '@/components/home/profile-overview';
window.writes=[];window.result='failure';
window.fixtureRequest=async(url)=>{if(url==='/api/profile/account')return {username:'B04',email:'b04@uwo.ca',emailVerified:true,createdAt:'2026-10-01T00:00:00Z',nextUsernameChangeAt:null};throw Error('Unexpected request')};
window.fetch=async(url,options)=>{if(url!=='/api/auth/change-password')throw Error('Unexpected request');window.writes.push(JSON.parse(options.body));await new Promise(resolve=>{window.finish=resolve});if(window.result==='network')throw Error('offline');return new Response(JSON.stringify(window.result==='failure'?{error:'Current password is incorrect.'}:window.result==='partial'?{passwordUpdated:true,otherSessionsRevoked:false,error:'Your password was changed, but other device sessions could not be revoked.'}:{passwordUpdated:true,otherSessionsRevoked:true}),{status:window.result==='failure'?400:200,headers:{'Content-Type':'application/json'}})};
createRoot(document.getElementById('root')).render(<LazyMotion features={domAnimation}><ProfileOverview settings username="B04"/></LazyMotion>);
`
  )
  await build(aliases)
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
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.addInitScript(() => {
        window.process = { env: { NODE_ENV: 'development' } }
      })
      await page.route(/^https?:/, (r) => r.abort())
      await page.goto(
        'file://' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      const open = () =>
        page
          .getByRole('button', { name: 'Change password', exact: true })
          .click()
      await open()
      const dialog = page.getByRole('dialog'),
        save = dialog.getByRole('button', { name: 'Save', exact: true })
      assert.equal(await dialog.locator('input[type=password]').count(), 3)
      assert(await save.isDisabled())
      await page
        .getByLabel('Current password', { exact: true })
        .fill('Original1!')
      await page.getByLabel('New password', { exact: true }).fill('short')
      await page
        .getByLabel('Confirm new password', { exact: true })
        .fill('short')
      assert(await save.isDisabled())
      const fill = async () => {
        await page
          .getByLabel('Current password', { exact: true })
          .fill('Original1!')
        await page
          .getByLabel('New password', { exact: true })
          .fill('Replacement2!')
        await page
          .getByLabel('Confirm new password', { exact: true })
          .fill('Mismatch2!')
        assert(await save.isDisabled())
        await page
          .getByLabel('Confirm new password', { exact: true })
          .fill('Replacement2!')
      }
      await fill()
      assert(await save.isEnabled())
      await save.click()
      await page.waitForFunction(() => window.writes.length === 1)
      assert(
        await dialog.getByRole('button', { name: 'Saving...' }).isDisabled()
      )
      assert.equal(await dialog.count(), 1)
      await page.evaluate(() => window.finish())
      await dialog.getByRole('alert').waitFor()
      assert(await save.isEnabled())
      assert.equal(
        await page.getByLabel('New password', { exact: true }).inputValue(),
        'Replacement2!'
      )
      await page.evaluate(() => {
        window.result = 'success'
      })
      await save.click()
      await page.waitForFunction(() => window.writes.length === 2)
      assert.equal(await dialog.count(), 1)
      await page.evaluate(() => window.finish())
      await dialog.waitFor({ state: 'detached' })
      for (const outcome of ['partial', 'network']) {
        await open()
        await fill()
        await page.evaluate((value) => {
          window.result = value
          window.finish = null
        }, outcome)
        await save.click()
        await page.waitForFunction(() => Boolean(window.finish))
        await page.evaluate(() => window.finish())
        await dialog.getByRole('alert').waitFor()
        assert(await save.isDisabled())
        const geometry = await dialog.evaluate((el) => ({
          width: el.clientWidth,
          scrollWidth: el.scrollWidth,
        }))
        assert(
          geometry.scrollWidth <= geometry.width + 1,
          'no dialog horizontal overflow'
        )
        if (outcome === 'partial')
          await page.screenshot({
            path: path.join(root, 'b04-password-' + width + '.png'),
          })
        await dialog
          .getByRole('button', { name: 'Cancel', exact: true })
          .click()
        await dialog.waitFor({ state: 'detached' })
      }
      assert.deepEqual(errors, [])
      await page.close()
      console.log(
        'B04 Settings dialog ' +
          width +
          ': validation, async wait, failure/retry, partial/unknown no-repeat, no horizontal overflow passed.'
      )
    }
  } finally {
    await browser.close()
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
