/* global window, document, getComputedStyle */
// Offline active/free Shop UI only. All identity saves and metrics are isolated
// in memory. No Shop entitlement, account data or analytics are written remotely.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
const empty = path.join(root, 'shop-surfaces-mocks.jsx')
fs.writeFileSync(
  empty,
  `import React from 'react';export function NotificationSettings(){return <section aria-label="Notification preferences"><h3>Notifications</h3></section>};export function Link({href,children,...props}){return <a {...props} href={href}>{children}</a>}`
)
aliases['@/components/notifications/notification-settings'] = empty
aliases['@ui/link/link'] = empty
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import '@/components/animata/button/shining-button.css';import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {LazyMotion,domAnimation} from 'framer-motion';import {ProfileOverview} from '@/components/home/profile-overview';import {ShopAnalysis} from '@/components/shops/shop-analytics';
window.process={env:{}};window.actions=[];window.requests=[];window.saves=[];window.username='demo_seller_a';window.failSave=false;window.pending=[];window.defer=false;
window.fixtureRequest=async(url,method,body)=>{window.requests.push({url,method});if(url==='/api/profile/account')return {username:window.username,email:'fixture@uwo.ca',emailVerified:true,createdAt:'2026-10-01',nextUsernameChangeAt:null};if(url.startsWith('/api/auth/username-availability'))return {available:true};if(url==='/api/profile/username'){window.username=body.username;return {username:body.username,next_change_allowed_at:null}};throw Error('Unexpected request '+url)};
const seed={sellerProfileId:'shop-ui-fixture-only',username:'demo_seller_a',shopName:'Vintage Loop',category:'Clothing & Accessories',description:'Curated vintage clothing, sneakers and accessories around campus.'};
const data=period=>({sellerProfileId:seed.sellerProfileId,period,views:Array.from({length:period==='1D'?24:parseInt(period)},(_,i)=>({timestamp:new Date(Date.UTC(2026,9,1,i)).toISOString(),label:String(i),views:(i*7)%13+2})),topListings:['Vintage Nike Hoodie',"Levi’s 501 Jeans",'New Balance 550','Varsity Jacket'].map((title,i)=>({listingId:'fixture-'+i,title,views:[84,63,47,25][i]}))});
const loadFixture=period=>{if(window.defer)return new Promise((resolve,reject)=>window.pending.push({period,resolve,reject}));return Promise.resolve(data(period))};window.respond=(i,failed=false)=>failed?window.pending[i].reject(Error('Controlled fixture error')):window.pending[i].resolve(data(window.pending[i].period));
function App({surface,active}){const [shop,setShop]=useState(seed);return <LazyMotion features={domAnimation}><div style={{maxWidth:1100,margin:'0 auto',padding:20}}>{surface==='analysis'?<ShopAnalysis shop={active?shop:undefined} loadFixture={active?loadFixture:undefined}/>:<ProfileOverview settings={surface==='settings'} shopPreview={active?shop:undefined} onShopSave={active?async patch=>{if(window.failSave){window.failSave=false;throw Error('Controlled fixture save error')}window.saves.push(patch);setShop(s=>({...s,...patch}))}:undefined} onAvatarSave={()=>{}} sessionAction={<button>Fixture Log out</button>}/>}</div></LazyMotion>};const root=createRoot(document.getElementById('root'));let n=0;window.show=(surface,active)=>root.render(<App key={++n} surface={surface} active={active}/>);document.body.style.background='#160f1d';window.show('profile',false);
`
)
async function main() {
  await build(aliases)
  for (const file of ['entry.tsx', 'api.ts'])
    fs.unlinkSync(path.join(root, file))
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const reduced of [false, true])
      for (const width of (process.env.SHOP_WIDTHS || '390,430,820,1280,1536')
        .split(',')
        .map(Number)) {
        const p = await browser.newPage({
          viewport: { width, height: 900 },
          reducedMotion: reduced ? 'reduce' : 'no-preference',
        })
        const errors = []
        p.on('pageerror', (e) => errors.push(e.message))
        let network = 0
        await p.route(/^https?:/, (r) => {
          network++
          return r.abort()
        })
        await p.goto(
          'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
        )
        const show = async (surface, active) => {
          await p.evaluate(([s, a]) => window.show(s, a), [surface, active])
          await p.locator(`[data-shop-surface="${surface}"]`).waitFor()
        }
        const fit = async () =>
          assert(
            await p.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth
            ),
            'No horizontal overflow'
          )
        const shop = () => p.locator('[data-shop-surface]')
        await shop()
          .getByText("Your Shop isn't active yet.", { exact: true })
          .waitFor()
        assert.equal(await shop().locator('[data-chart]').count(), 0)
        assert.equal(await shop().getByRole('link').count(), 0)
        await show('profile', true)
        const view = shop().getByRole('link', {
          name: 'View Shop',
          exact: true,
        })
        await view.waitFor()
        assert.equal(
          await view.evaluate((n) => n.getBoundingClientRect().height),
          44
        )
        assert.equal(await view.getAttribute('href'), '/shop/demo_seller_a')
        assert.equal(
          await shop().getByText('Vintage Loop', { exact: true }).count(),
          1
        )
        assert.equal(await shop().locator('[data-chart]').count(), 0)
        assert.equal(
          await shop().evaluate((n) =>
            Boolean(n.closest('[data-profile-account]'))
          ),
          false
        )
        await fit()
        if (!reduced && [390, 1280].includes(width))
          await p.screenshot({
            path: path.join(root, `shop-profile-${width}.png`),
            fullPage: true,
          })
        await show('settings', false)
        await shop().getByText('Available with Shop Pro').waitFor()
        assert.equal(await shop().getByRole('button').count(), 0)
        assert.equal(
          await p
            .getByRole('region', { name: 'Account & Security', exact: true })
            .locator('[data-shop-surface]')
            .count(),
          0
        )
        const order = await p
          .locator('[data-profile-account]')
          .evaluate((n) =>
            Array.from(
              n.querySelectorAll('h3,.profile_module_css_sessionRow')
            ).map((x) => x.textContent.trim())
          )
        assert(order.indexOf('Shop') > order.indexOf('Payments & payouts'))
        assert(order.indexOf('Shop') < order.indexOf('Notifications'))
        assert(order.at(-1).startsWith('Session'))
        await show('settings', true)
        await shop()
          .getByRole('button', { name: 'Change shop name', exact: true })
          .waitFor()
        await shop().getByText('Based on your username').waitFor()
        assert.equal(await shop().getByRole('button').count(), 3)
        const normal = p.getByRole('button', {
          name: 'Change username',
          exact: true,
        })
        assert.equal(
          await normal.evaluate((n) =>
            getComputedStyle(n).getPropertyValue('--surface').trim()
          ),
          '#775497'
        )
        assert.equal(
          await shop()
            .getByRole('button')
            .first()
            .evaluate((n) =>
              getComputedStyle(n).getPropertyValue('--surface').trim()
            ),
          '#166534'
        )
        for (const [field, newValue] of [
          ['shop name', 'Vintage Loop Updated'],
          ['description', 'Updated description for the isolated UI fixture.'],
        ]) {
          const opener = shop().getByRole('button', {
            name: `Change ${field}`,
            exact: true,
          })
          await opener.click()
          const d = p.getByRole('dialog')
          await d.waitFor()
          assert.equal(
            await p.evaluate(() => document.body.style.overflow),
            'hidden'
          )
          const input =
            field === 'description'
              ? d.getByRole('textbox', { name: 'Description', exact: true })
              : d.getByRole('textbox', { name: 'Shop name', exact: true })
          await input.fill(newValue)
          if (field === 'shop name') {
            await p.evaluate(() => (window.failSave = true))
            await d
              .getByRole('button', { name: 'Save changes', exact: true })
              .click()
            await d.getByRole('alert').waitFor()
            assert.equal(
              await shop().getByText('Vintage Loop', { exact: true }).count(),
              1
            )
          }
          await d
            .getByRole('button', { name: 'Save changes', exact: true })
            .click()
          await d.waitFor({ state: 'detached' })
          await shop().getByText(newValue, { exact: true }).waitFor()
          assert(
            await shop()
              .getByText('/shop/demo_seller_a', { exact: false })
              .count()
          )
          assert.equal(await p.evaluate(() => document.body.style.overflow), '')
        }
        await shop()
          .getByRole('button', { name: 'Change category', exact: true })
          .click()
        let d = p.getByRole('dialog')
        await d.waitFor()
        await d.getByRole('button', { name: 'Category', exact: true }).click()
        await p
          .getByRole('button', { name: 'Electronics', exact: true })
          .click()
        await d
          .getByRole('button', { name: 'Save changes', exact: true })
          .click()
        await d.waitFor({ state: 'detached' })
        await shop().getByText('Electronics', { exact: true }).waitFor()
        await normal.click()
        d = p.getByRole('dialog')
        await d.waitFor()
        await d
          .getByRole('textbox', { name: 'Username', exact: true })
          .fill('demo_seller_updated')
        await d.getByText('Username available (case-insensitive)').waitFor()
        await d.getByRole('button', { name: 'Save', exact: true }).click()
        await d.waitFor({ state: 'detached' })
        await shop()
          .getByText('/shop/demo_seller_updated', { exact: false })
          .waitFor()
        await shop()
          .getByText('Vintage Loop Updated', { exact: true })
          .waitFor()
        await fit()
        await shop()
          .getByRole('button', { name: 'Change description', exact: true })
          .click()
        d = p.getByRole('dialog')
        await d.waitFor()
        await p.keyboard.press('Escape')
        await d.waitFor({ state: 'detached' })
        assert.equal(await p.evaluate(() => document.body.style.overflow), '')
        if (!reduced && [390, 1280].includes(width))
          await p.screenshot({
            path: path.join(root, `shop-settings-${width}.png`),
            fullPage: true,
          })
        await show('analysis', false)
        await shop()
          .getByText(
            'Shop analytics become available when your Shop is active.'
          )
          .waitFor()
        assert.equal(await shop().locator('[data-chart]').count(), 0)
        await p.evaluate(() => {
          window.defer = true
          window.pending = []
        })
        await show('analysis', true)
        await shop().getByLabel('Loading Shop analytics').waitFor()
        await p.waitForFunction(() => window.pending.length === 1)
        await p.evaluate(() => window.respond(0))
        await shop()
          .locator('.recharts-area-curve')
          .waitFor({ state: 'attached' })
        await shop()
          .getByText(/Vintage Nike\s*Hoodie/)
          .waitFor()
        assert.equal(
          await shop().getByText('UI fixture · Illustrative data only').count(),
          1
        )
        for (const label of ['1D', '30D']) {
          await shop().getByRole('button', { name: label, exact: true }).click()
        }
        await p.waitForFunction(() => window.pending.length === 3)
        assert.equal(
          await shop().getByLabel('Loading Shop analytics').count(),
          0
        )
        await p.evaluate(() => window.respond(2))
        await p.waitForFunction(
          () =>
            document
              .querySelector('[data-shop-analytics-period]')
              .getAttribute('data-shop-analytics-period') === '30D'
        )
        await p.evaluate(() => window.respond(1))
        assert.equal(
          await shop()
            .locator('[data-shop-analytics-period]')
            .getAttribute('data-shop-analytics-period'),
          '30D'
        )
        await shop().getByRole('button', { name: '7D', exact: true }).click()
        await p.waitForFunction(() => window.pending.length === 4)
        await p.evaluate(() => window.respond(3, true))
        await shop().getByRole('alert').waitFor()
        await shop().getByRole('button', { name: 'Retry', exact: true }).click()
        await p.waitForFunction(() => window.pending.length === 5)
        await p.evaluate(() => window.respond(4))
        await shop().getByRole('alert').waitFor({ state: 'detached' })
        if (reduced)
          assert.equal(
            await shop()
              .getByRole('region', { name: 'Shop Views', exact: true })
              .getAttribute('data-chart-animation'),
            'idle'
          )
        await fit()
        assert.equal(
          await p.evaluate(
            () =>
              window.requests.filter(
                (r) => r.method !== 'GET' && r.url !== '/api/profile/username'
              ).length
          ),
          0
        )
        assert.equal(network, 0)
        assert.deepEqual(errors, [])
        if (!reduced && [390, 1280].includes(width))
          await p.screenshot({
            path: path.join(root, `shop-analysis-${width}.png`),
            fullPage: true,
          })
        console.log(
          `PASS Shop surfaces ${width} reduced=${reduced}: free/active profile, no profile charts, independent Analysis/fixtures/periods/retry, Settings editors/read-only URL/username, green scoped actions, scroll lock, no remote writes/overflow`
        )
        await p.close()
      }
  } finally {
    await browser.close()
    for (const f of ['shop-surfaces-mocks.jsx', 'bundle.js', 'index.html'])
      fs.rmSync(path.join(root, f), { force: true })
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
