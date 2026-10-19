const { testPictureDataUrl } = require('../scripts/lib/test-pictures.cjs')
// Actual expanded Listing, detail page, offer/contact hooks; offline HTTP only.
/* global window, document, Event */
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
const mocks = {
  '@/components/listings/marketplace-session':
    'export function useMarketplaceSession(){return {seller:{id:window.viewer||"buyer"}}}',
  'next/router':
    'export function useRouter(){return {query:{},pathname:"/listings",push:async url=>window.routes.push(url)}}',
  '@/lib/messages-api':
    'export async function findConversation(id,contact){window.lastContactIntent=contact;window.lookups++;return {id:"existing-thread",role:"buying"}}',
  '@/lib/favorites-api':
    'export async function favoriteState(){return {favorited:false}}export async function setFavorite(){throw Error("Unexpected favorite mutation")}',
  '@/lib/listings-api':
    'export async function getListing(){return window.liveListing}export async function marketplaceRequest(path,method){if(method!=="GET")throw Error("Unexpected mutation");return window.context}',
  'next/head': 'export default function Head(){return null}',
  '@/components/container/container':
    'export function Container({children}){return <div>{children}</div>}',
  '@/components/product/product-image':
    'export function ProductImage({src,alt}){return <img src={src} alt={alt} style={{width:100}}/>}',
  '@ui/button/button':
    'export function Button({children,onClick,disabled}){return <button disabled={disabled} onClick={onClick}>{children}</button>}',
  '@ui/link/link':
    'export function Link({children,...props}){return <a {...props}>{children}</a>}',
}
for (const [name, source] of Object.entries(mocks)) {
  const file = path.join(
    root,
    'listing-action-' + Object.keys(mocks).indexOf(name) + '.tsx'
  )
  fs.writeFileSync(file, source)
  aliases[name] = file
}
aliases['./marketplace-session'] =
  aliases['@/components/listings/marketplace-session']
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {LazyMotion,domAnimation} from 'framer-motion';import {PublishedListingCard} from '@/components/listings/published-listing-card';import ListingPage from '${path
    .resolve('pages/listings/[id].tsx')
    .replaceAll(
      '\\',
      '/'
    )}';import '@/components/animata/button/shining-button.css';
const root=createRoot(document.getElementById('root'));window.routes=[];window.lookups=0;
window.show=v=>{window.routes=[];window.lookups=0;window.viewer=v.owner?'seller':'buyer';const photo=${JSON.stringify(
    testPictureDataUrl('monitor')
  )};window.liveListing={id:'listing',seller:{id:'seller',displayName:'Seller'},title:'Fixture listing',price:8000,currency:'CAD',photoUrls:[photo],status:v.status,description:'Frozen description',category:'Electronics',subcategory:'Other',condition:'good',pickupArea:'Weldon'};window.context={available:v.status==='available',orderId:v.order?'active-order':null,activeOfferId:null,hasHistory:!!v.history};flushSync(()=>root.render(<LazyMotion features={domAnimation}><div key={JSON.stringify(v)}>{v.page?<ListingPage listing={window.liveListing}/>:<PublishedListingCard listing={window.liveListing}/>}</div></LazyMotion>));};
