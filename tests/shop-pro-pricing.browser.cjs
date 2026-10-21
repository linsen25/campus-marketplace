/* global window, document, getComputedStyle, requestAnimationFrame, performance, DOMMatrixReadOnly */
// Offline UI-only pricing qualification. Real directory/cards, dialog and My Shop.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
// Preserve older browser artifacts; each pricing-only run uses a fresh root.
const root = fs.mkdtempSync(path.resolve('tests/artifacts/pricing-v11-'))
const fixtureModule = { exports: {} }
new Function(
  'require',
  'module',
  'exports',
  fs
    .readFileSync('tests/message-payload.browser.cjs', 'utf8')
    .replace(
      "const root = path.resolve('tests/artifacts/message-payload-qualification')",
      'const root = ' + JSON.stringify(root)
    )
)(require, fixtureModule, fixtureModule.exports)
const { build } = fixtureModule.exports
const aliases = require('./browser-fixture-mocks.cjs')(root)
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import PricingCard from '@/components/pricing-card';import '@/components/animata/button/shining-button.css';import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {LazyMotion,domAnimation} from 'framer-motion';import {MarketFeedViewport} from '@/components/listings/market-feed-viewport';import {ShopDirectory} from '@/components/shops/shop-directory';import {ShopListingWorkspace} from '@/components/shops/shop-listing-workspace';import {Sidebar,SidebarBody} from '@/components/velora/animated-sidebar';import {SectionHeader} from '@/components/home/section-header';import home from '@/components/home/animated-sidebar-demo.module.css';import '@/styles/desktop-app-tokens.css';
const root=createRoot(document.getElementById('root'));window.actions=[];window.requests=[];window.fixtureRequest=async(...args)=>{window.requests.push(args);throw Error('No requests permitted')};window.process={env:{}};
const shops=[{sellerProfileId:'fixture',username:'fixture_shop',shopName:'Vintage Loop',category:'Electronics',description:'Curated campus finds.'}];
function Home({create}){return <div className={home.page}><div className={home.mobileShell}><header className={home.mobileHeader}><h1>My Shop</h1></header><main className={home.mobileMain}><ShopListingWorkspace create={create}/></main></div><Sidebar className={home.frame}><SidebarBody logo={<span/>} title='Home'><span>Listings</span></SidebarBody><main className={home.main} data-home-main><SectionHeader title='My Shop'/><ShopListingWorkspace create={create}/></main></Sidebar></div>};function App({surface}){const [mode,setMode]=useState('resale');return <LazyMotion features={domAnimation}>{surface!=='market'?<Home create={surface==='create'}/>:<main style={{maxWidth:1200,margin:'0 auto',padding:20,minHeight:1400}}>{surface==='market'?<><header data-fixed-controls><button onClick={()=>setMode('resale')}>Resale</button><button onClick={()=>setMode('shop')}>Shop</button></header><MarketFeedViewport mode={mode} resale={<p>Resale listings</p>} shop={<ShopDirectory shops={shops}/>}/></>:<ShopListingWorkspace create={surface==='create'}/>}</main>}</LazyMotion>};let n=0;window.show=surface=>flushSync(()=>root.render(<App key={++n} surface={surface}/>));window.showTrial=(eligibility,preview=false)=>flushSync(()=>root.render(<PricingCard trialEligibility={eligibility} showTrialPreview={preview}/>));
`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#160f1d;color:white;font-family:Arial}</style><script>window.process={env:{}}</script><div id="root"></div><script src="bundle.js"></script>'
)

const pricingSource = fs.readFileSync('components/pricing-card.tsx', 'utf8')
for (const source of [
  'layoutId="tab-bg"',
  'stiffness: 300',
  'damping: 30',
  'mass: 0.8',
  'idx * 0.05',
  '0.3',
  '0.4',
  '[0.32, 0.72, 0, 1]',
])
  assert(pricingSource.includes(source), source)
async function main() {
  await build(aliases)
  fs.unlinkSync(path.join(root, 'entry.tsx'))
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const width of process.env.PRICING_TEST_WIDTH
      ? [Number(process.env.PRICING_TEST_WIDTH)]
      : [390, 430, 820, 1280, 1536])
      for (const reducedMotion of ['reduce', 'no-preference']) {
        const p = await browser.newPage({
          viewport: { width, height: 900 },
          reducedMotion,
        })
        p.setDefaultTimeout(7000)
        const errors = []
        let network = 0
        p.on('pageerror', (e) => errors.push(e.message))
        await p.route('**/*', (r) => {
          const url = new URL(r.request().url())
          if (url.origin === 'http://localhost:4177') {
            if (url.pathname === '/')
              return r.fulfill({
                path: path.join(root, 'index.html'),
                contentType: 'text/html',
              })
            if (url.pathname === '/bundle.js')
              return r.fulfill({
                path: path.join(root, 'bundle.js'),
                contentType: 'application/javascript',
              })
            if (
              url.pathname.startsWith('/static/') ||
              url.pathname.startsWith('/demo/')
            )
              return r.fulfill({ path: 'public' + url.pathname })
          }
          network++
          return r.abort()
        })
        await p.goto('http://localhost:4177/')
        await p.evaluate(() => window.show('market'))
        await p.getByRole('button', { name: 'Shop', exact: true }).click()
        const promo = p.getByRole('complementary', {
          name: 'Shop Pro promotion',
        })
        await promo.waitFor()
        const slider = p.locator('[data-overlapping-slider]')
        await slider.waitFor()
        const opener = promo.getByRole('button', { name: 'Explore Shop Pro' })
        await opener.focus()
        const scroll = await p.evaluate(() => window.scrollY)
        await opener.click()
        const dialog = p.getByRole('dialog', {
          name: 'Shop Pro pricing',
          exact: true,
        })
        await dialog.waitFor()
        await p.waitForTimeout(500)
        const card = dialog.locator('[data-pricing-card]')
        await card.waitFor()
        const header = dialog.locator(':scope > header'),
          logo = header.locator('[data-market-brand-mark] img')
        assert.equal(
          await header.getByText('Shop Plans', { exact: true }).count(),
          1
        )
        assert.equal(
          await logo.getAttribute('src'),
          '/static/icons/uu-logo.svg'
        )
        await logo.evaluate((img) => img.decode())
        const logoBox = await logo.boundingBox(),
          titleBox = await header
            .getByText('Shop Plans', { exact: true })
            .boundingBox()
        assert.equal(logoBox.height, 30)
        assert(logoBox.x + logoBox.width < titleBox.x)
        assert(
          Math.abs(
            logoBox.y + logoBox.height / 2 - titleBox.y - titleBox.height / 2
          ) < 1
        )

        assert.equal(
          await dialog
            .getByRole('heading', { name: 'Choose your plan' })
            .count(),
          1
        )
        assert.equal(
          await dialog
            .getByRole('button', { name: 'Plus', exact: true })
            .getAttribute('aria-pressed'),
          'true'
        )
        assert.equal(await dialog.locator('[data-plan-detail]').count(), 1)
        assert.equal(
          await dialog
            .locator('[data-plan-detail]')
            .getAttribute('data-plan-detail'),
          'plus'
        )
        for (const text of [
          'CA$1.99',
          'Run your shop',
          'Your own storefront',
          'Product & inventory management',
          'Customer reviews',
          'Sales analytics',
          'Billing & sales records',
        ])
          assert((await card.textContent()).includes(text), text)
        for (const text of [
          'Monthly',
          'Yearly',
          'Standard',
          'Advanced',
          'solo',
          'startup',
          'teams',
          '1TB of Space',
          'Users',
          '20% OFF',
        ])
          assert(
            !(await dialog.textContent()).includes(text),
            'removed or not authoritative: ' + text
          )
        const trialCTA = dialog.getByRole('button', {
          name: 'Start 2-Month Free Pro Trial',
          exact: true,
        })
        await trialCTA.scrollIntoViewIfNeeded()
        assert(await trialCTA.isVisible())
        assert.equal(
          await card.getAttribute('data-trial-eligibility'),
          'unavailable'
        )
        for (const text of [
          'No credit card required \u00b7 No automatic charges',
          'OR',
          'New sellers can try Pro for 2 months. After the trial, choose Plus, Pro, or continue without paid Shop features.',
        ])
          assert(
            await dialog.getByText(text, { exact: true }).isVisible(),
            text
          )
        await trialCTA.click()
        assert(
          await dialog.isVisible(),
          'trial CTA is a no-op, no fake success'
        )
        assert.equal(await trialCTA.locator('svg').count(), 1)
        assert.equal(
          await trialCTA.evaluate((el) => getComputedStyle(el).color),
          'rgb(255, 255, 255)'
        )
        assert.equal(await dialog.locator('[data-plan-price]').count(), 1)
        assert(
          await dialog
            .locator('[data-plan-price]')
            .evaluate((el) => !!el.shadowRoot),
          'real NumberFlow custom element'
        )
        const regularCTA = dialog.getByRole('button', {
          name: 'Continue with Plus \u00b7 CA$1.99/mo',
          exact: true,
        })
        await regularCTA.click()
        assert(await dialog.isVisible(), 'CTA remains safe no-op')
        const billing = dialog.getByRole('group', {
          name: 'Billing option',
          exact: true,
        })
        const auto = billing.getByRole('radio', {
          name: 'Auto-renew',
          exact: true,
        })
        const once = billing.getByRole('radio', {
          name: 'One month',
          exact: true,
        })
        assert.equal(await billing.getByRole('radio').count(), 2)
        assert(await auto.isChecked())
        assert(!(await once.isChecked()))
        assert.equal(
          await auto.getAttribute('name'),
          await once.getAttribute('name')
        )
        const flowIdentity = dialog.locator('[data-plan-price]')
        await flowIdentity.evaluate((el) => {
          window.billingPriceNode = el
          window.billingWhiteCard = el.closest('[data-plan-detail]')
        })
        const expectPrice = async (plan, mode, price) => {
          await p.waitForFunction(
            ({ price }) =>
              JSON.parse(
                document.querySelector('[data-plan-price]').getAttribute('data')
              ).valueAsString === price,
            { price: price.toFixed(2) }
          )
          assert(
            await dialog
              .getByRole('button', {
                name: `Continue with ${plan} · CA$${price.toFixed(2)}${
                  mode === 'auto' ? '/mo' : ' one-time'
                }`,
                exact: true,
              })
              .isVisible()
          )
          assert(await (mode === 'auto' ? auto : once).isChecked())
          assert.equal(await billing.locator('input:checked').count(), 1)
          assert(
            await flowIdentity.evaluate(
              (el) =>
                el === window.billingPriceNode &&
                el.closest('[data-plan-detail]') === window.billingWhiteCard
            )
          )
          assert.equal(
            (
              await flowIdentity.locator('../..').locator('small').textContent()
            ).trim(),
            mode === 'auto' ? '/ month' : 'one-time'
          )
        }
        await billing.scrollIntoViewIfNeeded()
        await p.evaluate(() => {
          window.billingSamples = []
          window.billingSamplingDone = false
          const until = performance.now() + 800
          const sample = () => {
            const host = window.billingPriceNode
            const row = document.querySelector(
              'input[value="one-time"]'
            ).parentElement
            const dot = row.querySelector('[aria-hidden="true"] > span')
            window.billingSamples.push({
              spinning: !!host.shadowRoot?.querySelector('.is-spinning'),
              dotOpacity: Number(getComputedStyle(dot).opacity),
              dotTransform: getComputedStyle(dot).transform,
              background: getComputedStyle(row).backgroundColor,
            })
            if (performance.now() < until) requestAnimationFrame(sample)
            else window.billingSamplingDone = true
          }
          requestAnimationFrame(sample)
        })
        await once.locator('..').click({ position: { x: 150, y: 28 } })
        await p.waitForFunction(() => window.billingSamplingDone)
        const billingSamples = await p.evaluate(() => window.billingSamples)
        if (reducedMotion === 'no-preference') {
          assert(
            billingSamples.some((s) => s.spinning),
            'billing change rolls real NumberFlow digits'
          )
          assert(
            billingSamples.some((s) => s.dotOpacity > 0 && s.dotOpacity < 1),
            'radio dot animates'
          )
          assert(
            new Set(billingSamples.map((s) => s.background)).size > 1,
            'billing row highlight transitions'
          )
        } else {
          assert(
            !billingSamples.some((s) => s.spinning),
            'reduced-motion billing change does not roll'
          )
          assert(
            !billingSamples.some((s) => s.dotOpacity > 0 && s.dotOpacity < 1),
            'reduced-motion dot appears directly'
          )
        }
        await dialog
          .getByRole('button', {
            name: 'Continue with Plus · CA$2.99 one-time',
            exact: true,
          })
          .scrollIntoViewIfNeeded()
        await expectPrice('Plus', 'one-time', 2.99)
        await dialog.getByRole('button', { name: 'Pro', exact: true }).click()
        await dialog
          .getByRole('button', {
            name: 'Continue with Pro · CA$5.99 one-time',
            exact: true,
          })
          .scrollIntoViewIfNeeded()
        await expectPrice('Pro', 'one-time', 5.99)
        await auto.click()
        await dialog
          .getByRole('button', {
            name: 'Continue with Pro · CA$4.99/mo',
            exact: true,
          })
          .scrollIntoViewIfNeeded()
        await expectPrice('Pro', 'auto', 4.99)
        await dialog.getByRole('button', { name: 'Plus', exact: true }).click()
        await regularCTA.scrollIntoViewIfNeeded()
        await expectPrice('Plus', 'auto', 1.99)
        await auto.click()
        assert(await auto.isChecked(), 'selected radio cannot toggle off')
        await auto.focus()
        await p.keyboard.press('Tab')
        await p.keyboard.press('Shift+Tab')
        assert.equal(
          await auto
            .locator('..')
            .evaluate((el) => getComputedStyle(el).outlineStyle),
          'solid'
        )
        await p.keyboard.press('ArrowDown')
        assert(await once.isChecked(), 'native radio arrow navigation')
        await p.keyboard.press('ArrowUp')
        assert(await auto.isChecked())
        await billing.scrollIntoViewIfNeeded()
        for (const radio of [auto, once]) {
          const row = radio.locator('..')
          assert(await row.evaluate((el) => el.scrollWidth <= el.clientWidth))
          const circle = await row.locator('[aria-hidden="true"]').boundingBox()
          assert.equal(circle.width, 18)
          assert.equal(circle.height, 18)
        }
        const geometry = await dialog.evaluate((el) => {
          const b = el.getBoundingClientRect(),
            card = el.querySelector('[data-pricing-card]'),
            body = card.parentElement,
            cb = card.getBoundingClientRect()
          return {
            x: b.x,
            y: b.y,
            w: b.width,
            h: b.height,
            bottom: b.bottom,
            cardWidth: cb.width,
            gradient: getComputedStyle(el).backgroundImage,
            borderColor: getComputedStyle(el).borderTopColor,
            topWidth: getComputedStyle(el).borderTopWidth,
            sideColor: getComputedStyle(el).borderLeftColor,
            bottomWidth: getComputedStyle(el).borderBottomWidth,
            bottomColor: getComputedStyle(el).borderBottomColor,
            rimContent: getComputedStyle(el, '::before').content,
            rimPadding: getComputedStyle(el, '::before').padding,
            rimLight: getComputedStyle(el, '::before').backgroundImage,
            rimComposite: getComputedStyle(el, '::before').maskComposite,
            rimPointer: getComputedStyle(el, '::before').pointerEvents,
            rimAnimation: getComputedStyle(el, '::before').animationName,
            planMaterial: getComputedStyle(
              el.querySelector('[data-plan-detail]')
            ).backgroundImage,
            planShadow: getComputedStyle(el.querySelector('[data-plan-detail]'))
              .boxShadow,
            shadow: getComputedStyle(el).boxShadow,
            orb: getComputedStyle(
              el.querySelector('[aria-hidden=true]'),
              '::before'
            ).width,
            orbPointer: getComputedStyle(
              el.querySelector('[aria-hidden=true]'),
              '::before'
            ).pointerEvents,
            orbAnimation: getComputedStyle(
              el.querySelector('[aria-hidden=true]'),
              '::before'
            ).animationName,
            clipping: getComputedStyle(el).overflow,
            scrolling: getComputedStyle(body).overflowY,
            overflow:
              el.scrollWidth > el.clientWidth ||
              card.scrollWidth > card.clientWidth,
            bodyOverflow: body.scrollHeight > body.clientHeight,
            backdrop: getComputedStyle(el, '::backdrop').backgroundColor,
            animation: getComputedStyle(el).animationName,
            bodyLock: getComputedStyle(document.body).overflow,
            rootLock: getComputedStyle(document.documentElement).overflow,
          }
        })
        assert(geometry.x >= 0 && geometry.x + geometry.w <= width + 0.5)
        assert(geometry.y >= 0 && geometry.bottom <= 900.5)
        assert(!geometry.overflow, 'dialog/card no horizontal overflow')
        assert(geometry.cardWidth <= 504.5 && geometry.cardWidth >= 290)
        assert(
          geometry.gradient.includes('rgb(7, 81, 59)') &&
            geometry.gradient.includes('rgb(9, 11, 11)')
        )
        if (width >= 640) assert.equal(geometry.w, 552)
        assert.equal(geometry.backdrop, 'rgba(0, 0, 0, 0.6)')
        assert.equal(
          (geometry.gradient.match(/radial-gradient/g) || []).length,
          3
        )
        assert.equal(geometry.borderColor, 'rgba(20, 70, 54, 0.08)')
        for (const color of ['15, 145, 90', 'rgba(0, 0, 0, 0.54)'])
          assert(geometry.shadow.includes(color), color)
        assert.equal(geometry.orb, width < 640 ? '280px' : '360px')
        assert.equal(geometry.topWidth, '1px')
        assert.equal(geometry.sideColor, 'rgba(20, 70, 54, 0.08)')
        assert.notEqual(geometry.rimContent, 'none', 'one dedicated pseudo rim')
        assert.equal(geometry.rimPadding, '1px')
        assert(
          geometry.rimComposite.includes('exclude'),
          'rounded ring mask supported'
        )
        assert(geometry.rimLight.includes('105, 240, 168'))
        assert(geometry.rimLight.includes('0.55'))
        assert.equal(geometry.rimPointer, 'none')
        assert.equal(geometry.rimAnimation, 'none')
        assert(geometry.gradient.includes('72% 17%'))
        assert(geometry.gradient.includes('95% 46%'))
        assert(!geometry.shadow.includes('inset'), 'no duplicate inner edge')
        if (width >= 640) {
          assert.equal(geometry.bottomWidth, '1px')
          assert.equal(geometry.bottomColor, 'rgba(5, 10, 9, 0.95)')
        } else assert.equal(geometry.bottomWidth, '0px')
        assert(geometry.planMaterial.includes('rgb(247, 249, 248) 100%'))
        assert(geometry.planShadow.includes('rgba(0, 0, 0, 0.075)'))
        assert.equal(geometry.orbPointer, 'none')
        assert.equal(geometry.orbAnimation, 'none')
        assert.equal(geometry.clipping, 'hidden')
        assert.equal(geometry.scrolling, 'auto')
        assert(
          geometry.bodyLock === 'hidden' || geometry.rootLock === 'hidden',
          'scroll locked'
        )
        if (width < 640)
          assert(Math.abs(geometry.bottom - 900) < 1, 'mobile bottom attached')
        else
          assert(
            Math.abs(geometry.y - (900 - geometry.h) / 2) < 2,
            'desktop centered'
          )
        assert.equal(geometry.animation === 'none', reducedMotion === 'reduce')
        assert(
          await dialog.evaluate(
            (el) =>
              document.activeElement === el ||
              el.contains(document.activeElement)
          )
        )
        // Native top-layer inertness prevents interaction with the slider below.
        assert(await dialog.evaluate((el) => el.matches(':modal')))
        await p.mouse.move(2, 300)
        await p.mouse.wheel(0, 300)
        await p.waitForTimeout(80)
        assert.equal(await p.evaluate(() => window.scrollY), scroll)
        const beforeCard = await dialog
          .locator('[data-plan-detail]')
          .boundingBox()
        const flow = dialog.locator('[data-plan-price]')
        await flow.evaluate((el) => {
          window.priceNode = el
          window.whiteCard = el.closest('[data-plan-detail]')
        })
        const priceBox = await flow.locator('..').boundingBox()
        for (const [key, value, count] of [
          ['pro', 4.99, 3],
          ['plus', 1.99, 5],
        ]) {
          // Sample actual rendered digit transforms, shared-layout pill motion and feature stagger.
          await p.evaluate((key) => {
            window.motionSamples = []
            window.samplingFinished = false
            const until = performance.now() + 1400
            const sample = () => {
              const host = window.priceNode
              const features = document.querySelector(
                `[data-plan-features="${key}"]`
              )
              const items = features
                ? Array.from(features.querySelectorAll('li'))
                : []
              const pill = document.querySelector(
                '[aria-label="Shop plan"] button[aria-pressed="true"] > span'
              )
              const digit = host.shadowRoot?.querySelector(
                '[part~="integer-digit"] .digit__num:not([inert])'
              )
              const spinning = host.shadowRoot?.querySelector('.is-spinning')
              window.motionSamples.push({
                digit: digit ? getComputedStyle(digit).transform : null,
                spinning: !!spinning,
                x: pill?.getBoundingClientRect().x,
                features: items.map((el) => ({
                  opacity: Number(getComputedStyle(el).opacity),
                  y: new DOMMatrixReadOnly(getComputedStyle(el).transform).m42,
                })),
                priceOpacity: getComputedStyle(host).opacity,
              })
              if (performance.now() < until) requestAnimationFrame(sample)
              else window.samplingFinished = true
            }
            requestAnimationFrame(sample)
          }, key)
          await dialog
            .getByRole('button', {
              name: key === 'pro' ? 'Pro' : 'Plus',
              exact: true,
            })
            .click()
          await p.waitForFunction(() => window.samplingFinished)
          const samples = await p.evaluate(() => window.motionSamples)
          assert(
            await flow.evaluate((el) => el === window.priceNode),
            'NumberFlow instance stays mounted'
          )
          assert(
            await flow.evaluate(
              (el) => el.closest('[data-plan-detail]') === window.whiteCard
            ),
            'one persistent white card'
          )
          assert.equal(await dialog.locator('[data-plan-detail]').count(), 1)
          assert.equal(await card.locator('li').count(), count)
          assert.equal(
            await flow.evaluate(
              (el) => JSON.parse(el.getAttribute('data')).valueAsString
            ),
            value.toFixed(2)
          )
          assert(
            samples.every((s) => s.priceOpacity === '1'),
            'price is not faded'
          )
          if (reducedMotion === 'no-preference') {
            assert(
              samples.some((s) => s.spinning),
              'NumberFlow digit is spinning'
            )
            assert(
              new Set(samples.filter((s) => s.spinning).map((s) => s.digit))
                .size > 2,
              'visible rolling digit transform changes'
            )
            assert(
              new Set(samples.map((s) => Math.round(s.x))).size > 2,
              'original shared-layout pill moves'
            )
            assert(
              samples.some(
                (s) =>
                  s.features.length === count &&
                  s.features[0].opacity > s.features[count - 1].opacity + 0.02
              ),
              'feature opacity is staggered'
            )
            assert(
              samples.some((s) => s.features.some((f) => f.y > 0.1)),
              'feature translates from y=5'
            )
          } else {
            assert(
              !samples.some((s) => s.spinning),
              'no reduced-motion digit roll'
            )
            assert(
              !samples.some((s) => s.features.some((f) => f.y > 0.1)),
              'reduced motion removes feature translate'
            )
          }
          const currentPriceBox = await flow.locator('..').boundingBox()
          assert(
            Math.abs(priceBox.width - currentPriceBox.width) < 1,
            'price width stable'
          )
          assert(
            Math.abs(priceBox.x - currentPriceBox.x) < 1,
            'price position stable'
          )
          const name = key === 'pro' ? 'Pro' : 'Plus'
          await dialog
            .getByRole('button', {
              name: `Continue with ${name} \u00b7 CA$${value.toFixed(2)}/mo`,
              exact: true,
            })
            .click()
          assert(await dialog.isVisible(), 'Continue remains no-op')
        }
        for (const text of [
          'Run your shop',
          'Your own storefront',
          'Product & inventory management',
          'Customer reviews',
          'Sales analytics',
          'Billing & sales records',
        ])
          assert((await card.textContent()).includes(text), text)
        const afterCard = await dialog
          .locator('[data-plan-detail]')
          .boundingBox()
        assert(
          Math.abs(beforeCard.height - afterCard.height) < 1,
          'stable outer white card height'
        )
        // Focus remains trapped after repeated Tab presses.
        for (let i = 0; i < 12; i++) {
          await p.keyboard.press('Tab')
          assert(
            await dialog.evaluate(
              (el) =>
                el === document.activeElement ||
                el.contains(document.activeElement) ||
                document.activeElement === document.body
            )
          )
        }
        const ctaVisual = await regularCTA.evaluate((el) => ({
          background: getComputedStyle(el).backgroundColor,
          color: getComputedStyle(el).color,
          classes: el.className,
        }))
        assert(
          ['rgb(255, 255, 255)', 'rgb(234, 240, 236)'].includes(
            ctaVisual.background
          ),
          JSON.stringify(ctaVisual)
        )
        await p.screenshot({
          path: path.join(root, `new-pricing-${width}-${reducedMotion}.png`),
        })
        // Closing discards both local selections, even after a different last choice.
        await once.click()
        await dialog.getByRole('button', { name: 'Pro', exact: true }).click()
        await p.keyboard.press('Escape')
        if (reducedMotion === 'no-preference') {
          assert.equal(await dialog.getAttribute('data-exiting'), 'true')
          assert.equal(
            await dialog.evaluate((el) => el.open),
            true,
            'native lock stays through exit'
          )
        }
        await dialog.waitFor({ state: 'detached' })
        assert(
          await opener.evaluate((el) => el === document.activeElement),
          'focus restored'
        )
        assert.equal(await p.evaluate(() => window.scrollY), scroll)
        assert.equal(
          await p.evaluate(() => document.documentElement.style.overflow),
          ''
        )
        await opener.click()
        await dialog.waitFor()
        await p.waitForTimeout(250)
        assert(
          await dialog
            .getByRole('radio', { name: 'Auto-renew', exact: true })
            .isChecked()
        )
        assert.equal(
          await dialog
            .getByRole('button', { name: 'Plus', exact: true })
            .getAttribute('aria-pressed'),
          'true'
        )
        await dialog
          .getByRole('button', { name: 'Close Shop Pro pricing' })
          .click()
        await dialog.waitFor({ state: 'detached' })
        assert(await opener.evaluate((el) => el === document.activeElement))
        // Short-screen dialog scroll owner; close never scrolls out of reach.
        await p.setViewportSize({ width, height: 540 })
        await opener.click()
        await dialog.waitFor()
        await p.waitForTimeout(300)
        const body = dialog.locator('[data-pricing-card]').locator('..')
        assert(
          await body.evaluate((el) => el.scrollHeight > el.clientHeight),
          'short-screen internal scroll'
        )
        await body.evaluate((el) => {
          el.scrollTop = el.scrollHeight
        })
        assert(await body.evaluate((el) => el.scrollTop > 0))
        await dialog
          .getByRole('button', {
            name: 'Continue with Plus · CA$1.99/mo',
            exact: true,
          })
          .scrollIntoViewIfNeeded()
        assert(
          await dialog
            .getByRole('button', {
              name: 'Continue with Plus · CA$1.99/mo',
              exact: true,
            })
            .isVisible()
        )
        await dialog
          .getByRole('button', {
            name: 'Start 2-Month Free Pro Trial',
            exact: true,
          })
          .scrollIntoViewIfNeeded()
        assert(
          await dialog
            .getByRole('button', {
              name: 'Start 2-Month Free Pro Trial',
              exact: true,
            })
            .isVisible()
        )
        assert(
          await dialog.evaluate(
            (el) =>
              el.getBoundingClientRect().bottom <= 540.5 &&
              el.getBoundingClientRect().top >= 0 &&
              el.scrollWidth <= el.clientWidth
          )
        )
        assert(
          await dialog
            .getByRole('button', { name: 'Close Shop Pro pricing' })
            .isVisible()
        )
        await dialog
          .getByRole('button', { name: 'Close Shop Pro pricing' })
          .click()
        await dialog.waitFor({ state: 'detached' })
        await p.setViewportSize({ width, height: 900 })
        await promo
          .getByRole('button', { name: 'Dismiss Shop Pro promotion' })
          .click()
        await promo.waitFor({ state: 'detached' })
        await slider.waitFor()
        // Actual shared Home workspace in existing responsive Home shell.
        await p.evaluate(() => window.show('home'))
        const workspace = p
          .locator('[data-shop-listing-workspace="empty"]')
          .first()
        await workspace.waitFor({ state: 'attached' })
        assert.equal((await workspace.textContent()).trim(), '')
        assert.equal(
          await p
            .locator('[data-pricing-card], [data-shop-pro-pricing]')
            .count(),
          0
        )
        assert.equal(await p.getByRole('dialog').count(), 0)
        assert.equal(
          await p
            .getByText(
              /Subscribe to unlock|Choose a plan|Shop Pro required|Coming soon/
            )
            .count(),
          0
        )
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        )
        // Visual preview is independent of eligibility. Neither branch grants anything.
        for (const eligibility of ['unavailable', 'ineligible', 'eligible']) {
          for (const preview of [false, true]) {
            await p.evaluate(
              ({ eligibility, preview }) =>
                window.showTrial(eligibility, preview),
              { eligibility, preview }
            )
            const expected = preview || eligibility === 'eligible'
            assert.equal(
              await p
                .getByRole('button', {
                  name: 'Start 2-Month Free Pro Trial',
                  exact: true,
                })
                .count(),
              expected ? 1 : 0
            )
            assert.equal(
              await p.getByText('OR', { exact: true }).count(),
              expected ? 1 : 0
            )
            assert.equal(
              await p
                .locator('[data-pricing-card]')
                .getAttribute('data-trial-eligibility'),
              eligibility
            )
          }
        }
        assert.deepEqual(errors, [])
        assert.equal(network, 0)
        assert.deepEqual(await p.evaluate(() => window.requests), [])
        console.log(
          'PASS new Pricing Card',
          width,
          reducedMotion,
          'four billing prices, native radios/keyboard, persistent NumberFlow roll, original tab/stagger/content, full 2-month trial preview, modal/scroll/focus, zero requests'
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
