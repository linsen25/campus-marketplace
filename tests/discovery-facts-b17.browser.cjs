/* global window, document, Event, innerWidth */
// Production components/cache/transport; all HTTP is intercepted local test data.
const fs = require('fs'),
  path = require('path'),
  assert = require('assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
delete aliases['@/lib/listings-api']
let mockIndex = 0
function mock(name, source) {
  const file = path.join(root, 'b17-mock-' + mockIndex++ + '.tsx')
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
  `export function useRouter(){return {query:{},push:async()=>{if(window.cancelNavigation)return false;window.show('detail');return true}}}`
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
import 'tailwindcss/src/css/preflight.css';import '@/components/animata/button/shining-button.css';import React,{useState}from'react';import{createRoot}from'react-dom/client';import{Provider}from'jotai';import{LazyMotion,domAnimation}from'framer-motion';import{Session}from'@/components/listings/marketplace-session';import{ShopCard}from'@/components/shops/shop-card';import{ShopPage}from'@/components/shops/shop-page';import{ShopFavorites}from'@/components/shops/shop-favorites';import{Favorites}from'@/components/listings/favorites';import ListingPage from '@/pages/listings/[id]';
window.process={env:{}};window.authOpened=0;window.cancelNavigation=false;function App(){const[view,show]=useState('card');window.show=show;return <Provider><Session><LazyMotion features={domAnimation}><div style={{padding:16}}><nav aria-label="Fixture views">{['card','detail','favorites','resale','listing'].map(v=><button key={v} onClick={()=>show(v)}>{v}</button>)}</nav>{view==='card'?<div style={{maxWidth:340}}><ShopCard shop={window.shop}/></div>:view==='detail'?<ShopPage shop={window.shop} listings={[]}/>:view==='resale'?<Favorites channel="resale"/>:view==='listing'?<ListingPage listing={window.product}/>:<ShopFavorites/>}</div></LazyMotion></Session></Provider>}createRoot(document.getElementById('root')).render(<App/>);`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#21182b;color:white;font-family:Arial}nav[aria-label="Fixture views"]{display:flex;gap:16px;margin-bottom:16px}.ml-auto{margin-left:auto}.shrink-0{flex-shrink:0}</style><script>window.process={env:{}}</script><div id="root"></div><script src="bundle.js"></script>'
)
const id = '11111111-1111-4111-8111-111111111111',
  actorA = '33333333-3333-4333-8333-333333333333'
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
        const facts = new Map(),
          requests = [],
          errors = []
        let actor = actorA,
          lost = false,
          saved = false
        p.on('pageerror', (e) => errors.push(e.message))
        await p.addInitScript(
          ({ shop, listing, actorA }) => {
            window.shop = shop
            window.product = listing
            window.actor = actorA
          },
          { shop, listing, actorA }
        )
        await p.route('**/*', async (route) => {
          const u = new URL(route.request().url()),
            method = route.request().method()
          assert.equal(u.origin, 'http://localhost:4177', 'No external request')
          if (u.pathname === '/bundle.js')
            return route.fulfill({
              path: path.join(root, 'bundle.js'),
              contentType: 'application/javascript',
            })
          if (u.pathname.startsWith('/static/'))
            return route.fulfill({ path: 'public' + u.pathname })
          if (['/api/listings/view', '/api/shops/view'].includes(u.pathname)) {
            assert(actor, 'Anonymous client must not submit activity')
            const body = route.request().postDataJSON()
            requests.push({ path: u.pathname, ...body })
            facts.set(body.eventId, { path: u.pathname, ...body })
            if (lost) {
              lost = false
              return route.abort('failed')
            }
            return route.fulfill({ json: { recorded: true } })
          }
          if (u.pathname.startsWith('/api/shop-favorites')) {
            assert(actor)
            if (method !== 'GET') saved = method === 'POST'
            return route.fulfill({
              json:
                method !== 'GET'
                  ? { shopId: id, favorited: saved }
                  : u.searchParams.has('ids')
                  ? { favoriteShopIds: saved ? [id] : [] }
                  : { shops: saved ? [shop] : [], ...pagination },
            })
          }
          if (u.pathname.startsWith('/api/public-shops'))
            return route.fulfill({
              json:
                u.searchParams.get('kind') === 'listing'
                  ? { state: 'available', listing, refreshAfterMs: 30000 }
                  : {
                      state: 'available',
                      shop,
                      listings: [listing],
                      ...pagination,
                    },
            })
          if (u.pathname.startsWith('/api/favorites'))
            return route.fulfill({
              json:
                u.pathname === '/api/favorites'
                  ? [
                      {
                        ...listing,
                        listingChannel:
                          u.searchParams.get('channel') || 'resale',
                      },
                    ]
                  : { favorited: method !== 'DELETE' },
            })
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
        const waitCount = async (n) => {
          for (let i = 0; i < 100 && facts.size !== n; i++)
            await p.waitForTimeout(20)
          assert.equal(facts.size, n)
        }
        const noNew = async (n) => {
          await p.waitForTimeout(160)
          assert.equal(facts.size, n)
        }
        await p.goto('http://localhost:4177/')
        await p
          .getByRole('article', { name: 'Local Shop shop', exact: true })
          .waitFor()
        await p.getByRole('button', { name: 'Go to shop', exact: true }).hover()
        await noNew(0)
        await p.evaluate(() => (window.cancelNavigation = true))
        await p.getByRole('button', { name: 'Go to shop', exact: true }).click()
        await noNew(0)
        await p.waitForFunction(() =>
          document.querySelector('button[data-state="error"]')
        )
        await p.waitForTimeout(900)
        await p.evaluate(() => (window.cancelNavigation = false))
        lost = true
        await p.getByRole('button', { name: 'Go to shop', exact: true }).click()
        await p
          .getByRole('heading', { name: 'Local Shop', exact: true })
          .waitFor()
        await waitCount(1)
        await p.waitForTimeout(160)
        assert.equal(requests.length, 2, 'lost response retries once')
        assert.equal(requests[0].eventId, requests[1].eventId)
        assert.equal(requests[0].path, '/api/shops/view')
        await p.evaluate(() => window.dispatchEvent(new Event('focus')))
        await noNew(1)
        const trigger = p.locator('[data-slot="expandable-card"]')
        await trigger.waitFor()
        await trigger.click()
        await p.getByRole('dialog').waitFor()
        await waitCount(2)
        assert.equal(requests.at(-1).path, '/api/listings/view')
        assert.equal(requests.at(-1).listingId, listing.id)
        await p.keyboard.press('Escape')
        await p.getByRole('dialog').waitFor({ state: 'hidden' })
        await trigger.click()
        await p.getByRole('dialog').waitFor()
        await waitCount(3)
        await p.keyboard.press('Escape')
        await p.getByRole('dialog').waitFor({ state: 'hidden' })
        await view('resale')
        await p.locator('[data-published-listing]').waitFor()
        await noNew(3)
        await p.locator('[data-slot="expandable-card"]').click()
        await p.getByRole('dialog').waitFor()
        await waitCount(4)
        await p.keyboard.press('Escape')
        await p.getByRole('dialog').waitFor({ state: 'hidden' })
        await view('listing')
        await p.getByRole('heading', { name: 'Camera', exact: true }).waitFor()
        await noNew(4)
        await p.reload()
        await p
          .getByRole('article', { name: 'Local Shop shop', exact: true })
          .waitFor()
        await noNew(4)
        await view('card')
        const favorite = p.getByRole('button', {
          name: 'Favorite shop: Local Shop',
          exact: true,
        })
        await favorite.click()
        await p
          .getByRole('button', {
            name: 'Unfavorite shop: Local Shop',
            exact: true,
          })
          .waitFor()
        await noNew(4)
        await view('favorites')
        await p
          .getByRole('article', { name: 'Local Shop shop', exact: true })
          .waitFor()
        await noNew(4)
        await p.getByRole('tab', { name: 'Products', exact: true }).click()
        await p.locator('[data-published-listing]').waitFor()
        await noNew(4)
        actor = ''
        await p.evaluate(() => window.setActor(''))
        await view('card')
        await p.getByRole('button', { name: 'Go to shop', exact: true }).click()
        await p
          .getByRole('heading', { name: 'Local Shop', exact: true })
          .waitFor()
        await noNew(4)
        await p.locator('[data-slot="expandable-card"]').click()
        await p.getByRole('dialog').waitFor()
        await noNew(4)
        await p.keyboard.press('Escape')
        await p.getByRole('dialog').waitFor({ state: 'hidden' })
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        )
        assert.deepEqual(errors, [])
        await p.screenshot({
          path: path.join(
            root,
            `b17-${width}-${reduced ? 'reduced' : 'normal'}.png`
          ),
        })
        await p.close()
        console.log(
          `PASS B17 browser ${width} ${
            reduced ? 'reduced' : 'normal'
          }: intentional authenticated Shop/Shop Listing/Resale opens, retry, passive/anonymous exclusion, favorites and unchanged UI`
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
