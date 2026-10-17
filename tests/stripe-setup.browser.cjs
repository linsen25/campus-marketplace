/* global window, document, getComputedStyle */
// Real dialog/controller and approved CSS. Stripe UI/HTTPS mocked; not real iframe qualification.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
fs.writeFileSync(
  path.join(root, 'stripe-browser-mock.jsx'),
  `
import React,{useEffect} from 'react';
export const loadStripe=async()=>({});
export function Elements({children,options}){window.elementAppearance=options.appearance;return children}
export function useStripe(){return {confirmSetup:async(options)=>{window.confirmOptions=options;window.confirms++;if(window.failConfirm)return {error:{type:'card_error'}};return {setupIntent:{status:'succeeded'}}}}}
export function useElements(){return {submit:async()=>({})}}
export function PaymentElement({onReady,onChange,options}){useEffect(()=>{window.elementOptions=options;const finish=()=>{onReady();onChange({complete:true})};if(window.holdElement)window.finishElement=finish;else finish()},[]);return <div style={{height:310,width:'100%'}} aria-label="Mock secure card frame"><iframe title="Mock secure card field" style={{width:'100%',height:310,border:0}} srcDoc='<button>Fixture card field</button>' /></div>}
export function Link(){return null}
`
)
for (const name of [
  '@stripe/react-stripe-js',
  '@stripe/stripe-js/pure',
  '@ui/link/link',
])
  aliases[name] = path.join(root, 'stripe-browser-mock.jsx')
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import '@/components/animata/button/shining-button.css';import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {LazyMotion,domAnimation,AnimatePresence} from 'framer-motion';import {FadingDialog} from '@/components/ui/fading-dialog';import {StripeCardSetup} from '@/components/home/stripe-card-setup';import {FinancialSettings} from '@/components/home/financial-settings';import profile from '@/components/home/profile.module.css';import css from '@/components/home/financial-settings.module.css';import FilterInteraction from '@/components/filter-interaction';
window.process={env:{NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:'pk_test_Synthetic'}};window.confirms=0;window.completed=0;window.requests=[];window.status='processing';
window.fixtureRequest=async(url,method,body)=>{window.requests.push({url,method,body});if(url==='/api/stripe/card-setup'){if(window.holdPrepare)await new Promise(r=>window.finishPrepare=()=>{window.holdPrepare=false;r()});if(window.failPrepare)throw Error('Controlled prepare failure');return {publishableKey:'pk_test_Synthetic',clientSecret:'seti_Synthetic_secret_TestOnly',returnUrl:'http://localhost:3000/home?section=settings'}}if(url==='/api/stripe/reconcile')return {setupStatus:window.status,capabilities:{paymentMethod:{status:window.status==='succeeded'?'set':'unset'}}};if(url==='/api/stripe/payout-setup')return new Promise((resolve,reject)=>{window.rejectPayout=()=>reject(Error('Controlled payout setup error'))});throw Error('Unexpected request')};
function App(){const [open,setOpen]=useState(false);const [sortOpen,setSortOpen]=useState(false);const [sort,setSort]=useState('newest');return <LazyMotion features={domAnimation}><FilterInteraction label="Sort" options={[{value:'newest',label:'Newest'},{value:'oldest',label:'Oldest'}]} value={sort} isOpen={sortOpen} onOpenChange={setSortOpen} onChange={setSort}/><button onClick={()=>setOpen(true)}>Open card setup</button><AnimatePresence>{open&&<FadingDialog className={profile.dialog+" "+css.setupDialog+" "+css.paymentDialog} aria-label="Set up payment method" onRequestClose={()=>setOpen(false)}><h3>Set up payment method</h3><StripeCardSetup preview={<div>Card preview</div>} onCancel={()=>setOpen(false)} onComplete={async()=>{window.completed++;setOpen(false)}}/></FadingDialog>}</AnimatePresence></LazyMotion>}
const root=createRoot(document.getElementById('root'));window.showSeller=()=>root.render(<LazyMotion features={domAnimation}><FinancialSettings settings/></LazyMotion>);root.render(<App/>);
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
        viewport: { width, height: width < 640 ? 640 : 900 },
        serviceWorkers: 'block',
      })
      const errors = []
      let network = 0
      p.on('pageerror', (e) => errors.push(e.message))
      await p.route(/^https?:/, (r) => {
        network++
        return r.abort()
      })
      await p.goto(
        'file://' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      const sortTrigger = p.getByRole('button', { name: 'Sort', exact: true })
      await sortTrigger.click()
      await p.getByRole('button', { name: 'Oldest', exact: true }).click()
      await p
        .getByRole('region', { name: 'Sort options', exact: true })
        .waitFor({ state: 'detached' })
      await sortTrigger.click()
      assert.equal(
        await p
          .getByRole('button', { name: 'Oldest', exact: true })
          .getAttribute('aria-pressed'),
        'true'
      )
      await p.keyboard.press('Escape')
      await p
        .getByRole('region', { name: 'Sort options', exact: true })
        .waitFor({ state: 'detached' })
      await p.evaluate(() => {
        window.failPrepare = true
        window.holdPrepare = true
        window.holdElement = true
      })
      await p.getByRole('button', { name: 'Open card setup' }).click()
      const d = p.getByRole('dialog')
      await p.waitForFunction(() => typeof window.finishPrepare === 'function')
      assert.equal(
        await d.getByText('Card preview', { exact: true }).count(),
        0
      )
      await d
        .getByRole('status')
        .filter({ hasText: 'Preparing secure payment setup' })
        .waitFor()
      const loadingHeight = await d
        .locator('#stripe-payment-element-host')
        .evaluate((n) => n.getBoundingClientRect().height)
      await p.evaluate(() => window.finishPrepare())
      await d.getByRole('alert').waitFor()
      assert.equal(
        await d.getByText('Card preview', { exact: true }).count(),
        0,
        'Stripe-enabled initialization/error shell never flashes the fake card preview'
      )
      await p.evaluate(() => (window.failPrepare = false))
      await d.getByRole('button', { name: 'Retry setup' }).click()
      await d.getByLabel('Mock secure card frame').waitFor()
      await p.waitForFunction(() => typeof window.finishElement === 'function')
      await d
        .getByRole('status')
        .filter({ hasText: 'Preparing secure payment setup' })
        .waitFor()
      await p.evaluate(() => {
        window.holdElement = false
        window.finishElement()
      })
      await p.waitForFunction(
        () =>
          document
            .querySelector('#stripe-payment-element-host')
            .getAttribute('aria-busy') === 'false'
      )
      assert.equal(
        await d
          .locator('#stripe-payment-element-host')
          .evaluate((n) => n.getBoundingClientRect().height),
        loadingHeight,
        'loading and mounted Element keep the same reserved surface'
      )
      const save = d.getByRole('button', {
        name: 'Save payment method',
        exact: true,
      })
      await save.click()
      await d.getByRole('button', { name: 'Check status' }).waitFor()
      assert.equal(
        await p.evaluate(() => window.completed),
        0,
        'client confirmation alone never promotes capability'
      )
      await p.evaluate(() => (window.status = 'succeeded'))
      await d.getByRole('button', { name: 'Check status' }).click()
      await d.waitFor({ state: 'detached' })
      assert.equal(await p.evaluate(() => window.completed), 1)
      assert.equal(
        await p.evaluate(
          () =>
            window.confirmOptions.confirmParams.payment_method_data
              .billing_details.address.country
        ),
        'CA'
      )
      assert.deepEqual(await p.evaluate(() => window.elementOptions.fields), {
        billingDetails: { address: { country: 'never' } },
      })
      assert.equal(
        await p.evaluate(() => window.confirms),
        1,
        'reconcile does not repeat confirmation'
      )
      await p.getByRole('button', { name: 'Open card setup' }).click()
      await d.getByLabel('Mock secure card frame').waitFor()
      const rect = await d.boundingBox()
      assert(rect.x >= 0 && rect.x + rect.width <= width)
      assert(await d.evaluate((n) => n.scrollWidth <= n.clientWidth))
      assert.equal(await d.locator('#stripe-payment-element-host').count(), 1)
      assert.equal(await d.locator('input').count(), 0)
      assert.deepEqual(await p.evaluate(() => window.elementOptions.wallets), {
        applePay: 'never',
        googlePay: 'never',
        link: 'never',
      })
      assert.equal(
        await p.evaluate(() => window.elementAppearance.theme),
        'night'
      )
      const cancel = d.getByRole('button', { name: 'Cancel', exact: true })
      assert.equal(await cancel.locator('.shining-button__arrow').count(), 0)
      await cancel.click()
      await d.waitFor({ state: 'detached' })
      assert(
        await p
          .getByRole('button', { name: 'Open card setup' })
          .evaluate((n) => n === document.activeElement)
      )
      await p.getByRole('button', { name: 'Open card setup' }).click()
      await d.getByLabel('Mock secure card frame').waitFor()
      await p.keyboard.press('Escape')
      await d.waitFor({ state: 'detached' })
      await p.evaluate(() => window.showSeller())
      const manage = p
        .getByRole('region', { name: 'Payout account', exact: true })
        .getByRole('button', { name: 'Manage payouts', exact: true })
      await manage.click()
      const sellerDialog = p.getByRole('dialog')
      const next = sellerDialog.getByRole('button', {
        name: 'Continue',
        exact: true,
      })
      assert(await next.isEnabled())
      const before = await next.boundingBox()
      await next.click()
      await p.waitForFunction(() => typeof window.rejectPayout === 'function')
      assert(
        await sellerDialog
          .getByRole('button', { name: 'Cancel', exact: true })
          .isDisabled()
      )
      assert.equal((await next.boundingBox()).width, before.width)
      await p.evaluate(() => window.rejectPayout())
      await sellerDialog.getByRole('alert').waitFor()
      assert(await next.isEnabled())
      await sellerDialog
        .getByRole('button', { name: 'Cancel', exact: true })
        .click()
      await sellerDialog.waitFor({ state: 'detached' })
      await p.evaluate(() => {
        window.holdPrepare = true
      })
      await p
        .getByRole('region', { name: 'Payment method', exact: true })
        .getByRole('button', { name: 'Change payment method', exact: true })
        .click()
      const cardDialog = p.getByRole('dialog', {
        name: 'Change payment method',
        exact: true,
      })
      await cardDialog
        .getByRole('status')
        .filter({ hasText: 'Preparing secure payment setup' })
        .waitFor()
      assert(
        await cardDialog
          .getByRole('button', { name: 'Save changes', exact: true })
          .isDisabled()
      )
      await p.evaluate(() => window.finishPrepare())
      await cardDialog.getByLabel('Mock secure card frame').waitFor()
      const body = cardDialog.locator('[data-payment-body]')
      const bodyGeometry = await body.evaluate((e) => ({
        padding: getComputedStyle(e).paddingRight,
        gutter: getComputedStyle(e).scrollbarGutter,
        overflow: getComputedStyle(e).overflowY,
      }))
      assert.deepEqual(bodyGeometry, {
        padding: '24px',
        gutter: 'stable',
        overflow: 'auto',
      })
      assert.equal(await cardDialog.locator('[data-payment-body]').count(), 1)
      const field = p
        .frameLocator('iframe[title="Mock secure card field"]')
        .getByRole('button', { name: 'Fixture card field' })
      await field.waitFor()
      const country = cardDialog.getByRole('button', {
        name: 'Country or region',
        exact: true,
      })
      await country.focus()
      await p.keyboard.press('ArrowDown')
      const option = cardDialog.getByRole('button', {
        name: 'Canada',
        exact: true,
      })
      await option.waitFor()
      assert.equal(await cardDialog.locator('[data-sort-option]').count(), 249)
      const countryMenu = cardDialog.getByRole('region', {
        name: 'Country or region options',
        exact: true,
      })
      const menuBounds = await countryMenu.boundingBox()
      assert(menuBounds.x >= 0 && menuBounds.y >= 0)
      assert(menuBounds.x + menuBounds.width <= width)
      assert(menuBounds.y + menuBounds.height <= (width < 640 ? 640 : 900))
      assert(await option.evaluate((e) => e === document.activeElement))
      await p.keyboard.press('Escape')
      await option.waitFor({ state: 'detached' })
      assert(
        await cardDialog.isVisible(),
        'Escape closes Country menu, not payment dialog'
      )
      await country.press('Enter')
      await option.waitFor()
      await option.focus()
      await p.keyboard.press('Enter')
      await option.waitFor({ state: 'detached' })
      for (const name of ['United States', 'China']) {
        await country.click()
        await cardDialog.getByRole('button', { name, exact: true }).click()
        await cardDialog
          .getByRole('region', {
            name: 'Country or region options',
            exact: true,
          })
          .waitFor({ state: 'detached' })
        await country.press('ArrowDown')
        assert.equal(
          await cardDialog
            .getByRole('button', { name, exact: true })
            .getAttribute('aria-pressed'),
          'true'
        )
        assert(
          await cardDialog
            .getByRole('button', { name, exact: true })
            .evaluate((e) => e === document.activeElement)
        )
        await p.keyboard.press('ArrowDown')
        await p.keyboard.press('ArrowUp')
        assert(
          await cardDialog
            .getByRole('button', { name, exact: true })
            .evaluate((e) => e === document.activeElement)
        )
        await p.keyboard.press('Escape')
        await cardDialog
          .getByRole('region', {
            name: 'Country or region options',
            exact: true,
          })
          .waitFor({ state: 'detached' })
      }
      await country.click()
      await countryMenu.waitFor()
      const dialogBounds = await cardDialog.boundingBox()
      // The upward menu can cover the heading on short viewports. Click a
      // genuinely outside, visible dialog edge without forcing pointer events.
      await p.mouse.click(dialogBounds.x + 4, dialogBounds.y + 20)
      await countryMenu.waitFor({ state: 'detached' })
      assert(
        await cardDialog.isVisible(),
        'Outside menu click only closes the menu'
      )
      await cardDialog
        .getByRole('button', { name: 'Cancel', exact: true })
        .focus()
      await p.keyboard.press('Shift+Tab')
      assert(
        await country.evaluate((e) => e === document.activeElement),
        'Country is in keyboard order'
      )
      await p.keyboard.press('Shift+Tab')
      assert.equal(
        await p.evaluate(() => document.activeElement.tagName),
        'IFRAME',
        'keyboard can reach secure frame'
      )
      await field.focus()
      await p.keyboard.press('Tab')
      assert(await country.evaluate((e) => e === document.activeElement))
      await p.keyboard.press('Tab')
      assert(
        await cardDialog
          .getByRole('button', { name: 'Cancel', exact: true })
          .evaluate((n) => n === document.activeElement)
      )
      await p.keyboard.press('Escape')
      await cardDialog.waitFor({ state: 'detached' })
      assert.equal(network, 0)
      assert.deepEqual(errors, [])
      assert(
        (await p.evaluate(() => window.requests)).every((r) =>
          [
            '/api/stripe/card-setup',
            '/api/stripe/reconcile',
            '/api/stripe/payout-setup',
          ].includes(r.url)
        )
      )
      console.log(
        'PASS Stripe setup controller',
        width,
        'preparation retry, Element readiness, server-only promotion, processing recovery, host/appearance/wallets, Cancel/Escape/focus, no network'
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