`
)
async function run() {
  await build(aliases)
  for (const file of new Set(Object.values(aliases))) {
    if (
      path.dirname(file) === root &&
      path.basename(file).startsWith('listing-action-')
    )
      fs.unlinkSync(file)
  }
  for (const n of ['entry.tsx', 'api.ts']) fs.unlinkSync(path.join(root, n))
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const width of [390, 430, 1280, 1536]) {
      const p = await browser.newPage({
        viewport: { width, height: 900 },
        reducedMotion: 'reduce',
      })
      const errors = []
      p.on('pageerror', (e) => errors.push(e.message))
      await p.route(/^https?:/, (r) => r.abort())
      await p.addInitScript(
        () =>
          (window.process = {
            env: {
              NEXT_PUBLIC_MESSAGES_ENV: 'staging',
              NEXT_PUBLIC_SUPABASE_URL:
                'https://pcaqxezdfxofysghssyo.supabase.co',
            },
          })
      )
      await p.goto(
        'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      for (const page of [false, true])
        for (const v of [
          { status: 'available' },
          { status: 'pending', order: true },
          { status: 'reserved' },
          { status: 'sold', history: true },
          { status: 'available', history: true },
          { status: 'pending', history: true },
        ]) {
          await p.evaluate((v) => window.show(v), { ...v, page })
          if (!page) {
            await p.locator('[data-slot="expandable-card"]').click()
            await p.getByRole('dialog').waitFor()
          }
          await p.waitForTimeout(100)
          const scope = page ? p.locator('main') : p.getByRole('dialog')
          const message = scope.getByRole('button', {
              name: 'Message Seller',
              exact: true,
            }),
            offer = scope.getByRole('button', { name: /^Make (New )?Offer$/ })
          assert(await message.isEnabled())
          assert(await offer.isVisible())
          const controls = await scope.evaluate((e) => {
            const r = e.getBoundingClientRect()
            return [...e.querySelectorAll('button')].every((b) => {
              const br = b.getBoundingClientRect()
              return br.left >= r.left && br.right <= r.right
            })
          })
          assert(controls, 'All Listing actions must fit inside their surface')
          assert.equal(await offer.isDisabled(), v.status !== 'available')
          const reason =
            v.status === 'sold'
              ? 'This listing has been sold.'
              : ['pending', 'reserved'].includes(v.status)
              ? 'An order is already in progress for this listing.'
              : null
          if (reason) {
            const text = scope.getByText(reason, { exact: true })
            assert(await text.isVisible())
            const br = await offer.boundingBox(),
              tr = await text.boundingBox()
            assert(tr.y >= br.y + br.height)
            await offer.evaluate((e) => e.click())
            assert.equal(await p.evaluate(() => window.lookups), 0)
          } else {
            assert.equal(
              await scope
                .getByText(
                  'An order is already in progress for this listing.',
                  { exact: true }
                )
                .count(),
              0
            )
          }
          await message.click()
          assert.equal(await p.evaluate(() => window.lastContactIntent), true)
          await message.click()
          assert.deepEqual(await p.evaluate(() => window.routes), [
            '/home?section=messages&destination=buying&conversation=existing-thread',
            '/home?section=messages&destination=buying&conversation=existing-thread',
          ])
          if (v.status === 'available') {
            await offer.click()
            assert.equal(
              await p.evaluate(() => window.lastContactIntent),
              false
            )
            assert(
              (await p.evaluate(() => window.routes))
                .at(-1)
                .includes('&offer=new&offerIntent=')
            )
            const before = await p.evaluate(() => window.lookups)
            await p.evaluate(() => {
              window.liveListing.status = 'pending'
              window.context.available = false
              window.context.orderId = 'active-order'
            })
            await offer.click()
            assert.equal(await p.evaluate(() => window.lookups), before)
            assert(await offer.isDisabled())
          }
          assert(
            await p.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth
            )
          )
          if (!page)
            await scope
              .getByRole('button', { name: 'Close', exact: true })
              .click()
        }
      await p.evaluate(() => window.show({ status: 'pending', order: true }))
      await p.locator('[data-slot="expandable-card"]').click()
      await p.waitForTimeout(100)
      await p.evaluate(() => {
        window.liveListing.status = 'available'
        window.context.available = true
        window.context.orderId = null
        window.dispatchEvent(new Event('marketplace-listings-changed'))
      })
      const reopened = p.getByRole('button', { name: /^Make (New )?Offer$/ })
      await p.waitForFunction(() =>
        [...document.querySelectorAll('button')].some(
          (e) => e.textContent.includes('Make Offer') && !e.disabled
        )
      )
      assert(await reopened.isEnabled())
      await p.getByRole('button', { name: 'Close', exact: true }).click()
      for (const page of [false, true]) {
        await p.evaluate((v) => window.show(v), {
          status: 'available',
          owner: true,
          page,
        })
        if (!page) await p.locator('[data-slot="expandable-card"]').click()
        assert.equal(
          await p
            .getByRole('button', { name: 'Message Seller', exact: true })
            .count(),
          0
        )
        assert.equal(
          await p
            .getByRole('button', { name: 'Make Offer', exact: true })
            .count(),
          0
        )
        if (!page)
          await p.getByRole('button', { name: 'Close', exact: true }).click()
      }
      assert.deepEqual(errors, [])
      console.log(
        'PASS ' +
          width +
          ': expanded/detail Available/Pending/Reserved/Sold/history/reopen; independent Message Seller, visible disabled reason, stale-click gate, own controls; offline.'
      )
      await p.close()
    }
  } finally {
    await browser.close()
  }
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
