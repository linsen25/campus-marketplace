const { testPictureDataUrl } = require('../scripts/lib/test-pictures.cjs')
/* global window, document, getComputedStyle */
// Offline real consumers. No hosted API, credentials, or staging writes.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')

async function checkOverlay(heart) {
  const actual = await heart.evaluate((el) => {
    const style = getComputedStyle(el),
      svg = getComputedStyle(el.querySelector('svg'))
    return {
      background: style.backgroundColor,
      blur: style.backdropFilter,
      stroke: svg.stroke,
      fill: svg.fill,
      liked: el.dataset.liked,
      width: el.offsetWidth,
      height: el.offsetHeight,
    }
  })
  assert(
    ['rgba(25, 25, 25, 0.6)', 'rgba(25, 25, 25, 0.72)'].includes(
      actual.background
    )
  )
  assert.equal(actual.blur, 'blur(4px)')
  assert.equal(
    actual.stroke,
    actual.liked === 'true' ? 'rgb(217, 121, 145)' : 'rgb(250, 250, 250)'
  )
  assert.equal(actual.fill, actual.liked === 'true' ? actual.stroke : 'none')
  assert(actual.width >= 41 && actual.height >= 41)
}

const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
const mock = (name, source, targets) => {
  const file = path.join(root, name + '.tsx')
  fs.writeFileSync(file, source)
  for (const target of targets) {
    aliases[target] = file
    if (target.startsWith('@/')) aliases[path.resolve(target.slice(2))] = file
  }
}
mock(
  'card-session',
  `export function useMarketplaceSession(){return {seller:window.viewer,loading:false,error:''}}`,
  ['@/components/listings/marketplace-session']
)
mock(
  'card-auth',
  `export function useAuthModal(){return {openAuth(){window.auth++}}}`,
  ['@/components/auth/auth-modal']
)
mock('card-head', `export default function Head(){return null}`, ['next/head'])
mock(
  'card-link',
  `import React from 'react';export const Link=props=><a {...props}/>`,
  ['@ui/link/link']
)
mock(
  'card-favorites',
  `export async function favoriteState(){return {favorited:window.favorited}};export async function setFavorite(id,value){window.writes.push({id,value});if(window.fail){window.fail=false;throw Error('Favorite save failed')}if(window.hold)await new Promise(r=>window.release=r);window.favorited=value;return {favorited:value}};export async function getFavoriteListings(){return window.favorited?[window.listing]:[]}`,
  ['@/lib/favorites-api']
)
mock(
  'card-api',
  `export async function getMyListings(){return [window.listing]};export async function getListing(){return window.listing};export async function marketplaceRequest(){throw Error('Unexpected API')};export async function deleteListing(){window.ownerActions.push('delete')};export async function markListingSold(){window.ownerActions.push('sold');return window.listing}`,
  ['@/lib/listings-api']
)
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import '@/components/animata/button/shining-button.css';import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{LazyMotion,domAnimation}from'framer-motion';
import{PublishedListingCard}from'@/components/listings/published-listing-card';import{MarketListingFeed}from'@/components/listings/market-listing-feed';import{Favorites}from'@/components/listings/favorites';import{HomeListings}from'@/components/listings/home-listings';import{ShopPage}from'@/components/shops/shop-page';import SellerPage from '${path
    .resolve('pages/seller/[id]')
    .replaceAll(
      '\\',
      '/'
    )}';import ProfileListings from '@/pages/profile/listings';import{ListingSkeletonGrid}from'@/components/ui/workspace-skeletons';
