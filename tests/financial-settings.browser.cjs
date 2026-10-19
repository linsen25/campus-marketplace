/* global window, document, getComputedStyle */
// Offline real UI + native dialog. No credentials, hosted API or simulator writes.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
fs.writeFileSync(
  path.join(root, 'financial-link.js'),
  'export function Link(){return null}'
)
aliases['@ui/link/link'] = path.join(root, 'financial-link.js')
fs.writeFileSync(
  path.join(root, 'financial-mock.js'),
  `export function useFinancialCapabilities(){return {data:window.capabilities,loading:false,error:'',refresh:async()=>{}}}`
)
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import '@/components/animata/button/shining-button.css';import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {LazyMotion,domAnimation} from 'framer-motion';import {FinancialSettings,FinancialCapabilitySection} from '@/components/home/financial-settings';
const root=createRoot(document.getElementById('root'));window.process={env:{}};document.body.style.background='#160f1d';document.body.style.color='white';
window.show=(payment='unset',payout='unset',preview=false)=>{window.capabilities={paymentMethod:{status:payment,brand:'Visa',last4:'4242'},payoutAccount:{status:payout,institution:'Bank account',last4:'1234'}};flushSync(()=>root.render(<LazyMotion features={domAnimation}><FinancialSettings key={payment+payout} settings={!preview} onManage={()=>{}}/></LazyMotion>))};
window.actionCase=(pending,error)=>flushSync(()=>root.render(<><FinancialCapabilitySection capability="payment_method" status="unset" action={{pending,error,onStart:()=>{}}}/><FinancialCapabilitySection capability="payout_account" status="unset" action={{onStart:()=>{}}}/></>));
`
)
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
  try {
    for (const width of [390, 430, 820, 1280, 1536]) {
      const p = await browser.newPage({
        viewport: { width, height: 900 },
        serviceWorkers: 'block',
      })
      const errors = []
      let requests = 0
      p.on('pageerror', (e) => errors.push(e.message))
      await p.route(/^https?:/, (r) => {
        requests++
        return r.abort()
      })
      await p.goto(
        'file://' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      assert.deepEqual(errors, [])
      const section = (k) => p.locator(`[data-financial-capability="${k}"]`)
      const dialogWidths = {}
      for (const [payment, payout] of [
        ['unset', 'unset'],
        ['set', 'unset'],
        ['unset', 'ready'],
        ['needs_attention', 'needs_attention'],
      ]) {
        await p.evaluate(([a, b]) => window.show(a, b), [payment, payout])
        assert.equal(
          await section('payment_method')
            .getByText(
              payment === 'unset'
                ? 'Not set'
                : payment === 'set'
                ? 'Ready'
                : 'Needs attention',
              { exact: true }
            )
            .count(),
          0
        )
        assert.equal(
          await section('payout_account')
            .getByText(
              payout === 'unset'
                ? 'Not set'
                : payout === 'ready'
                ? 'Ready'
                : 'Needs attention',
              { exact: true }
            )
            .count(),
          0
        )
        assert.equal(await p.getByText(/Simulate|STAGING ONLY/).count(), 0)
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        )
        if (payment === 'unset' && payout === 'unset')
          await p.screenshot({
            path: path.join(root, `financial-settings-page-${width}.png`),
          })
        for (const key of ['payment_method', 'payout_account']) {
          const button = section(key).getByRole('button')
          assert.equal(
            await button.evaluate((node) =>
              getComputedStyle(node).getPropertyValue('--surface').trim()
            ),
            '#7c3aed',
            'Settings setup/manage/resolve actions use the primary purple'
          )
          await button.click()
          const dialog = p.getByRole('dialog')
          await dialog.waitFor()
          assert.equal(
            await p.evaluate(
              () => getComputedStyle(document.documentElement).overflowY
            ),
            'hidden'
          )
          await p.waitForFunction(
            () =>
              getComputedStyle(document.querySelector('dialog')).opacity === '1'
          )
          assert.equal(
            await dialog
              .locator('input, textarea, select, [contenteditable="true"]')
              .count(),
            0
          )
          const preview = dialog.getByRole('group', {
            name: 'Card form preview, not interactive',
          })
          assert.equal(await preview.count(), key === 'payment_method' ? 1 : 0)
          if (key === 'payment_method') {
            for (const text of [
              'Card information',
              'Card number',
              'MM / YY',
              'CVC',
              'Name on card',
              'Full name',
              'Country or region',
              'Canada',
              'Postal code',
            ])
              assert.equal(
                await preview.getByText(text, { exact: true }).count(),
                1
              )
            const fields = await preview
              .locator('[class*="previewField"], [class*="countryPreview"]')
              .evaluateAll((nodes) =>
                nodes.map((n) => n.getBoundingClientRect().height)
              )
            assert.equal(fields.length, 6)
            assert(fields.every((h) => h === 48))
            assert.equal(await preview.locator('[tabindex],button').count(), 0)
            const country = preview.locator('[class*="countryPreview"]')
            assert(
              (await country.getAttribute('class')).includes(
                'filter_interaction_module_css_trigger'
              )
            )
            assert.equal(
              await country.evaluate(
                (n) => getComputedStyle(n).backgroundColor
              ),
              'rgb(255, 255, 255)'
            )
            assert.equal(
              await country.evaluate((n) => getComputedStyle(n).color),
              'rgb(24, 24, 27)'
            )
          }
          const cancel = dialog.getByRole('button', {
            name: 'Cancel',
            exact: true,
          })
          assert.equal(
            await cancel.locator('.shining-button__arrow').count(),
            0
          )
          assert.equal(
            await cancel
              .locator('.shining-button__body')
              .evaluate((n) => getComputedStyle(n).backgroundColor),
            'rgb(119, 45, 64)'
          )
          const primary = dialog.getByRole('button', {
            name:
              key === 'payment_method'
                ? payment === 'set'
                  ? 'Save changes'
                  : 'Save payment method'
                : 'Continue',
            exact: true,
          })
          assert(
            (await primary.getAttribute('class')).includes(
              'shining-button--green'
            )
          )
          assert.equal(
            await primary
              .locator('.shining-button__arrow[aria-hidden="true"]')
              .count(),
            1
          )
          assert.equal(await dialog.getByRole('tab').count(), 0)
          assert.equal(
            await dialog
              .getByText(/PayPal|Apple Pay|Google Pay|Afterpay|Klarna/)
              .count(),
            0
          )
          if (key === 'payment_method') {
            assert.equal(
              await preview.locator('svg[aria-hidden="true"]').count(),
              6
            )
            assert.deepEqual(
              await preview
                .locator('[class*="previewLabel"]')
                .allTextContents(),
              ['Name on card', 'Country or region', 'Card information']
            )
          }
          assert(
            await dialog
              .getByRole('button', {
                name:
                  key === 'payment_method'
                    ? payment === 'set'
                      ? 'Save changes'
                      : 'Save payment method'
                    : 'Continue',
                exact: true,
              })
              .isDisabled()
          )
          assert.equal(
            await dialog.locator('#stripe-payment-element-host').count(),
            key === 'payment_method' ? 1 : 0
          )
          if (
            payment === 'unset' &&
            payout === 'unset' &&
            key === 'payment_method'
          )
            await p.screenshot({
              path: path.join(root, `financial-setup-dialog-${width}.png`),
            })
          const bounds = await dialog.boundingBox()
          if (dialogWidths[key]) assert.equal(bounds.width, dialogWidths[key])
          else dialogWidths[key] = bounds.width
          assert(await dialog.evaluate((n) => n.scrollWidth <= n.clientWidth))
          assert(
            bounds.x >= 0 &&
              bounds.x + bounds.width <= width &&
              bounds.y >= 0 &&
              bounds.y + bounds.height <= 900
          )
          await p.keyboard.press('Tab')
          assert(
            await dialog.evaluate((n) => n.contains(document.activeElement))
          )
          await p.keyboard.press('Shift+Tab')
          assert(
            await dialog.evaluate((n) => n.contains(document.activeElement))
          )
          if (key === 'payment_method') await p.keyboard.press('Escape')
          else
            await dialog
              .getByRole('button', { name: 'Cancel', exact: true })
              .click()
          await dialog.waitFor({ state: 'detached' })
          assert(
            await button.evaluate((n) => n === document.activeElement),
            'focus restored'
          )
        }
      }
      await p.evaluate(() => window.actionCase(true, ''))
      assert(await section('payment_method').getByRole('button').isDisabled())
      assert.equal(
        await section('payment_method')
          .getByRole('button')
          .evaluate((node) =>
            getComputedStyle(node).getPropertyValue('--surface').trim()
          ),
        '#775497',
        'Disabled setup keeps its original muted treatment'
      )
      assert(await section('payout_account').getByRole('button').isEnabled())
      await p.evaluate(() =>
        window.actionCase(
          false,
          'Unable to start payment setup. Please try again.'
        )
      )
      assert.equal(
        await section('payment_method').getByRole('alert').count(),
        1
      )
      assert.equal(
        await section('payout_account').getByRole('alert').count(),
        0
      )
      assert(await section('payment_method').getByRole('button').isEnabled())
      await p.evaluate(() => window.show('set', 'ready', true))
      assert.equal(await p.getByText('Manage in Settings').count(), 1)
      assert.equal(await p.getByText(/4242|1234/).count(), 0)
      assert.equal(requests, 0, 'no remote/provider/simulator requests')
      assert.deepEqual(errors, [])
      await p.screenshot({
        path: path.join(root, `financial-settings-${width}.png`),
      })
      console.log(
        'PASS',
        width,
        'states, independent actions/errors, modal, keyboard, no writes/overflow'
      )
      await p.close()
    }
  } finally {
    await browser.close()
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
