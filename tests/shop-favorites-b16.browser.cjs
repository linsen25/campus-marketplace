/* global window, document */
// Production components/cache/transport; all HTTP is intercepted local test data.
const fs = require('fs'),
  path = require('path'),
  assert = require('assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
delete aliases['@/lib/listings-api']
let mockIndex = 0
function mock(name, source) {
  const file = path.join(root, 'b16-mock-' + mockIndex++ + '.tsx')
  fs.writeFileSync(file, source)
  aliases[name] = file
}
mock('next/head', 'export default function Head(){return null}')
mock(
  'next/image',
  `import React from 'react';export default function Image({src,alt}){return <img src={src} alt={alt}/>}`
)
mock(
  'next/router',
  `export function useRouter(){return {query:{},push:async()=>{window.show('detail');return true}}}`
)
mock(
  '@/components/auth/auth-modal',
  `export function useAuthModal(){return {openAuth(){window.authOpened++}}}`
)
mock(
  '@/components/listings/marketplace-session',
  `import React,{createContext,useContext,useState}from'react';const C=createContext({seller:null});export function Session({children}){const[actor,setActor]=useState(window.actor);window.setActor=setActor;return <C.Provider value={{seller:actor?{id:actor,displayName:'Local account'}:null,loading:false}}>{children}</C.Provider>}export function useMarketplaceSession(){return useContext(C)}`
)
// PublishedListingCard imports the same provider with a relative path.
aliases['./marketplace-session'] =
  aliases['@/components/listings/marketplace-session']
mock(
  '@/lib/messages-api',
  `export async function findConversation(){throw Error('Shop transactions stay closed')}`
)
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import '@/components/animata/button/shining-button.css';import React,{useState}from'react';import{createRoot}from'react-dom/client';import{Provider}from'jotai';import{LazyMotion,domAnimation}from'framer-motion';import{Session}from'@/components/listings/marketplace-session';import{ShopCard}from'@/components/shops/shop-card';import{ShopPage}from'@/components/shops/shop-page';import{ShopFavorites}from'@/components/shops/shop-favorites';import{Favorites}from'@/components/listings/favorites';
window.process={env:{}};window.authOpened=0;function App(){const[view,show]=useState('card');window.show=show;return <Provider><Session><LazyMotion features={domAnimation}><div style={{padding:16}}><nav aria-label="Fixture views">{['card','detail','favorites','resale'].map(v=><button key={v} onClick={()=>show(v)}>{v}</button>)}</nav>{view==='card'?<div style={{maxWidth:340}}><ShopCard shop={window.shop}/></div>:view==='detail'?<ShopPage shop={window.shop} listings={[]}/>:view==='resale'?<Favorites channel="resale"/>:<ShopFavorites/>}</div></LazyMotion></Session></Provider>}createRoot(document.getElementById('root')).render(<App/>);`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#21182b;color:white;font-family:Arial}nav[aria-label="Fixture views"]{display:flex;gap:16px;margin-bottom:16px}.ml-auto{margin-left:auto}.shrink-0{flex-shrink:0}</style><script>window.process={env:{}}</script><div id="root"></div><script src="bundle.js"></script>'
)
const id = '11111111-1111-4111-8111-111111111111',
  actorA = '33333333-3333-4333-8333-333333333333',
  actorB = '44444444-4444-4444-8444-444444444444'
const shop = {
  id,
  sellerProfileId: '22222222-2222-4222-8222-222222222222',
  username: 'local_shop',
  shopName: 'Local Shop',
  category: 'Electronics',
  description: 'Eligible local fixture',
  badgeTier: 'plus',
  imageUrl: '/static/testPic/camera.webp',
}
const listing = {
  id: '55555555-5555-4555-8555-555555555555',
  listingChannel: 'shop',
  title: 'Camera',
  description: 'Product fixture',
  price: 4500,
  currency: 'CAD',
  category: 'Electronics',
  subcategory: 'Cameras',
  condition: 'good',
  preferredPaymentMode: 'external',
  preferredFulfillment: 'ON_CAMPUS',
  meetingLocation: { label: 'Campus' },
  estimatedDeliveryFeeCents: 0,
  status: 'available',
  seller: { id: shop.sellerProfileId, displayName: 'local_shop' },
  photoUrls: ['/static/testPic/camera.webp'],
  createdAt: '2026-10-19',
  updatedAt: '2026-10-19',
  publishedAt: '2026-10-19',
}
const pagination = { page: 1, hasNextPage: false, refreshAfterMs: 30000 }
async function main() {
  await build(aliases)
  for (const f of ['entry.tsx', 'api.ts']) fs.unlinkSync(path.join(root, f))
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const reduced of [false, true])
      for (const width of [390, 430, 820, 1280, 1536]) {
        const p = await browser.newPage({
          viewport: { width, height: 900 },
          reducedMotion: reduced ? 'reduce' : 'no-preference',
        })
        const saved = new Map([
            [actorA, new Set()],
            [actorB, new Set()],
          ]),
          errors = [],
          listingCalls = []
        let actor = actorA,
          eligible = true,
          writeMode = 'normal',
          release,
          writeCount = 0,
          listingSaved = true
        p.on('pageerror', (e) => errors.push(e.message))
        await p.addInitScript(
          ({ shop, actorA }) => {
            window.shop = shop
            window.actor = actorA
          },
          { shop, actorA }
        )
        await p.route('**/*', async (route) => {
          const u = new URL(route.request().url()),
            method = route.request().method()
          assert.equal(
            u.origin,
            'http://localhost:4177',
            'External network forbidden'
          )
          if (u.pathname === '/bundle.js')
            return route.fulfill({
              path: path.join(root, 'bundle.js'),
              contentType: 'application/javascript',
            })
          if (u.pathname.startsWith('/static/'))
            return route.fulfill({ path: 'public' + u.pathname })
          if (u.pathname.startsWith('/api/shop-favorites')) {
            assert(actor, 'No anonymous favorite API')
            const current = saved.get(actor)
            if (method !== 'GET') {
              writeCount++
              if (writeMode === 'delay')
                await new Promise((resolve) => {
                  release = resolve
                })
              if (writeMode === 'fail')
                return route.fulfill({
                  status: 503,
                  json: { error: 'Controlled failure' },
                })
              if (method === 'POST') current.add(id)
              else current.delete(id)
              if (writeMode === 'lost') return route.abort('failed')
              return route.fulfill({
                json: { shopId: id, favorited: current.has(id) },
              })
            }
            return route.fulfill({
              json: u.searchParams.has('ids')
                ? { favoriteShopIds: [...current] }
                : {
                    shops: eligible && current.has(id) ? [shop] : [],
                    ...pagination,
                  },
            })
          }
          if (u.pathname.startsWith('/api/public-shops'))
            return route.fulfill({
              json: eligible
                ? { state: 'available', shop, listings: [], ...pagination }
                : { state: 'unavailable' },
            })
          if (u.pathname.startsWith('/api/favorites')) {
            listingCalls.push(method + u.pathname + u.search)
            if (u.pathname === '/api/favorites')
              return route.fulfill({
                json: listingSaved
                  ? [
                      {
                        ...listing,
                        listingChannel:
                          u.searchParams.get('channel') || 'resale',
                      },
                    ]
                  : [],
              })
            if (method !== 'GET') listingSaved = method !== 'DELETE'
            return route.fulfill({ json: { favorited: listingSaved } })
          }
          assert(
            !u.pathname.startsWith('/api/'),
            'Unexpected API ' + u.pathname
          )
          return route.fulfill({
            path: path.join(root, 'index.html'),
            contentType: 'text/html',
          })
        })
        const view = async (name) =>
          p
            .getByRole('navigation', { name: 'Fixture views' })
            .getByRole('button', { name, exact: true })
            .click()
        const heart = () =>
          p.getByRole('button', {
            name: /^(Unfavorite|Favorite) shop: Local Shop$/,
          })
        const capture = async (surface) => {
          assert(
            await p.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth
            ),
            `${surface} has no overflow`
          )
          await p.screenshot({
            path: path.join(
              root,
              `b16-${surface}-${width}-${reduced ? 'reduced' : 'normal'}.png`
            ),
          })
        }
        const pressed = async (value) =>
          p.waitForFunction((value) => {
            const b = Array.from(document.querySelectorAll('button')).find(
              (x) =>
                /^(Unfavorite|Favorite) shop: Local Shop$/.test(
                  x.textContent.trim()
                )
            )
            return (
              b &&
              !b.disabled &&
              !b.hasAttribute('data-running') &&
              b.getAttribute('data-liked') === String(value) &&
              b.getAttribute('aria-pressed') === String(value)
            )
          }, value)
        await p.goto('http://localhost:4177/')
        await pressed(false).catch(async (e) => {
          console.error({
            errors,
            body: await p.locator('body').innerText(),
            buttons: await p
              .locator('button')
              .evaluateAll((xs) => xs.map((x) => x.outerHTML)),
          })
          throw e
        })
        writeMode = 'delay'
        await heart().click()
        await p.waitForFunction(() =>
          Array.from(document.querySelectorAll('button')).some(
            (x) => /shop: Local Shop$/.test(x.textContent.trim()) && x.disabled
          )
        )
        assert.equal(
          await heart().getAttribute('aria-pressed'),
          'false',
          'Pending never claims success'
        )
        assert.equal(
          await heart().getAttribute('data-liked'),
          'false',
          'Pending visual remains unliked'
        )
        assert.equal(writeCount, 1)
        release()
        writeMode = 'normal'
        await pressed(true)
        await p.reload()
        await pressed(true)
        await view('detail')
        await pressed(true)
        await capture('detail')
        await heart().click()
        await pressed(false)
        writeMode = 'fail'
        await heart().click()
        await p.getByRole('alert').waitFor()
        await pressed(false)
        assert.equal(saved.get(actorA).size, 0)
        writeMode = 'normal'
        await p.getByRole('button', { name: 'Retry', exact: true }).click()
        await pressed(false)
        writeMode = 'lost'
        await heart().click()
        await pressed(true)
        writeMode = 'normal'
        await view('favorites')
        await p
          .getByRole('article', { name: 'Local Shop shop', exact: true })
          .waitFor()
        await pressed(true)
        await capture('favorites')
        await p.getByRole('tab', { name: 'Products', exact: true }).click()
        await p.locator('[data-published-listing]').waitFor()
        await capture('products')
        assert(
          listingCalls.some((x) => x.includes('channel=shop')),
          'Products keeps original Listing API'
        )
        assert.equal(
          saved.get(actorA).size,
          1,
          'Products cannot rewrite Shop favorites'
        )
        await p.getByRole('tab', { name: 'Shops', exact: true }).click()
        await pressed(true)
        await heart().click()
        await p
          .getByText('No available favorite shops.', { exact: true })
          .waitFor()
        await view('card')
        await pressed(false)
        await heart().click()
        await pressed(true)
        eligible = false
        await view('favorites')
        await p
          .getByText('No available favorite shops.', { exact: true })
          .waitFor()
        assert(saved.get(actorA).has(id), 'Suspension retains relationship')
        await view('detail')
        await p
          .getByText('This shop is temporarily unavailable.', { exact: true })
          .waitFor()
        assert.equal(await heart().count(), 0, 'No private fallback header')
        eligible = true
        await view('favorites')
        await pressed(true)
        actor = actorB
        await p.evaluate((actor) => window.setActor(actor), actorB)
        await p
          .getByText('No available favorite shops.', { exact: true })
          .waitFor()
        await view('card')
        await pressed(false)
        actor = ''
        await p.evaluate(() => window.setActor(''))
        await pressed(false)
        const before = writeCount
        await heart().click()
        await p.waitForFunction(() => window.authOpened === 1)
        assert.equal(
          writeCount,
          before,
          'Anonymous follows login without write'
        )
        actor = actorA
        await p.evaluate((actor) => window.setActor(actor), actorA)
        await pressed(true)
        await p.screenshot({
          path: path.join(
            root,
            `b16-card-${width}-${reduced ? 'reduced' : 'normal'}.png`
          ),
        })
        await view('resale')
        await p.locator('[data-published-listing]').waitFor()
        const resale = p.getByRole('button', {
          name: 'Remove from favorites',
          exact: true,
        })
        await resale.click()
        await p
          .getByText('No favorites yet.', { exact: true })
          .waitFor()
          .catch(async (e) => {
            console.error({
              listingCalls,
              listingSaved,
              errors,
              body: await p.locator('body').innerText(),
            })
            throw e
          })
        assert(
          listingCalls.some((x) => x.startsWith('DELETE/api/favorites/')),
          'Resale removal keeps original API'
        )
        assert(
          saved.get(actorA).has(id),
          'Resale cannot alter Shop entity favorite'
        )
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          ),
          'No overflow'
        )
        assert.deepEqual(errors, [])
        await p.close()
        console.log(
          `PASS B16 browser ${width} ${
            reduced ? 'reduced' : 'normal'
          }: confirmed hearts, reload, detail, tabs, failures, suspension, accounts, Resale`
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
