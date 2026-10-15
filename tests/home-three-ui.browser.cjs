// Real shell, formal Order, Favorites/cards, mobile menu and financial panel; offline fixtures.
/* global window, document, getComputedStyle, innerWidth */
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const source = fs.readFileSync(
  path.join(__dirname, 'order-flow-ui.browser.cjs'),
  'utf8'
)
new Function(
  'require',
  source.slice(0, source.indexOf('// Stage-based qualification entry point'))
)(require)
let entry = fs.readFileSync(path.join(root, 'entry.tsx'), 'utf8')
entry = entry.replace(
  'const root=createRoot',
  `import '@/styles/desktop-app-tokens.css';import {Sidebar,SidebarBody} from '@/components/velora/animated-sidebar';import {AnimatedSidebarDemo} from '@/components/home/animated-sidebar-demo';import {Favorites} from '@/components/listings/favorites';import shell from '@/components/home/animated-sidebar-demo.module.css';
const DetailShell=({children})=><div className={shell.page}>{window.innerWidth<1024?<div className={shell.mobileShell}><main data-main className={shell.mobileMain}>{children}</main></div>:<Sidebar className={shell.frame}><SidebarBody className={shell.navigation} logo="C" title="Campus">Navigation</SidebarBody><main data-main className={shell.main}>{children}</main></Sidebar>}</div>;
const root=createRoot`
)
entry = entry
  .replace(
    '<LazyMotion features={domAnimation}><FormalOrderDetail',
    '<LazyMotion features={domAnimation}><DetailShell><FormalOrderDetail'
  )
  .replace('/></LazyMotion>))};', '/></DetailShell></LazyMotion>))};')
