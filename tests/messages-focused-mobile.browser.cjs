// Actual Messages, Chat, timeline, composer and portaled navigation; offline transport only.
/* global window, document, getComputedStyle */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
const mocks = {
  '@/components/listings/marketplace-session': `export function useMarketplaceSession(){return window.session}`,
  '@/components/loader/loader': `import {atom} from 'jotai';export const loaderFinishedAtom=atom(true)`,
  '@/components/navigation/desktop-route-transition': `export function usePendingDestination(){return null}export function usePageSlide(){return ()=>{throw Error('Unexpected route navigation')}}`,
  '@/components/home/order-visual-context': `const value={enabled:false,state:{requests:[],events:[]}};export function useOrderVisual(){return value}`,
  '@/hooks/use-formal-order-requests': `export function useFormalOrderRequests(){return {history:window.requestHistory,loading:false,error:'',pendingAcceptanceIds:[],refresh:async()=>{},isAcceptanceBlocked:()=>false}}`,
  '@/hooks/use-formal-offers': `export function useFormalOffers(){return {history:window.offerHistory,loading:false,error:'',blocked:false,refresh:async()=>{},isBlocked:()=>false}}`,
  '@/lib/messages-realtime': `export function connectMessagesRealtime(){window.channels++;return ()=>window.channels--}`,
  '@/lib/messages-api': `
export async function listConversations(role){return {conversations:[window.conversation(role)],nextCursor:null}}
export async function getConversation(){return window.conversation(window.destination)}
export async function getMessageHistory(){return {messages:window.messages,nextBefore:null}}
export async function readConversation(id,sequence){return {lastReadSequence:sequence}}
export async function sendText(id,content){window.sends++;await new Promise(r=>setTimeout(r,100));if(window.failSend){window.failSend=false;throw Error('Controlled send failure')}const m={id:'sent-'+window.sends,conversationId:id,type:'TEXT',content,senderId:window.session.seller.id,sequence:window.messages.length+1,createdAt:new Date().toISOString(),canWithdraw:false};window.messages.push(m);return m}
export async function withdrawMessage(){throw Error('Unexpected withdrawal')}
`,
}
for (const [name, source] of Object.entries(mocks)) {
  const file = path.join(
    root,
    'focused-' + Object.keys(mocks).indexOf(name) + '.js'
  )
  fs.writeFileSync(file, source)
  aliases[name] = file
}
// MessagesChat imports its Home context through the relative component path.
aliases['./order-visual-context'] =
  aliases['@/components/home/order-visual-context']
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {LazyMotion,domAnimation} from 'framer-motion';
import {Messages} from '@/components/home/messages';import {MarketMobileNavigation} from '@/components/listings/market-mobile-nav';import shell from '@/components/home/animated-sidebar-demo.module.css';import '@/components/animata/button/shining-button.css';
const root=createRoot(document.getElementById('root'));window.channels=0;window.sends=0;
window.fixtureRequest=async()=>{throw Error('Unexpected API transport')};
window.show=(destination)=>{window.sends=0;window.failSend=false;window.destination=destination;const user=destination==='selling'?'seller':'buyer';window.session={seller:{id:user,displayName:'Current user'},loading:false,error:'',refresh:async()=>{}};
window.conversation=role=>({id:'conversation-'+role,role,person:{id:role==='selling'?'buyer':'seller',name:'Other participant'},listing:{id:'listing',liveId:'listing',title:'Frozen item',price:8000,currency:'CAD',category:'Electronics',photoUrls:[],availability:'available'},lastMessage:'new message',createdAt:'2026-10-01T12:00:00Z',lastMessageAt:'2026-10-01T12:00:02Z',activityAt:'2026-10-01T12:00:02Z',lastMessageSequence:2,lastReadSequence:2,unreadCount:0,imageSendingEnabled:true});
window.messages=[{id:'incoming',type:'TEXT',content:'im seller',senderId:destination==='selling'?'buyer':'seller',sequence:1,createdAt:'2026-10-01T12:00:00Z',canWithdraw:false},{id:'outgoing',type:'TEXT',content:'new message',senderId:user,sequence:2,createdAt:'2026-10-01T12:00:02Z',canWithdraw:false}];
window.requestHistory={requests:[],events:[],sellerId:'seller',buyerId:'buyer'};window.offerHistory={offers:[],agreements:[]};
const mobile=window.innerWidth<1024;flushSync(()=>root.render(<LazyMotion features={domAnimation}><section className={shell.page}><div className={mobile?shell.mobileShell:shell.frame}><header className={mobile?shell.mobileHeader:shell.header}><h1>{destination==='selling'?'Selling':'Buying'}</h1></header><main className={mobile?shell.mobileMain:shell.main}><Messages key={destination} destination={destination} mobile={mobile}/></main></div><MarketMobileNavigation/></section></LazyMotion>));};
`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  fs
    .readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace('padding:12px', 'padding:0')
)
async function run() {
  await build(aliases)
  for (const name of ['entry.tsx', 'api.ts'])
    fs.unlinkSync(path.join(root, name))
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const width of [390, 430, 1280, 1536]) {
      const mobile = width < 1024
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        reducedMotion: 'reduce',
      })
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.route(/^https?:/, (route) => route.abort())
      await page.addInitScript(() => {
        window.process = {
          env: {
            NEXT_PUBLIC_MESSAGES_ENV: 'staging',
            NEXT_PUBLIC_SUPABASE_URL:
              'https://pcaqxezdfxofysghssyo.supabase.co',
          },
        }
      })
      await page.goto(
        'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      for (const destination of ['buying', 'selling']) {
        await page.evaluate((v) => window.show(v), destination)
        const list = page
          .locator('[data-conversation-list]')
          .filter({ visible: true })
        if (mobile) await list.waitFor()
        const capsule = page.getByRole('navigation', {
          name: 'Home and Market navigation',
        })
        const surface = page.locator('[data-mobile-messages]')
        if (mobile) {
          assert(await capsule.isVisible())
          const initial = await surface.evaluate((e) => ({
            width: e.getBoundingClientRect().width,
            border: getComputedStyle(e).borderTopWidth,
            radius: getComputedStyle(e).borderRadius,
            bottom: getComputedStyle(e.closest('main')).paddingBottom,
          }))
          assert.equal(initial.border, '1px')
          assert.equal(initial.radius, '16px')
          assert.equal(initial.bottom, '80px')
          await list.locator('[data-conversation-id]').click()
          await page.waitForFunction(() =>
            document.querySelector('[data-mobile-message-detail="true"]')
          )
          await page.waitForTimeout(100)
          assert(!(await capsule.isVisible()))
          const detail = page.locator('[data-mobile-message-screen="detail"]')
          const chat = detail.getByRole('region', { name: 'Chat panel' })
          await chat.getByPlaceholder('Message...').waitFor()
          const geometry = await surface.evaluate((e) => {
            const main = e.closest('main'),
              r = e.getBoundingClientRect(),
              panel = e.querySelector('[aria-label="Chat panel"]'),
              body = panel.querySelector('[data-message-history]'),
              input = panel.querySelector('textarea'),
              send = panel.querySelector('[data-chat-send]'),
              add = panel.querySelector('[aria-label="Add to conversation"]')
            return {
              width: r.width,
              border: getComputedStyle(e).borderTopWidth,
              radius: getComputedStyle(e).borderRadius,
              background: getComputedStyle(e).backgroundColor,
              bottom: getComputedStyle(main).paddingBottom,
              positions: [input, send, add].map((n) => {
                const r = n.getBoundingClientRect()
                return { x: r.x, y: r.y, width: r.width, height: r.height }
              }),
              mainLeft:
                main.getBoundingClientRect().left +
                parseFloat(getComputedStyle(main).paddingLeft),
              timelineLeft: body.getBoundingClientRect().left,
              payload: getComputedStyle(
                panel.querySelector('[class*="messagePayload"]')
              ).maxWidth,
            }
          })
          assert.equal(geometry.width, initial.width)
          assert.equal(geometry.border, '0px')
          assert.equal(geometry.radius, '0px')
          assert.equal(geometry.background, 'rgba(0, 0, 0, 0)')
          assert.equal(geometry.bottom, '12px')
          assert.equal(geometry.timelineLeft, geometry.mainLeft)
          assert.equal(geometry.payload, '82%')
          const [input, send, add] = geometry.positions
          assert.equal(input.y, send.y)
          assert.equal(send.y, add.y)
          assert.equal(send.height, add.height)
          assert(
            input.x + input.width <= send.x && send.x + send.width <= add.x
          )
          assert(input.width > send.width && add.width === 40)
          assert.equal(input.x, geometry.timelineLeft + 4)
          const original = await chat.evaluate((e) => {
            const input = e.querySelector('textarea')
            input.style.marginLeft = '0px'
            input.style.width = '100%'
            const nodes = [
              input,
              e.querySelector('[data-chat-send]'),
              e.querySelector('[aria-label="Add to conversation"]'),
              ...e.querySelectorAll('[class*="messagePayload"]'),
            ]
            const geometry = nodes.map((n) => {
              const r = n.getBoundingClientRect()
              return { x: r.x, y: r.y, width: r.width, height: r.height }
            })
            input.style.removeProperty('margin-left')
            input.style.removeProperty('width')
            return geometry
          })
          assert.equal(input.x - original[0].x, 4)
          assert.equal(original[0].width - input.width, 4)
          assert.deepEqual(send, original[1])
          assert.deepEqual(add, original[2])
          const ordinary = await chat
            .locator('[class*="messagePayload"]')
            .evaluateAll((nodes) =>
              nodes.map((n) => {
                const r = n.getBoundingClientRect()
                return { x: r.x, y: r.y, width: r.width, height: r.height }
              })
            )
          assert.deepEqual(ordinary, original.slice(3))
          assert(add.y + add.height <= 888)
          assert((await chat.textContent()).includes('Other participant'))
          assert(
            await chat
              .getByRole('button', { name: 'View listing', exact: true })
              .isVisible()
          )
          await chat
            .getByRole('button', { name: 'Add to conversation' })
            .click()
          assert(
            await chat
              .getByRole('button', { name: 'Attachment', exact: true })
              .isVisible()
          )
          await page.keyboard.press('Escape')
          const inputControl = chat.getByPlaceholder('Message...')
          const sendControl = chat.locator('[data-chat-send]')
          assert(await sendControl.isDisabled())
          await inputControl.fill('Offline composer test')
          await inputControl.press('Enter')
          await sendControl.evaluate((e) => e.click())
          await page.waitForFunction(() => window.sends === 1)
          await chat
            .getByText('Offline composer test', { exact: true })
            .waitFor()
          assert.equal(await page.evaluate(() => window.sends), 1)
          await page.waitForFunction(
            () =>
              document.querySelector('[data-chat-send]').dataset.state ===
              'idle'
          )
          await page.evaluate(() => {
            window.failSend = true
          })
          await inputControl.fill('Retry composer test')
          await sendControl.click()
          await chat
            .getByRole('alert')
            .filter({ hasText: 'Controlled send failure' })
            .waitFor()
          await page.waitForFunction(
            () =>
              document.querySelector('[data-chat-send]').dataset.state ===
              'idle'
          )
          assert(await sendControl.isEnabled())
          await sendControl.click()
          await chat.getByText('Retry composer test', { exact: true }).waitFor()
          assert.equal(await page.evaluate(() => window.sends), 3)
          assert.equal(await page.evaluate(() => window.channels), 1)
          await page.screenshot({
            path: path.join(root, `focused-${width}-${destination}.png`),
          })
          await detail
            .getByRole('button', { name: 'Go Back', exact: true })
            .click()
          await surface.waitFor({ state: 'visible' })
          await page.waitForTimeout(100)
          assert(await capsule.isVisible())
          const restored = await surface.evaluate((e) => ({
            width: e.getBoundingClientRect().width,
            border: getComputedStyle(e).borderTopWidth,
            radius: getComputedStyle(e).borderRadius,
            bottom: getComputedStyle(e.closest('main')).paddingBottom,
          }))
          assert.deepEqual(restored, initial)
        } else {
          const chat = page.getByRole('region', { name: 'Chat panel' })
          await chat.getByPlaceholder('Message...').waitFor()
          assert.equal(
            await chat.evaluate((e) => getComputedStyle(e).borderLeftWidth),
            '1px'
          )
          assert.equal(
            await chat
              .locator('[class*="composer"]')
              .evaluate((e) => getComputedStyle(e).display),
            'flex'
          )
          assert.equal(
            await chat
              .locator('[class*="messagePayload"]')
              .first()
              .evaluate((e) => getComputedStyle(e).maxWidth),
            '65%'
          )
          assert.equal(await surface.count(), 0)
        }
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        )
      }
      assert.deepEqual(errors, [])
      console.log(
        'PASS ' +
          width +
          ': Buying/Selling focused detail, list restore, capsule/shell/gutters/composer; desktop contract preserved; offline only.'
      )
      await page.close()
    }
  } finally {
    await browser.close()
  }
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