const image=${JSON.stringify(testPictureDataUrl('chair'))};
window.listing={id:'item',listingChannel:'resale',title:'Wooden accent chair',price:4500,currency:'CAD',condition:'good',category:'Home & Dorm',subcategory:'Furniture',description:'Real description',preferredPaymentMode:'uu_pay',preferredFulfillment:'ON_CAMPUS',meetingLocation:{label:'Outside library',provider:'google',placeId:'NEVER_RENDER_PLACE_ID'},photoUrls:[image,image+'#second'],seller:{id:'seller',displayName:'Alex'},status:'available',createdAt:'2026-10-16',updatedAt:'2026-10-16',publishedAt:'2026-10-16'};
window.viewer={id:'buyer'};window.views=0;window.writes=[];window.favorited=false;window.auth=0;window.actions=[];window.ownerActions=[];
const shop={username:'alex',sellerProfileId:'seller',shopName:'Example Shop',category:'Home',description:'Shop description'};const root=createRoot(document.getElementById('root'));let generation=0;
window.show=(surface='market')=>{window.surface=surface;const card=<PublishedListingCard listing={window.listing} onIntentionalOpen={()=>window.views++}/>;let content=card;if(surface==='market')content=<MarketListingFeed isApp={window.innerWidth<1024} items={[{id:'item',title:window.listing.title,customContent:card}]} feedKey="fixture" pageNumber={1} onChangePage={()=>{}} onReturnToTop={()=>{}}/>;if(surface==='favorites')content=<Favorites/>;if(surface==='resale')content=<HomeListings page="my-listings" onSelect={()=>{}}/>;if(surface==='shop')content=<ShopPage shop={shop} listings={[{...window.listing,listingChannel:'shop'}]}/>;if(surface==='seller')content=<SellerPage seller={{identifier:'seller',username:'alex',avatarUrl:null,listings:[window.listing],page:1,hasNextPage:false}}/>;if(surface==='profile')content=<ProfileListings listings={[window.listing]}/>;if(surface==='skeleton')content=<ListingSkeletonGrid/>;flushSync(()=>root.render(<LazyMotion features={domAnimation}><div key={++generation} style={{padding:16,color:'#fafafa',minWidth:0}}>{content}</div></LazyMotion>));};window.show();
`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#0b0b0b;color:#fafafa;font-family:Arial}html{scrollbar-gutter:stable}</style><div id="root"></div><script>window.process={env:{}}</script><script src="bundle.js"></script>'
)
async function main() {
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
      const p = await browser.newPage({
        viewport: { width, height: 900 },
        reducedMotion: 'reduce',
      })
      const errors = []
      p.on('pageerror', (e) => errors.push(e.message))
      await p.route(/^https?:/, (r) => r.abort())
      await p.goto(
        'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      for (const surface of [
        'market',
        'favorites',
        'resale',
        'shop',
        'seller',
        'profile',
      ]) {
        await p.evaluate((surface) => {
          window.viewer = {
            id: ['resale', 'profile'].includes(surface) ? 'seller' : 'buyer',
          }
          window.favorited = surface === 'favorites'
          window.show(surface)
        }, surface)
        const shell = p.locator('[data-published-listing]'),
          trigger = shell.locator('[data-slot="expandable-card"]')
        await trigger.waitFor()
        await p.waitForTimeout(150)
        assert.equal(await shell.count(), 1, surface + ' uses shared card')
        assert.equal(
          await trigger
            .getByText('Wooden accent chair', { exact: true })
            .count(),
          1
        )
        assert.equal(
          await trigger
            .getByText('Good \u00b7 Home & Dorm', { exact: true })
            .count(),
          1
        )
        assert.equal(await trigger.getByText('Real description').count(), 0)
        const geo = await trigger.evaluate((e) => {
          const m = e.firstElementChild,
            r = m.getBoundingClientRect()
          return {
            w: r.width,
            h: r.height,
            radius: getComputedStyle(m).borderRadius,
            bg: getComputedStyle(e).backgroundColor,
            fit: getComputedStyle(m.querySelector('img')).objectFit,
          }
        })
        assert(Math.abs(geo.w - geo.h) < 0.5)
        assert.equal(geo.radius, '16px')
        assert.equal(geo.bg, 'rgba(0, 0, 0, 0)')
        assert.equal(geo.fit, 'cover')
        const owner = ['resale', 'profile'].includes(surface),
          heart = shell.getByRole('button', { name: /favorites/ })
        assert.equal(await heart.count(), owner ? 0 : 1)
        if (!owner) {
          await checkOverlay(heart)
          if (surface === 'market') {
            for (const brightness of [2, 0.12]) {
              await shell
                .locator('img')
                .first()
                .evaluate((img, value) => {
                  img.style.filter = `brightness(${value})`
                }, brightness)
              await checkOverlay(heart)
              await shell.screenshot({
                path: path.join(
                  root,
                  `favorite-overlay-${width}-${brightness}.png`
                ),
              })
            }
            await shell
              .locator('img')
              .first()
              .evaluate((img) => {
                img.style.filter = ''
              })
            await heart.hover()
            assert.equal(
              await heart.evaluate(
                (el) => getComputedStyle(el).backgroundColor
              ),
              'rgba(25, 25, 25, 0.72)'
            )
            await checkOverlay(heart)
            await p.mouse.move(0, 0)
          }
          const h = await heart.boundingBox()
          assert(h.width >= 44 && h.height >= 44)
          assert.equal(await heart.locator('button').count(), 0)
        }
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          ),
          surface + ' no overflow'
        )
        await trigger.click()
        const dialog = p.getByRole('dialog')
        await dialog.waitFor()
        await p.waitForTimeout(500)
        const media = await dialog
          .locator(':scope > div:first-child > div:first-child')
          .boundingBox()
        assert(
          Math.abs(media.width / media.height - (width < 768 ? 4 / 3 : 4 / 5)) <
            0.01,
          surface + ' expanded baseline responsive ratio'
        )
        const priceRow = dialog.locator('[class*="_expandedPriceRow"]')
        const rowGeometry = await priceRow.evaluate((el) => {
          const row = el.getBoundingClientRect(),
            price = el
              .querySelector('[class*="_expandedPriceValue"]')
              .getBoundingClientRect()
          const heart = el.querySelector('button'),
            h = heart?.getBoundingClientRect(),
            heading = el
              .closest('[data-slot="expanded-price"]')
              .nextElementSibling.getBoundingClientRect()
          return {
            row: {
              x: row.x,
              right: row.right,
              y: row.y,
              height: row.height,
              bottom: row.bottom,
            },
            price: { x: price.x, right: price.right },
            heart: h
              ? {
                  x: h.x,
                  right: h.right,
                  y: h.y,
                  height: h.height,
                  width: h.width,
                }
              : null,
            gap: heading.top - row.bottom,
            display: getComputedStyle(el).display,
            align: getComputedStyle(el).alignItems,
            justify: getComputedStyle(el).justifyContent,
          }
        })
        assert.equal(rowGeometry.display, 'flex')
        assert.equal(rowGeometry.align, 'center')
        assert.equal(rowGeometry.justify, 'space-between')
        assert(
          Math.abs(rowGeometry.row.height - 33) < 1,
          'price line height unchanged'
        )
        assert(
          Math.abs(rowGeometry.gap - 12) < 1,
          'price-to-title spacing unchanged'
        )
        assert(
          Math.abs(rowGeometry.price.x - rowGeometry.row.x) < 1,
          'price left aligned'
        )
        if (['resale', 'profile'].includes(surface))
          assert.equal(rowGeometry.heart, null, 'owner visibility unchanged')
        else {
          const h = rowGeometry.heart,
            r = rowGeometry.row
          assert(
            h.width >= 44 && h.height >= 44,
            'favorite hit target unchanged'
          )
          assert(
            Math.abs(h.right - r.right) < 1,
            'heart at right edge of price row'
          )
          assert(
            Math.abs(h.y + h.height / 2 - r.y - r.height / 2) < 1,
            'heart centered on price row'
          )
          assert(
            rowGeometry.price.right <= h.x - 11,
            'price reserves heart space'
          )
        }
        assert.equal(
          await dialog.evaluate((e) => getComputedStyle(e).borderRadius),
          '16px'
        )
        assert.deepEqual(
          await dialog
            .locator('section[aria-label]:not([aria-label$=" photos"])')
            .evaluateAll((es) => es.map((e) => e.getAttribute('aria-label'))),
          ['Seller', 'Item details', 'Description', 'Exchange preferences']
        )
        for (const text of [
          'Alex',
          'UU Pay',
          'Meeting',
          'Outside library',
          'Furniture',
        ])
          assert((await dialog.textContent()).includes(text))
        assert(!(await dialog.textContent()).includes('verified'))
        assert(!(await dialog.textContent()).includes('NEVER_RENDER_PLACE_ID'))
        const close = dialog.getByRole('button', { name: 'Close', exact: true })
        assert((await close.getAttribute('class')).includes('shining-button'))
        assert.equal(
          await close.locator('svg').count(),
          0,
          'Close has no arrow/icon/spacer'
        )
        assert.equal(await close.getAttribute('aria-busy'), null)
        assert.equal(
          await close.getAttribute('data-state'),
          null,
          'no loading state'
        )
        assert.equal(
          await close.evaluate((el) =>
            getComputedStyle(el).getPropertyValue('--shine-color').trim()
          ),
          '#772d40'
        )
        assert(
          await close.evaluate((el) => {
            const body = el.querySelector('.shining-button__body')
            const text = Array.from(body.childNodes).find(
              (n) => n.nodeType === 3 && n.textContent.includes('Close')
            )
            const range = document.createRange()
            range.selectNodeContents(text)
            const b = el.getBoundingClientRect(),
              t = range.getBoundingClientRect()
            return Math.abs(b.x + b.width / 2 - t.x - t.width / 2) < 1
          }),
          'Close label centered without icon gap'
        )
        await close.click()
        await dialog.waitFor({ state: 'detached' })
        await p.waitForTimeout(600)
        if (surface === 'resale')
          for (const label of ['Edit', 'Mark as sold', 'Delete'])
            assert.equal(
              await p.getByRole('button', { name: label, exact: true }).count(),
              1
            )
        if (surface === 'profile')
          assert.equal(
            await p
              .getByRole('button', { name: 'Mark Wooden accent chair as sold' })
              .count(),
            1
          )
        if (surface === 'favorites') {
          await shell
            .getByRole('button', { name: 'Remove from favorites' })
            .click()
          await p.getByText('No favorites yet.').waitFor()
          assert.equal(await p.getByRole('dialog').count(), 0)
        }
      }
      // One state/load/save path; no open/view on the sibling Favorite control.
      await p.evaluate(() => {
        window.viewer = { id: 'buyer' }
        window.favorited = false
        window.views = 0
        window.writes = []
        window.show('market')
      })
      let shell = p.locator('[data-published-listing]'),
        heart = shell.getByRole('button', { name: 'Add to favorites' })
      await heart.click()
      await shell
        .getByRole('button', { name: 'Remove from favorites' })
        .waitFor()
      assert.equal(await p.getByRole('dialog').count(), 0)
      assert.equal(await p.evaluate(() => window.views), 0)
      await shell.locator('[data-slot="expandable-card"]').click()
      let dialog = p.getByRole('dialog')
      await dialog.waitFor()
      await p.waitForTimeout(500)
      assert.equal(
        await dialog
          .getByRole('button', { name: 'Remove from favorites' })
          .count(),
        1
      )
      await dialog
        .getByRole('button', { name: 'Remove from favorites' })
        .click()
      await dialog.getByRole('button', { name: 'Add to favorites' }).waitFor()
      await p.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached' })
      await p.waitForTimeout(600)
      await shell.getByRole('button', { name: 'Add to favorites' }).waitFor()
      await p.evaluate(() => {
        window.fail = true
      })
      await shell.getByRole('button', { name: 'Add to favorites' }).click()
      await shell.getByRole('alert').waitFor()
      assert(
        await shell
          .getByRole('button', { name: 'Add to favorites' })
          .isEnabled()
      )
      await shell.getByRole('button', { name: 'Add to favorites' }).focus()
      await p.keyboard.press('Enter')
      await shell
        .getByRole('button', { name: 'Remove from favorites' })
        .waitFor()
      assert.equal(await p.evaluate(() => window.views), 1)
      await p.evaluate(() => {
        window.viewer = null
        window.show('market')
      })
      await p
        .locator('[data-published-listing]')
        .getByRole('button', { name: /favorites/ })
        .click()
      assert.equal(await p.evaluate(() => window.auth), 1)
      assert.equal(await p.getByRole('dialog').count(), 0)
      await p.evaluate(() => {
        window.viewer = { id: 'buyer' }
        window.listing.condition = undefined
        window.listing.description = ' '
        window.listing.subcategory = 'invalid'
        window.listing.preferredFulfillment = 'DELIVERY'
        window.listing.preferredPaymentMode = 'external'
        window.listing.estimatedDeliveryFeeCents = 0
        window.listing.title = 'A very long title '.repeat(20)
        window.show('market')
      })
      shell = p.locator('[data-published-listing]')
      assert.equal(
        await shell.getByText('Home & Dorm', { exact: true }).count(),
        1
      )
      await shell.locator('[data-slot="expandable-card"]').click()
      dialog = p.getByRole('dialog')
      await dialog.waitFor()
      await p.waitForTimeout(500)
      assert.equal(
        await dialog.locator('section[aria-label="Description"]').count(),
        0
      )
      assert.equal(
        await dialog.getByText('Condition', { exact: true }).count(),
        0
      )
      assert.equal(
        await dialog.getByText('Subcategory', { exact: true }).count(),
        0
      )
      assert.equal(
        await dialog.getByText('Delivery', { exact: true }).count(),
        1
      )
      assert.equal(await dialog.getByText('FREE', { exact: true }).count(), 1)
      assert(!(await dialog.textContent()).includes('Outside library'))
      await p.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached' })
      await p.waitForTimeout(600)
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        ),
        'long text no overflow'
      )
      await p.evaluate(() => window.show('skeleton'))
      const skeleton = p
        .locator('[aria-label="Loading listings"] article')
        .first()
        .locator('div')
        .first()
      const sr = await skeleton.boundingBox()
      assert(Math.abs(sr.width - sr.height) < 0.5, 'Listing skeleton square')
      assert.deepEqual(errors, [])
      await p.close()
      console.log(
        'PASS shared Listing ' +
          width +
          ': six consumers, square/responsive expanded baseline/16px, Favorite sync/removal/error/keyboard/auth/no views, conditional details, long text, skeleton, no overflow'
      )
    }
    // Sample actual shared-layout media frames, including the returning-media phase.
    for (const reducedMotion of ['reduce', 'no-preference'])
      for (const width of [390, 430, 820, 1280, 1536]) {
        const p = await browser.newPage({
          viewport: { width, height: 900 },
          reducedMotion,
        })
        await p.route(/^https?:/, (r) => r.abort())
        await p.goto(
          'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
        )
        await p.locator('[data-slot="expandable-card"]').waitFor()
        await p.evaluate(() => {
          window.frames = []
          window.sampling = true
          const sample = () => {
            if (!window.sampling) return
            for (const e of document.querySelectorAll(
              '[data-slot="listing-overlay"] [role="dialog"] > div:first-child > div:first-child,[data-slot="returning-media"]'
            )) {
              const r = e.getBoundingClientRect(),
                parts = getComputedStyle(e).borderTopLeftRadius.split(' ')
              window.frames.push({
                returning: e.dataset.slot === 'returning-media',
                x: parts[0].endsWith('%')
                  ? (parseFloat(parts[0]) * r.width) / 100
                  : (parseFloat(parts[0]) * r.width) / e.offsetWidth,
                y: (parts[1] || parts[0]).endsWith('%')
                  ? (parseFloat(parts[1] || parts[0]) * r.height) / 100
                  : (parseFloat(parts[1] || parts[0]) * r.height) /
                    e.offsetHeight,
              })
            }
            window.requestAnimationFrame(sample)
          }
          window.requestAnimationFrame(sample)
        })
        await p.locator('[data-slot="expandable-card"]').click()
        await p.getByRole('dialog').waitFor()
        await p.waitForTimeout(700)
        await p.screenshot({
          path: path.join(
            root,
            'real-listing-expanded-' + width + '-' + reducedMotion + '.png'
          ),
        })
        await p.keyboard.press('Escape')
        await p.getByRole('dialog').waitFor({ state: 'detached' })
        await p.waitForTimeout(750)
        const frames = await p.evaluate(() => {
          window.sampling = false
          return window.frames
        })
        assert(frames.length > 0)
        assert(
          frames.every((f) => Math.abs(f.x - 16) < 1 && Math.abs(f.y - 16) < 1),
          'radius remains 16 in actual motion frames'
        )
        if (reducedMotion === 'no-preference')
          assert(
            frames.some((f) => f.returning),
            'return phase sampled'
          )
        await p.close()
        console.log('PASS shared Listing radius ' + width + ' ' + reducedMotion)
      }
  } finally {
    await browser.close()
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