entry += `\nwindow.showFavorites=()=>flushSync(()=>root.render(<LazyMotion features={domAnimation}><DetailShell><Favorites key={String(window.empty)}/></DetailShell></LazyMotion>));window.showHome=()=>flushSync(()=>root.render(<LazyMotion features={domAnimation}><AnimatedSidebarDemo/></LazyMotion>));window.favoriteCalls=[];window.empty=false;`
fs.writeFileSync(path.join(root, 'entry.tsx'), entry)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;font-family:Arial}html{scrollbar-gutter:stable}</style><div id="root"></div><script src="bundle.js"></script>'
)
const aliases = require('./browser-fixture-mocks.cjs')(root)
const mocks = {
  '@ui/link/link':
    'export const Link=({children,...props})=><a {...props}>{children}</a>',
  'next/dynamic': 'export default function dynamic(){return ()=>null}',
  'next/router':
    'const router={query:{},pathname:"/home",events:{on(){},off(){}},push:async()=>{throw Error("Unexpected route write")}};export function useRouter(){return router}',
  '@/components/navigation/desktop-route-transition':
    'export function useDesktopRouteTransition(){return ()=>{}}export function usePendingDestination(){return null}export function usePageSlide(){return ()=>{}}',
  './order-visual-context':
    'export function useOrderVisual(){return {selection:null,enabled:false,showList(){}}}',
  './profile-logout':
    'export function useProfileLogout(){return ()=>{throw Error("Unexpected logout")}}',
  './profile-overview':
    'import {FinancialSettings} from "@/components/home/financial-settings";export function ProfileOverview({settings}){return <section><h2>{settings?"Settings":"Overview"}</h2><FinancialSettings settings={!!settings}/></section>}',
  './profile-analytics':
    'export function ProfileAnalytics(){return <section aria-label="Analytics fixture">Analytics content</section>}',
  '@/components/listings/marketplace-session':
    'export function useMarketplaceSession(){return {seller:{id:"buyer"}}}',
  '@/components/listings/use-listing-offer-context':
    'export function useListingOfferContext(){return {loading:false,context:{available:true,orderId:null,hasHistory:false}}}',
  '@/lib/favorites-api': `const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="purple"/></svg>');export async function getFavoriteListings(params){window.favoriteCalls.push(params);return window.empty?[]:Array.from({length:10},(_,i)=>({id:'fixture-'+i,title:'Fixture listing '+i,price:8000,currency:'CAD',publishedAt:'2026-10-01T00:00:00Z',status:'available',photoUrls:[image],seller:{id:'seller',displayName:'Seller'},category:'Electronics',condition:'good',pickupArea:'Weldon',description:'Fixture'}))}export async function favoriteState(){return {favorited:true}}export async function setFavorite(){throw Error('Unexpected favorite write')}`,
}
for (const [name, source] of Object.entries(mocks)) {
  const file = path.join(
    root,
    'three-ui-' + Object.keys(mocks).indexOf(name) + '.jsx'
  )
  fs.writeFileSync(file, source)
  aliases[name] = file
}
async function run() {
  await build(aliases)
  for (const n of ['entry.tsx', 'api.ts']) fs.unlinkSync(path.join(root, n))
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const b = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const width of [390, 430, 820, 1280, 1536]) {
      const p = await b.newPage({
          viewport: { width, height: 900 },
          reducedMotion: 'reduce',
        }),
        errors = []
      p.on('pageerror', (e) => errors.push(e.message))
      await p.route(/^https?:/, (r) => r.abort())
      await p.addInitScript(() => (window.process = { env: {} }))
      await p.goto(
        'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      await p.evaluate(() =>
        window.setScenario({
          viewer: 'buyer',
          mode: 'campus',
          phase: 'cancelled',
        })
      )
      await p
        .getByRole('region', { name: 'Order Detail', exact: true })
        .waitFor()
      await p.waitForTimeout(100)
      const order = p.getByRole('region', { name: 'Order Detail', exact: true })
      const after = await order.evaluate((e) => {
        const m = document.querySelector('[data-main]'),
          r = e.getBoundingClientRect(),
          s = getComputedStyle(m)
        return {
          width: r.width,
          available:
            m.clientWidth -
            parseFloat(s.paddingLeft) -
            parseFloat(s.paddingRight),
          font: getComputedStyle(e).fontSize,
          gap: getComputedStyle(e).gap,
          padding: getComputedStyle(e).padding,
        }
      })
      await order.evaluate((e) => (e.style.maxWidth = '1120px'))
      const before = await order.evaluate(
        (e) => e.getBoundingClientRect().width
      )
      await order.evaluate((e) => e.style.removeProperty('max-width'))
      assert(Math.abs(after.width - after.available) < 1)
      if (width < 1024) assert.equal(after.width, before)
      console.log(
        JSON.stringify({
          width,
          orderBefore: before,
          orderAfter: after.width,
          available: after.available,
        })
      )
      await p.evaluate(() => window.showFavorites())
      const favorites = p.getByRole('region', {
        name: 'Favorites',
        exact: true,
      })
      await favorites.locator('article').nth(9).waitFor()
      assert.equal(
        await favorites.getByRole('button', { name: /Newest|Filter/ }).count(),
        0
      )
      const grid = favorites.locator(':scope > div').last()
      const css = await grid.evaluate((e) => ({
        columns: getComputedStyle(e).gridTemplateColumns.split(' ').length,
        gap: getComputedStyle(e).gap,
        top:
          e.getBoundingClientRect().top -
          e.parentElement.getBoundingClientRect().top,
      }))
      assert.equal(css.columns, width >= 1024 ? 5 : width >= 640 ? 3 : 2)
      assert.equal(css.gap, width >= 1024 ? '32px 24px' : '28px 16px')
      assert.equal(css.top, 0)
      assert.equal(await favorites.locator('[data-market-controls]').count(), 0)
      assert((await favorites.locator(':scope > div').count()) === 1)
      assert(
        await p.evaluate(() =>
          window.favoriteCalls.every(
            (p) => p.sort === 'newest' && !p.category && !p.condition
          )
        )
      )
      await p.evaluate(() => window.showHome())
      await p.waitForTimeout(150)
      assert.deepEqual(errors, [])
      if (width < 1024) {
        const menu = p.locator(
          '[data-home-mobile-header] [data-smooth-dropdown]'
        )
        await menu
          .getByRole('button', { name: 'Open Home navigation', exact: true })
          .click()
        await p
          .getByRole('button', { name: 'Analytics', exact: true })
          .waitFor()
        assert.equal(
          await menu
            .getByRole('button', { name: 'Payment', exact: true })
            .count(),
          0
        )
        await menu
          .getByRole('button', { name: 'Analytics', exact: true })
          .click()
        await p.getByRole('region', { name: 'Analytics fixture' }).waitFor()
        await menu
          .getByRole('button', { name: 'Open Home navigation', exact: true })
          .click()
        await menu
          .getByRole('button', { name: 'Overview', exact: true })
          .click()
        await p
          .getByRole('heading', { name: 'Overview', exact: true })
          .waitFor()
      } else {
        await p
          .getByRole('region', { name: 'Payments & payouts', exact: true })
          .waitFor()
      }
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      )
      assert.deepEqual(errors, [])
      console.log(
        'PASS ' +
          width +
          ': Order fills parent; Favorites ' +
          css.columns +
          ' columns/no controls; mobile menu or desktop financial panel intact; no overflow.'
      )
      await p.close()
    }
  } finally {
    await b.close()
  }
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
