/* global window, document */
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
fs.writeFileSync(
  path.join(root, 'view-session.js'),
  `export function useMarketplaceSession(){return {seller:{id:window.owner?'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa':'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}}}`
)
aliases['@/components/listings/marketplace-session'] = path.join(
  root,
  'view-session.js'
)
aliases['./marketplace-session'] =
  aliases['@/components/listings/marketplace-session']
fs.writeFileSync(
  path.join(root, 'favorite-mock.js'),
  `export async function favoriteState(){return {favorited:false}};export async function setFavorite(){return {favorited:false}}`
)
aliases['@/lib/favorites-api'] = path.join(root, 'favorite-mock.js')
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `import 'tailwindcss/src/css/preflight.css';import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{PublishedListingCard}from'@/components/listings/published-listing-card';import{ExpandableCard}from'@/components/velora/expandable-card';import{recordMarketplaceView}from'@/lib/record-marketplace-view';
const root=createRoot(document.getElementById('root'));window.requests=[];window.events=new Set();window.owner=false;window.fail=false;window.hold=false;window.overlay=0;
window.fixtureRequest=async(url,method,body)=>{window.requests.push(body);if(window.hold)await new Promise(r=>window.release=r);window.events.add(body.eventId);if(window.fail){window.fail=false;throw Error('Lost acknowledgement')}return {recorded:true}};
const listing={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',title:'Analytics synthetic listing',description:'Test',category:'Electronics',subcategory:'Computers & Tablets',price:1000,currency:'CAD',status:'available',preferredFulfillment:'ON_CAMPUS',pickupArea:'Campus',photoUrls:[],seller:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',displayName:'Synthetic'},createdAt:new Date().toISOString(),publishedAt:new Date().toISOString()};
window.paint=()=>flushSync(()=>root.render(<div style={{width:240,margin:'30px auto'}}><PublishedListingCard owner={window.owner} listing={listing} onOverlayActiveChange={()=>window.overlay++}/></div>));
window.restore=()=>flushSync(()=>root.render(<ExpandableCard title="Restore" expandedTitle="Restored" openOnMount onIntentionalOpen={()=>recordMarketplaceView(listing.id)}><p>Restored</p></ExpandableCard>));window.paint();`
)
;(async () => {
  await build(aliases)
  fs.writeFileSync(
    path.join(root, 'index.html'),
    fs
      .readFileSync(path.join(root, 'index.html'), 'utf8')
      .replace(
        '<script src=',
        '<script>window.process={env:{}}</script><script src='
      )
  )
  for (const f of ['entry.tsx', 'api.ts']) fs.unlinkSync(path.join(root, f))
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
      })
      await p.route(/^https?:/, (r) => r.abort())
      await p.goto(
        'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      const trigger = p.locator('[data-slot="expandable-card"]')
      await trigger.waitFor()
      assert.equal(await p.evaluate(() => window.requests.length), 0)
      await p.evaluate(() => {
        window.hold = true
      })
      await trigger.click()
      await p.getByRole('dialog').waitFor()
      assert.equal(
        await p.evaluate(() => window.requests.length),
        1,
        'open does not wait for analytics'
      )
      await p.evaluate(() => {
        window.hold = false
        window.release()
      })
      await p.keyboard.press('Escape')
      await p.getByRole('dialog').waitFor({ state: 'detached' })
      await p.evaluate(() => {
        window.fail = true
      })
      await trigger.focus()
      await p.keyboard.press('Enter')
      await p.getByRole('dialog').waitFor()
      await p.waitForTimeout(80)
      assert.equal(await p.evaluate(() => window.events.size), 2)
      assert.equal(await p.evaluate(() => window.requests.length), 3)
      assert.equal(
        await p.evaluate(
          () => window.requests[1].eventId === window.requests[2].eventId
        ),
        true,
        'retry reuses id'
      )
      await p.evaluate(() => window.paint())
      assert.equal(
        await p.evaluate(() => window.requests.length),
        3,
        'rerender/overlay not views'
      )
      await p.keyboard.press('Escape')
      await p.getByRole('dialog').waitFor({ state: 'detached' })
      await p.setViewportSize({ width: width + 1, height: 900 })
      await p.evaluate(() => window.paint())
      assert.equal(await p.evaluate(() => window.requests.length), 3)
      await p.evaluate(() => {
        window.owner = true
        window.paint()
      })
      await trigger.click()
      await p.getByRole('dialog').waitFor()
      assert.equal(
        await p.evaluate(() => window.requests.length),
        3,
        'owner excluded'
      )
      await p.keyboard.press('Escape')
      await p.getByRole('dialog').waitFor({ state: 'detached' })
      await p.evaluate(() => window.restore())
      await p.getByRole('dialog').waitFor()
      assert.equal(
        await p.evaluate(() => window.requests.length),
        3,
        'openOnMount excluded'
      )
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      )
      console.log(
        'PASS ' +
          width +
          ': immediate click/keyboard opens, deliberate reopen, same-ID retry, no rerender/resize/owner/restoration writes'
      )
      await p.close()
    }
  } finally {
    await b.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
