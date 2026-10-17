/* global window, document */
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
const mock = (key, name, src) => {
  const f = path.join(root, name + '.js')
  fs.writeFileSync(f, src)
  aliases[key] = f
}
mock(
  '@/components/home/order-visual-context',
  'mp-visual',
  `export function useOrderVisual(){return {enabled:false,state:{requests:[],events:[]}}}`
)
mock(
  '@/hooks/use-formal-order-requests',
  'mp-requests',
  `export function useFormalOrderRequests(){return {history:{sellerId:'seller',buyerId:'buyer',requests:[],events:[]},pendingAcceptanceIds:[],error:'',loading:false}}`
)
mock(
  '@/hooks/use-formal-offers',
  'mp-offers',
  `export function useFormalOffers(){return {history:{offers:window.offers,agreements:[]},error:'',loading:false,blocked:false,isBlocked:()=>false,refresh:async()=>{},markSucceeded(){},markAcceptSucceeded(){}}}`
)
aliases['./order-visual-context'] =
  aliases['@/components/home/order-visual-context']
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import '@/components/animata/button/shining-button.css';import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {LazyMotion,domAnimation} from 'framer-motion';import {MessagesChat} from '@/components/home/messages-chat';import {ConversationList} from '@/components/client-card';import {MessagesListingOverlay} from '@/components/home/messages-listing-overlay';
const root=createRoot(document.getElementById('root'));window.actions=[];window.sent=[];window.process={env:{NEXT_PUBLIC_MESSAGES_ENV:'staging',NEXT_PUBLIC_SUPABASE_URL:'https://pcaqxezdfxofysghssyo.supabase.co'}};
window.fixtureRequest=async()=>{throw Error('Controlled server rejection')};
window.show=(v)=>{const provenance=v.shop?{channel:'shop',shopName:v.long?'VeryLongShopNameWithoutSpacesABCDEFGHIJKLMN':'Vintage Loop'}:undefined;const listing={id:'listing',liveId:'listing',title:'New Balance 550',price:8000,currency:'CAD',category:'Electronics',photoUrls:[],availability:v.hidden?'unavailable':'available',provenance};
const terms={fulfillment:'on_campus',meetupLocation:'Library',scheduledAt:new Date(Date.now()+86400000).toISOString(),itemAmountCents:7000,currency:'CAD',note:''};window.offers=v.offer?[{id:'active',senderId:v.own?'buyer':'seller',recipientId:v.own?'seller':'buyer',buyerId:'buyer',sellerId:'seller',conversationId:'fixture',listingId:'listing',status:v.historical?'Expired':'Active',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),terms,canAccept:true,canWithdraw:true,changedFields:[]}]:[];
const conversation={id:'fixture',person:{name:'Other participant'},listing,lastMessage:'Hello',unreadCount:0};
flushSync(()=>root.render(<LazyMotion features={domAnimation}><div style={{width:'100%',minWidth:0,height:750}}>{v.surface==='list'?<ConversationList conversations={[conversation]} selectedId='' onSelect={()=>{}}/>:v.surface==='preview'?<MessagesListingOverlay listing={listing} destination='buying' onClose={()=>{}}/>:<MessagesChat key={JSON.stringify(v)} name='Other participant' destination='buying' listing={listing} conversationId='fixture' currentUserId='buyer' otherParticipantId='seller' messages={[]} onSend={async text=>{window.sent.push(text)}}/>}</div></LazyMotion>));};
`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:12px;background:#160f1d;color:white;font-family:Arial}html{scrollbar-gutter:stable}</style><script>window.process={env:{NEXT_PUBLIC_MESSAGES_ENV:"staging",NEXT_PUBLIC_SUPABASE_URL:"https://pcaqxezdfxofysghssyo.supabase.co"}}</script><div id="root"></div><script src="bundle.js"></script>'
)
;(async () => {
  await build(aliases)
  fs.unlinkSync(path.join(root, 'entry.tsx'))
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const b = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const width of [390, 430, 820, 1280, 1536])
      for (const reduced of ['reduce', 'no-preference']) {
        const p = await b.newPage({
          viewport: { width, height: 900 },
          reducedMotion: reduced,
        })
        p.setDefaultTimeout(5000)
        const errors = []
        p.on('pageerror', (e) => errors.push(e.message))
        await p.route(/^https?:/, (r) => r.abort())
        await p.goto(
          'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
        )
        await p.waitForFunction(() => typeof window.show === 'function')
        for (const surface of ['list', 'chat', 'preview'])
          for (const shop of [false, true])
            for (const long of [false, true]) {
              await p.evaluate((v) => window.show(v), {
                surface,
                shop,
                long,
                hidden: true,
              })
              if (shop)
                await p
                  .getByText(
                    (long
                      ? 'VeryLongShopNameWithoutSpacesABCDEFGHIJKLMN'
                      : 'Vintage Loop') + ' \u00b7 Shop',
                    { exact: true }
                  )
                  .waitFor()
              else assert.equal(await p.getByText(/\u00b7 Shop/).count(), 0)
              assert(
                await p.evaluate(
                  () =>
                    document.documentElement.scrollWidth <= window.innerWidth
                ),
                'No horizontal overflow'
              )
              assert.equal(await p.getByText('PRO', { exact: true }).count(), 0)
              if (surface === 'chat') {
                await p
                  .getByRole('textbox', { name: 'Message', exact: true })
                  .fill('Still chatting')
                await p
                  .getByRole('button', { name: 'Send message', exact: true })
                  .click()
                assert(
                  (await p.evaluate(() => window.sent)).includes(
                    'Still chatting'
                  )
                )
              }
            }
        for (const own of [false, true]) {
          await p.evaluate((v) => window.show(v), {
            surface: 'chat',
            shop: true,
            hidden: true,
            offer: true,
            own,
          })
          await p
            .getByRole('button', { name: 'Add to conversation', exact: true })
            .click()
          await p
            .getByRole('button', {
              name: own ? 'Revise Offer' : 'Counter Offer',
              exact: true,
            })
            .click()
          await p.getByRole('dialog').last().waitFor()
        }
        await p.evaluate((v) => window.show(v), {
          surface: 'chat',
          shop: true,
          hidden: true,
          offer: false,
        })
        await p
          .getByRole('button', { name: 'Add to conversation', exact: true })
          .click()
        assert.equal(
          await p
            .getByRole('button', { name: 'Make Offer', exact: true })
            .count(),
          0
        )
        await p.evaluate((v) => window.show(v), {
          surface: 'chat',
          shop: true,
          hidden: false,
        })
        await p
          .getByRole('button', { name: 'Add to conversation', exact: true })
          .click()
        await p.getByRole('button', { name: 'Make Offer', exact: true }).click()
        await p.getByRole('dialog').last().waitFor()
        assert.deepEqual(errors, [])
        await p.close()
        console.log(
          'PASS',
          width,
          reduced,
          'list/header/preview, Resale unchanged, frozen Shop/long name, hidden Listing text send, Counter/Revise and new Offer boundaries'
        )
      }
  } finally {
    await b.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
