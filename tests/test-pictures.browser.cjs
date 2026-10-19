// Real presentation components; controlled fixture inputs and local asset HTTP only.
/* global window, document, getComputedStyle */
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { TEST_PICTURES } = require('../scripts/lib/test-pictures.cjs')
const source = fs.readFileSync(
  'tests/published-listing-card.browser.cjs',
  'utf8'
)
const setup = new Function(
  'require',
  source.slice(0, source.indexOf('async function main()')) +
    ';return {root,build,aliases,mock}'
)(require)
const { root, build, aliases, mock } = setup
mock(
  'photo-flow',
  `export function useOrderFlow(){return {error:'',refresh:async()=>{},data:{checkout:null,courier:null,credential:null,fulfillment:{agreement:{complete:false},externalExchange:null,cancellation:null,handoffReady:false,handoffConfirmedAt:null,protectionStartedAt:null,protectionCompletedAt:null}}}}`,
  ['@/hooks/use-order-flow']
)
mock('photo-dynamic', 'export default function dynamic(){return ()=>null}', [
  'next/dynamic',
])
mock(
  'photo-navigation',
  'export function useDesktopRouteTransition(){return ()=>{}}',
  ['@/components/navigation/desktop-route-transition']
)
mock('photo-ready', 'export function useMarketReady(){}', [
  '@/hooks/use-market-ready',
])
mock(
  'photo-scroll',
  'const scroll={animateTo(){},cancel(){}};export function useMarketScroll(){return scroll}',
  ['@/hooks/use-market-scroll']
)
mock(
  'photo-owner-api',
  `export async function getMyListings(){return []};export async function getListing(){return window.listing};export async function getListings(){return []};export async function marketplaceRequest(){throw Error('Unexpected API')};export async function deleteListing(){throw Error('Unexpected delete')};export async function markListingSold(){throw Error('Unexpected sold')}`,
  ['@/lib/listings-api']
)
fs.appendFileSync(
  path.join(root, 'entry.tsx'),
  `
import {ListingMedia} from '@/components/listings/listing-media';
import {MessagesListingPreview} from '@/components/home/messages-listing-preview';
import {OrderListCard} from '@/components/home/order-list-presentation';
import {FormalOrderDetail} from '@/components/home/formal-order-detail';
import {ResaleManagementCard} from '@/components/listings/resale-management-card';
import {TEST_PICTURE_POOL} from '@/lib/fixtures/test-pictures';
import {parseListingFilters} from '@/lib/listing-filters';
import {marketPreviewListings} from '@/lib/fixtures/market-layout';
import {MarketLayout} from '@/components/listings/market-layout';
import {ShopDirectory} from '@/components/shops/shop-directory';
import {HomepageListingDemo} from '@/components/listings/homepage-listing-demo';
import {HomepageShopDemo} from '@/components/listings/homepage-shop-demo';
import {recommendedShopsDemo} from '@/components/shops/recommended-shops-demo';
import {demoShopProducts} from '@/components/shops/shop-demo-data';
window.fixtureImageManifest={market:marketPreviewListings.map(x=>({id:x.id,src:x.images[0],title:x.title})),shops:recommendedShopsDemo.map(x=>({id:x.id,src:x.image,title:x.name})),products:demoShopProducts.map(x=>({id:x.listing.id,src:x.listing.photoUrls[0],title:x.listing.title}))};
window.showCatalog=surface=>{window.viewer={id:'owner'};let content=surface==='market'?<MarketLayout values={parseListingFilters({}).values}/>:surface==='shops'?<ShopDirectory/>:surface==='welcome'?<><HomepageListingDemo/><HomepageShopDemo/></>:<HomeListings page="my-shop" onSelect={()=>{}}/>;flushSync(()=>root.render(<LazyMotion features={domAnimation}><div key={++generation} data-catalog-surface={surface}>{content}</div></LazyMotion>))};
window.showPhotos=(surface,photo,entityId='shared-photo-fixture')=>{
  const listing={...window.listing,id:entityId,photoUrls:[photo],title:'Shared fixture item'};
  window.listing=listing;window.favorited=true;window.viewer={id:'buyer'};
  const chat={...listing,liveId:listing.id,availability:'available',live:listing};
  const order={id:'fda25a07-1c57-483e-93f1-2ae81b39b6c7',listingId:listing.id,buyerId:'buyer',sellerId:'seller',protocolVersion:2,lifecycle:'cancelled',paymentStatus:'pending',payoutStatus:'not_eligible',itemAmount:4500,createdAt:'2026-10-16',snapshot:{listing,buyer:'Buyer',seller:'Seller',draft:{fulfillment:'meet'}},v2:{terms:{fulfillment:'on_campus',paymentMode:'uu_pay',itemAmountCents:4500,currency:'CAD',meetupLocation:'Library entrance',scheduledAt:'2026-10-18T12:00:00Z'},askingPriceCents:4500,description:listing.description,condition:'good',subcategory:'Furniture'},cancellation:{at:'2026-10-17T12:00:00Z',byRole:'buyer',reason:'Changed my mind'}};
  let content=<PublishedListingCard listing={listing}/>;
  if(surface==='favorites')content=<Favorites/>;
  if(surface==='owner')content=<ResaleManagementCard listing={listing} onEdit={()=>{}} onDelete={()=>{}}/>;
  if(surface==='messages')content=<MessagesListingPreview listing={chat} destination="buying" onCancel={()=>{}}/>;
  if(surface==='sales'||surface==='orders')content=<OrderListCard id={order.id} title={listing.title} images={order.snapshot.listing.photoUrls} amount="CA$45" fulfillment="Meeting" state={<span>Cancelled</span>} onOpen={()=>{}}/>;
  if(surface==='detail')content=<FormalOrderDetail order={order} userId="buyer" mode="purchases" offset={0} onBack={()=>{}} onRefresh={async()=>{}} onUpdated={()=>{}} onCancelled={()=>{}}/>;
  if(surface==='pool')content=<div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:12}}>{TEST_PICTURE_POOL.map(src=><div key={src} style={{height:160,overflow:'hidden',borderRadius:16}}><ListingMedia images={[src]} alt={src}/></div>)}</div>;
  flushSync(()=>root.render(<LazyMotion features={domAnimation}><main data-photo-surface={surface} style={{padding:16,minWidth:0}}><div key={++generation}>{content}</div></main></LazyMotion>));
};
`
)
async function run() {
  await build(aliases)
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const b = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  const evidence = []
  try {
    for (const width of [390, 430, 820, 1280, 1536]) {
      const p = await b.newPage({
        viewport: { width, height: 900 },
        reducedMotion: 'reduce',
      })
      const errors = []
      p.on('pageerror', (e) => errors.push(e.message))
      await p.route('**/*', (r) => {
        const u = new URL(r.request().url())
        assert(
          ['http://localhost:4177', 'https://uploads.example.test'].includes(
            u.origin
          ),
          'No external services'
        )
        if (u.origin === 'https://uploads.example.test') return r.abort()
        if (
          u.pathname.startsWith('/static/') &&
          !u.pathname.startsWith('/static/testPic/')
        )
          return r.fulfill({ path: path.resolve('public', '.' + u.pathname) })
        if (u.pathname.startsWith('/static/testPic/'))
          return r.fulfill({
            path: path.resolve('public', '.' + u.pathname),
            contentType: 'image/webp',
          })
        if (u.pathname === '/' || u.pathname === '/bundle.js')
          return r.fulfill({
            path: path.join(
              root,
              u.pathname === '/' ? 'index.html' : 'bundle.js'
            ),
            contentType:
              u.pathname === '/' ? 'text/html' : 'application/javascript',
          })
        throw Error('Unexpected request: ' + u.pathname)
      })
      await p.goto('http://localhost:4177/')
      for (const surface of ['market', 'shops', 'products', 'welcome']) {
        await p.evaluate((s) => window.showCatalog(s), surface)
        const host = p.locator('[data-catalog-surface]')
        await host.locator('img[src^="/static/testPic/"]').first().waitFor()
        const manifest = await p.evaluate(() => window.fixtureImageManifest)
        if (surface === 'shops') {
          const recommended = p.locator(
            '[data-overlapping-slider] [data-slider-copy="0"]'
          )
          const directory = p.locator('[data-directory-shop]')
          for (let i = 0; i < manifest.shops.length; i++) {
            const expected = manifest.shops[i]
            for (const card of [recommended.nth(i), directory.nth(i)]) {
              const image = card.locator('img').first()
              assert.equal(
                await image.getAttribute('src'),
                expected.src,
                expected.id + ' shared shop cover'
              )
              await image.evaluate((n) => {
                n.loading = 'eager'
                return n.decode()
              })
              evidence.push({
                width,
                surface,
                id: expected.id,
                src: await image.getAttribute('src'),
              })
            }
          }
          await recommended.first().scrollIntoViewIfNeeded()
          await p.screenshot({
            path: path.join(root, 'migrated-recommended-' + width + '.png'),
            fullPage: true,
          })
          // Real Detail products reuse the same dataset, not remapped copies.
          const go = directory.first().getByRole('button', {
            name: 'Go to Luna Studio demo shop',
            exact: true,
          })
          await go.click()
          await p.locator('[data-shop-detail-demo]').waitFor()
          const detailImages = p.locator('[data-shop-detail-demo] img')
          const actual = await detailImages.evaluateAll((nodes) =>
            nodes.map((n) => n.getAttribute('src'))
          )
          for (const product of manifest.products)
            assert(
              actual.includes(product.src),
              'Detail contains canonical ' + product.id
            )
        }
        if (surface === 'market') {
          const cards = p.locator(
            '[data-market-feed="resale"] [data-slot="expandable-card"]'
          )
          assert((await cards.count()) > 0)
          const checked = new Set()
          for (let page = 1; page <= 2; page++) {
            for (const card of await cards.all()) {
              const title = await card.textContent()
              const image = card.locator('img').first()
              const src = await image.getAttribute('src')
              const imageTitle = await image.getAttribute('alt')
              const expected = manifest.market.find(
                (x) => title.includes(x.title) || imageTitle === x.title
              )
              assert(expected, 'known local Market fixture')
              assert.equal(src, expected.src)
              assert(!title.includes('[DEMO]'))
              await image.evaluate((n) => {
                n.loading = 'eager'
                return n.decode()
              })
              checked.add(expected.id)
              evidence.push({ width, surface, id: expected.id, src })
            }

            await p.screenshot({
              path: path.join(
                root,
                'migrated-market-' + width + '-page-' + page + '.png'
              ),
              fullPage: true,
            })
            if (checked.size === manifest.market.length) break
            const firstSrc = await cards
              .first()
              .locator('img')
              .getAttribute('src')
            const next = p
              .getByRole('navigation', { name: 'Listing pages' })
              .getByRole('button', { name: 'Next', exact: true })
            await next.click()
            await p.waitForFunction(
              (previous) =>
                document
                  .querySelector(
                    '[data-market-feed="resale"] [data-slot="expandable-card"] img'
                  )
                  ?.getAttribute('src') !== previous,
              firstSrc
            )
          }
          assert.equal(
            checked.size,
            30,
            'all local Market images checked across desktop pages/mobile batches'
          )
        }
        if (surface === 'products') {
          await p
            .getByText(manifest.products[0].title, { exact: true })
            .waitFor()
          const actual = await host
            .locator('img')
            .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('src')))
          for (const product of manifest.products.slice(0, 6))
            assert(
              actual.includes(product.src),
              'Manage Products canonical ' + product.id
            )
          evidence.push(
            ...manifest.products
              .slice(0, 6)
              .map((x) => ({ width, surface, ...x }))
          )
        }
        if (surface === 'welcome') {
          const actual = await host
            .locator('img')
            .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('src')))
          assert(actual.includes('/static/testPic/chair.webp'))
          assert(actual.includes('/static/testPic/jewelry.webp'))
          evidence.push({ width, surface, src: actual })
        }
        for (const image of await host
          .locator('img[src^="/static/testPic/"]')
          .all())
          await image.evaluate((n) => {
            n.loading = 'eager'
            return n.decode()
          })
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          ),
          surface + ' no overflow'
        )
      }
      for (const [entityKey, picture] of Object.entries({
        chair: TEST_PICTURES.chair,
        monitor: TEST_PICTURES.monitor,
        laptop: TEST_PICTURES.laptop,
      })) {
        for (const surface of [
          'market',
          'favorites',
          'owner',
          'messages',
          'sales',
          'orders',
          'detail',
        ]) {
          await p.evaluate(
            (v) => window.showPhotos(v.surface, v.picture, v.entityId),
            {
              surface,
              picture,
              entityId: `photo-fixture-${entityKey}`,
            }
          )
          const image = p.locator('main img').first()
          await image.waitFor()
          await image.evaluate((e) => {
            e.loading = 'eager'
            return e.decode()
          })
          evidence.push({
            width,
            surface,
            id: `photo-fixture-${entityKey}`,
            src: await image.getAttribute('src'),
          })
          assert.equal(
            await image.getAttribute('src'),
            picture,
            surface + ' exact fixture image identity'
          )
          assert.equal(
            await image.evaluate((e) => getComputedStyle(e).objectFit),
            'cover'
          )
          assert(
            await p.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth
            ),
            surface + ' no overflow'
          )
          if (surface === 'market') {
            await p.locator('[data-slot="expandable-card"]').click()
            const dialog = p.getByRole('dialog')
            await dialog.waitFor()
            assert.equal(
              await dialog.locator('img').first().getAttribute('src'),
              picture
            )
            await dialog
              .locator('img')
              .first()
              .evaluate((e) => e.decode())
            await dialog
              .getByRole('button', { name: 'Close', exact: true })
              .click()
            await dialog.waitFor({ state: 'detached' })
          }
        }
      }
      await p.evaluate(() => window.showPhotos('pool'))
      const all = p.locator('main img')
      assert.equal(await all.count(), 30)
      for (const img of await all.all())
        await img.evaluate((e) => {
          e.loading = 'eager'
          return e.decode()
        })
      assert(
        await all.evaluateAll((images) =>
          images.every((e) => e.naturalWidth > 0 && e.naturalHeight > 0)
        )
      )
      await p.screenshot({
        path: path.join(root, 'canonical-photo-pool-' + width + '.png'),
        fullPage: true,
      })
      await p.evaluate(() =>
        window.showPhotos(
          'market',
          'https://uploads.example.test/real-user-image.webp'
        )
      )
      const real = p.locator('main img').first()
      await real.waitFor()
      await p.waitForTimeout(120)
      assert.equal(
        await real.getAttribute('src'),
        'https://uploads.example.test/real-user-image.webp',
        'failed real uploads never fall back to test photos'
      )
      assert.deepEqual(errors, [])
      console.log(
        'PASS ' +
          width +
          ': all 30 assets decode; 3 shared entities across Market/expanded/Favorites/owner/Messages/Sales/Orders/Detail; cover/crops; real media failure unchanged; no overflow'
      )
      await p.close()
    }
    fs.writeFileSync(
      path.join(root, 'rendered-photo-evidence.json'),
      JSON.stringify(evidence, null, 2)
    )
  } finally {
    await b.close()
  }
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
