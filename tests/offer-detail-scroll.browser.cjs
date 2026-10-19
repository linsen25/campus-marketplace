const { testPictureDataUrl } = require('../scripts/lib/test-pictures.cjs')
// Real Messages history + OfferCard + native FadingDialog, offline only.
/* global window, document, getComputedStyle, requestAnimationFrame, HTMLDialogElement, innerWidth */
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
fs.writeFileSync(
  path.join(root, 'index.html'),
  fs
    .readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace(
      '<meta charset="utf-8">',
      '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    )
)
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {LazyMotion,domAnimation} from 'framer-motion';import {MessageHistory} from '@/components/home/message-history';import {OfferCard} from '@/components/home/offer-ui';import chat from '@/components/home/messages-chat.module.css';
const root=createRoot(document.getElementById('root'));const image=${JSON.stringify(
    testPictureDataUrl('monitor')
  )};let messages=[],offers=[],view='seller',tall=false;
const render=()=>flushSync(()=>root.render(<LazyMotion features={domAnimation}><section className={chat.panel} style={{height:650,width:'100%'}}><header>Chat header</header><div className={chat.contentViewport}><div className={chat.normalChat}><MessageHistory conversationId="scroll-fixture" currentUserId={view} name="Other" active={true} messages={messages} offers={offers} renderOffer={o=><OfferCard offer={o} listing={{title:'Fixture item',price:8000,photoUrls:[image]}} viewerId={view} participantName="Other" blocked={false} canEdit={true} onEdit={()=>{}} onWithdraw={async()=>{}} onAccept={async()=>{}} onDeny={async()=>{}}/>}/></div></div><footer>Composer</footer></section></LazyMotion>));
window.showScrollCase=v=>{view=v.viewer;tall=v.tall;const base=Date.now()-600000;messages=Array.from({length:24},(_,i)=>({id:'msg'+i,type:'TEXT',content:'Normal chat message '+i,senderId:'buyer',sequence:i+1,createdAt:new Date(base+i*1000).toISOString(),canWithdraw:false}));offers=['A','B'].map((key,i)=>({id:'offer-'+key,protocolVersion:2,conversationId:'scroll-fixture',listingId:'listing',buyerId:'buyer',sellerId:'seller',senderId:'seller',recipientId:'buyer',status:v.status,createdAt:new Date(base+24000+i*1000).toISOString(),updatedAt:new Date(base).toISOString(),terms:{itemAmountCents:8000,currency:'CAD',fulfillment:'on_campus',meetupLocation:'Front entrance',scheduledAt:new Date(base+86400000).toISOString(),note:tall?'Long seller note with ordinary readable words. '.repeat(25):''},changedFields:['Price'],canAccept:true,canWithdraw:false}));render()};window.append=()=>{messages=[...messages,{id:'newest',type:'TEXT',content:'New message after closing Offer',senderId:view,sequence:30,createdAt:new Date().toISOString(),canWithdraw:false}];render()};
`
)
async function run() {
  await build(require('./browser-fixture-mocks.cjs')(root))
  for (const n of ['entry.tsx', 'api.ts']) fs.unlinkSync(path.join(root, n))
  const {
      chromium,
    } = require('./artifacts/browser-tools/node_modules/playwright-core'),
    b = await chromium.launch({
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: true,
    })
  try {
    for (const width of [390, 430, 1280, 1536]) {
      const p = await b.newPage({
          viewport: { width, height: 900 },
          reducedMotion: 'reduce',
          hasTouch: width < 768,
          isMobile: width < 768,
        }),
        errors = []
      p.on('pageerror', (e) => errors.push(e.message))
      await p.route(/^https?:/, (r) => r.abort())
      await p.addInitScript(() => {
        window.process = { env: {} }
        window.initialSamples = []
        const original = HTMLDialogElement.prototype.showModal
        HTMLDialogElement.prototype.showModal = function () {
          original.call(this)
          requestAnimationFrame(() =>
            window.initialSamples.push({
              width: innerWidth,
              top: this.scrollTop,
              focus: document.activeElement === this,
            })
          )
        }
      })
      await p.goto(
        'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      for (const [viewer, status] of [
        ['seller', 'Active'],
        ['buyer', 'Active'],
        ['buyer', 'Replaced'],
      ])
        for (const tall of [false, true]) {
          await p.evaluate((v) => window.showScrollCase(v), {
            viewer,
            status,
            tall,
          })
          const history = p.locator('[data-message-history]')
          await history.waitFor()
          await history.evaluate((e) => (e.scrollTop = e.scrollHeight))
          const before = await history.evaluate((e) => e.scrollTop)
          for (const key of ['A', 'A', 'B']) {
            await p
              .locator('[data-offer-id="offer-' + key + '"] > div button')
              .first()
              .click()
            const d = p.getByRole('dialog')
            await d.waitFor()
            const initial = await d.evaluate((e) => ({
              top: e.scrollTop,
              height: e.clientHeight,
              content: e.scrollHeight,
              focus: document.activeElement === e,
            }))
            if (width < 768) {
              assert.equal(initial.top, 0)
              assert(initial.focus)
              assert(initial.content > initial.height)
              const inner = await d
                .locator('[class*="expanded"]')
                .evaluate((e) => ({
                  overflow: getComputedStyle(e).overflowY,
                  chain: getComputedStyle(e).overscrollBehaviorY,
                  top: e.scrollTop,
                }))
              assert.equal(inner.overflow, 'hidden')
              assert.equal(inner.chain, 'auto')
              assert.equal(inner.top, 0)
              assert.equal(await history.evaluate((e) => e.scrollTop), before)
              const media = d
                .locator('[class*="offer_ui_module_css_media"]')
                .first()
              const touch = await p.context().newCDPSession(p)
              const rect = await media.boundingBox()
              const point = {
                x: Math.round(rect.x + rect.width / 2),
                y: Math.round(rect.y + Math.min(rect.height / 2, 120)),
                gestureSourceType: 'touch',
                preventFling: true,
              }
              const swipe = async (start, end) => {
                await touch.send('Input.dispatchTouchEvent', {
                  type: 'touchStart',
                  touchPoints: [{ x: point.x, y: start }],
                })
                for (let step = 1; step <= 12; step++)
                  await touch.send('Input.dispatchTouchEvent', {
                    type: 'touchMove',
                    touchPoints: [
                      { x: point.x, y: start + ((end - start) * step) / 12 },
                    ],
                  })
                await touch.send('Input.dispatchTouchEvent', {
                  type: 'touchEnd',
                  touchPoints: [],
                })
              }
              await swipe(point.y + 60, Math.max(30, point.y - 140))
              await p.waitForFunction(
                () => document.querySelector('dialog[open]').scrollTop > 0
              )
              await swipe(120, 700)
              await p.waitForFunction(
                () => document.querySelector('dialog[open]').scrollTop === 0
              )
              await touch.detach()
              await media.hover()
              await p.mouse.wheel(0, 4000)
              await p.waitForFunction(() => {
                const e = document.querySelector('dialog[open]')
                return e.scrollTop > 0
              })
              await d.evaluate((e) => (e.scrollTop = e.scrollHeight))
              await d
                .getByRole('button', {
                  name:
                    status === 'Active' && viewer === 'buyer'
                      ? 'Cancel'
                      : 'Close',
                  exact: true,
                })
                .waitFor()
              const bottom = await d.evaluate((e) => e.scrollTop)
              assert(bottom > 0)
              await d.locator('[class*="detailInfo"]').hover()
              await p.mouse.wheel(0, -10000)
              await p.waitForFunction(
                () => document.querySelector('dialog[open]').scrollTop === 0
              )
              await p.keyboard.press('Tab')
              assert(
                await d.evaluate((e) => e.contains(document.activeElement))
              )
              await p.keyboard.press('Escape')
            } else {
              if (!tall) assert.equal(initial.top, 0)
              assert.equal(
                await d.evaluate(() => document.activeElement.tagName),
                'BUTTON'
              )
              assert.equal(
                await d
                  .locator('[class*="expanded"]')
                  .evaluate((e) => getComputedStyle(e).overflowY),
                'auto'
              )
              await p.keyboard.press('Escape')
            }
            await d.waitFor({ state: 'detached' })
            assert.equal(await history.evaluate((e) => e.scrollTop), before)
          }
          await p.evaluate(() => window.append())
          await p
            .getByText('New message after closing Offer', { exact: true })
            .waitFor()
          await p.waitForFunction(() => {
            const e = document.querySelector('[data-message-history]')
            return Math.abs(e.scrollHeight - e.clientHeight - e.scrollTop) < 2
          })
          await history.evaluate((e) => (e.scrollTop -= 100))
          assert(
            await history.evaluate(
              (e) => e.scrollTop < e.scrollHeight - e.clientHeight
            )
          )
        }
      if (width < 768)
        assert(
          (await p.evaluate(() => window.initialSamples)).every(
            (x) => x.top === 0 && x.focus
          )
        )
      assert.deepEqual(errors, [])
      console.log(
        'PASS Offer scroll ' +
          width +
          ': initial native focus/top, short/tall own/incoming/history, wheel down/up, A reopen/B top, focus trap/Escape, chat restoration/new-message scroll; desktop unchanged'
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
