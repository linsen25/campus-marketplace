/* global window, document, getComputedStyle */
// Actual Messages + ClientCard + Chat; offline transport, no hosted data.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const source = fs.readFileSync(
  'tests/messages-focused-mobile.browser.cjs',
  'utf8'
)
const { root, build, aliases } = new Function(
  'require',
  source.slice(0, source.indexOf('async function run()')) +
    ';return {root,build,aliases}'
)(require)
const api = path.join(root, 'layout-messages-api.js')
fs.writeFileSync(
  api,
  `
export async function listConversations(role){return {conversations:window.collections[role],nextCursor:null}}
export async function getConversation(id){return Object.values(window.collections).flat().find(c=>c.id===id)}
export async function getMessageHistory(id){return {messages:window.histories[id],nextBefore:null}}
export async function readConversation(id,sequence){window.reads.push({id,sequence});return {lastReadSequence:sequence}}
export async function sendText(id,content){window.sends++;const m={id:'sent-'+window.sends,type:'TEXT',content,senderId:'owner',sequence:window.histories[id].length+1,createdAt:'2026-10-18T13:00:00Z',canWithdraw:false};window.histories[id].push(m);return m}
export async function withdrawMessage(){throw Error('Unexpected withdrawal')}
`
)
aliases['@/lib/messages-api'] = api
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import '@/components/animata/button/shining-button.css';
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{LazyMotion,domAnimation}from'framer-motion';
import{Messages}from'@/components/home/messages';import{OfferTimelineCard}from'@/components/home/offer-timeline-card';import{AgreementCard}from'@/components/home/agreement-card';
import shell from '@/components/home/animated-sidebar-demo.module.css';import{Sidebar,SidebarBody,SidebarLink}from'@/components/velora/animated-sidebar';
window.actions=[];window.channels=0;window.reads=[];window.sends=0;
window.session={seller:{id:'owner',displayName:'Current user'},loading:false,error:'',refresh:async()=>{}};
window.requestHistory={requests:[],events:[],sellerId:'seller',buyerId:'owner'};window.offerHistory={offers:[],agreements:[]};
window.fixtureRequest=async()=>{throw Error('Unexpected API transport')};
window.histories={};window.collections={};
for(const role of ['buying','selling']) window.collections[role]=Array.from({length:5},(_,i)=>{
 const id=role+'-'+i;window.histories[id]=Array.from({length:36},(_,j)=>({id:id+'-message-'+j,type:'TEXT',content:'Message '+j,senderId:j%2?'owner':'contact',createdAt:new Date(Date.UTC(2026,9,18,12,0,j)).toISOString(),sequence:j+1,canWithdraw:false}));
 return {id,role,person:{id:'contact',name:i<2?'Alex Chen':'Contact '+i},listing:{id:'listing-'+i,liveId:'listing-'+i,title:i===0?'Laptop and study essentials with a very long listing title that must remain readable without pushing the View listing action outside the available chat header width':'Product '+i,price:4500,currency:'CAD',category:'Electronics',photoUrls:[i%2?'/static/testPic/chair.webp':'/static/testPic/laptop.webp'],availability:'available'},lastMessage:'Latest message for '+role+' '+i,createdAt:new Date(Date.UTC(2026,9,18,11,0,10-i)).toISOString(),lastMessageAt:new Date(Date.UTC(2026,9,18,12,0,10-i)).toISOString(),lastMessageSequence:36,lastReadSequence:30,unreadCount:i===1?3:0,time:'12:00',imageSendingEnabled:true}
});
const terms={itemAmountCents:4500,currency:'CAD',note:'',fulfillment:'on_campus',meetupLocation:'Library entrance',scheduledAt:'2026-10-20T12:00:00Z',paymentMode:'uu_pay'};
function App(){const[mode,setMode]=useState('buying');const[badges,setBadges]=useState(false);window.setMode=setMode;window.showBadges=()=>setBadges(true);return <LazyMotion features={domAnimation}>{badges?<section style={{padding:24,display:'grid',gap:24}} data-badge-comparison><OfferTimelineCard id="green" direction="Buyer" own={false} status="Accepted" positive amountCents={4500} fields={[]} onOpen={()=>window.actions.push('offer')}/><OfferTimelineCard id="red" direction="Seller" own status="Accepted" positive={false} amountCents={4500} fields={[]}/><AgreementCard agreement={{id:'agreement',offerId:'offer',createdAt:'2026-10-18',status:'open',listingTitle:'Laptop',buyerId:'owner',sellerId:'seller',terms}} onView={()=>window.actions.push('order')}/></section>:<section className={shell.page}>{window.innerWidth<1024?<div className={shell.mobileShell}><header className={shell.mobileHeader}><h1>{mode==='buying'?'Buying':'Selling'}</h1></header><main className={shell.mobileMain}><Messages destination={mode} mobile/></main></div>:<Sidebar className={shell.frame}><SidebarBody className={shell.navigation} logo={<span>UU</span>}><SidebarLink href="#profile" icon="P" label="Profile"/><SidebarLink href="#messages" icon="M" label="Messages" active/></SidebarBody><main className={shell.main}><header className={shell.header}><h1>{mode==='buying'?'Buying':'Selling'}</h1></header><Messages destination={mode}/></main></Sidebar>}</section>}</LazyMotion>}
createRoot(document.getElementById('root')).render(<App/>);
`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#0b0b0b;color:white;font-family:Arial}</style><script>window.process={env:{}}</script><div id="root"></div><script src="bundle.js"></script>'
)
async function run() {
  await build(aliases)
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  const evidence = []
  try {
    for (const reducedMotion of ['no-preference', 'reduce'])
      for (const width of [390, 430, 820, 1280, 1536]) {
        const p = await browser.newPage({
          viewport: { width, height: 900 },
          reducedMotion,
        })
        const errors = []
        p.on('pageerror', (e) => errors.push(e.message))
        await p.route('**/*', (route) => {
          const u = new URL(route.request().url())
          assert.equal(u.origin, 'http://localhost:4177')
          return route.fulfill({
            path: u.pathname.startsWith('/static/')
              ? path.resolve('public', '.' + u.pathname)
              : path.join(
                  root,
                  u.pathname === '/' ? 'index.html' : 'bundle.js'
                ),
            contentType:
              u.pathname === '/'
                ? 'text/html'
                : u.pathname === '/bundle.js'
                ? 'application/javascript'
                : 'image/webp',
          })
        })
        await p.goto('http://localhost:4177/')
        const mobile = width < 1024
        for (const role of ['buying', 'selling']) {
          await p.evaluate((value) => window.setMode(value), role)
          const chat = p.getByRole('region', {
            name: 'Chat panel',
            exact: true,
          })
          const row = (id) =>
            p.locator(
              '[data-conversation-id="' + role + '-' + id + '"]:visible'
            )
          await row(0).waitFor()
          if (mobile) {
            await row(0).click()
            await p.locator('[data-mobile-message-detail="true"]').waitFor()
            await p.waitForTimeout(360)
          }
          await chat.getByPlaceholder('Message...').waitFor()
          await chat
            .locator('[data-message-history]')
            .getByText('Message 35', { exact: true })
            .waitFor()
          assert(
            await chat
              .locator('header')
              .textContent()
              .then((t) => t.includes('Alex Chen'))
          )
          const firstImage = await chat
            .locator('header img')
            .getAttribute('src')
          assert.equal(firstImage, '/static/testPic/laptop.webp')
          const history = chat.locator('[data-message-history]'),
            draft = chat.getByPlaceholder('Message...')
          if (!mobile) {
            const card = p.locator('[data-client-card]'),
              rail = p.locator('[data-contacts-region]')
            assert.equal(Math.round((await rail.boundingBox()).width), 64)
            assert.equal(
              await rail.locator('[data-conversation-id]').count(),
              5
            )
            assert.equal(
              await rail.locator('img[src^="/static/testPic/"]').count(),
              0,
              'rail keeps user avatar identity'
            )
            const order = await rail
              .locator('[data-conversation-id]')
              .evaluateAll((nodes) =>
                nodes.map((n) => n.dataset.conversationId)
              )
            await row(1).click()
            assert.equal(
              await card.getAttribute('data-contacts-expanded'),
              'false'
            )
            await p.waitForFunction(
              (id) =>
                document.querySelector('[data-message-history]')?.dataset
                  .messageHistory === id,
              role + '-1'
            )
            assert.equal(
              await chat.locator('header img').getAttribute('src'),
              '/static/testPic/chair.webp'
            )
            assert.deepEqual(
              await rail
                .locator('[data-conversation-id]')
                .evaluateAll((nodes) =>
                  nodes.map((n) => n.dataset.conversationId)
                ),
              order
            )
            await row(0).click()
            await p.waitForFunction(
              (id) =>
                document.querySelector('[data-message-history]')?.dataset
                  .messageHistory === id,
              role + '-0'
            )
            await draft.fill('Draft survives ' + role)
            await history.evaluate((node) => {
              node.scrollTop = 180
              node.dispatchEvent(new window.Event('scroll'))
            })
            const saved = await history.evaluate((n) => n.scrollTop),
              node = await history.elementHandle()
            await p
              .getByRole('button', {
                name: 'Expand conversations',
                exact: true,
              })
              .click()
            await p.waitForTimeout(400)
            assert.equal(
              await card.getAttribute('data-contacts-expanded'),
              'true'
            )
            assert.equal(Math.round((await rail.boundingBox()).width), 320)
            assert(
              await node.evaluate(
                (n) => n === document.querySelector('[data-message-history]')
              ),
              'no history remount'
            )
            assert.equal(await draft.inputValue(), 'Draft survives ' + role)
            assert(
              Math.abs((await history.evaluate((n) => n.scrollTop)) - saved) <
                2,
              'scroll position preserved'
            )
            const list = p.locator('[data-conversation-list]:visible')
            assert.equal(
              await list.locator('[data-conversation-id]').count(),
              5
            )
            assert.equal(
              await row(1).locator('img').getAttribute('src'),
              '/static/testPic/chair.webp'
            )
            assert.equal(
              await row(1)
                .getByLabel('3 unread messages', { exact: true })
                .textContent(),
              '3'
            )
            const search = p.getByRole('searchbox', {
              name: 'Search conversations',
            })
            await search.fill('Product 4')
            assert.equal(
              await list.locator('[data-conversation-id]').count(),
              1
            )
            await search.fill('')
            await row(1).click()
            assert.equal(
              await card.getAttribute('data-contacts-expanded'),
              'true'
            )
            await row(0).click()
            const action = await chat
                .getByRole('button', { name: 'View listing', exact: true })
                .boundingBox(),
              panel = await chat.boundingBox()
            assert(action.x + action.width <= panel.x + panel.width + 1)
            await p.screenshot({
              path: path.join(
                root,
                'messages-' +
                  role +
                  '-expanded-' +
                  width +
                  '-' +
                  reducedMotion +
                  '.png'
              ),
            })
            await p
              .getByRole('button', {
                name: 'Collapse conversations',
                exact: true,
              })
              .click()
            await p.waitForTimeout(400)
            await p.screenshot({
              path: path.join(
                root,
                'messages-' +
                  role +
                  '-collapsed-' +
                  width +
                  '-' +
                  reducedMotion +
                  '.png'
              ),
            })
          }
          await chat
            .getByRole('button', { name: 'View listing', exact: true })
            .click()
          await p.getByRole('dialog', { name: 'Listing preview' }).waitFor()
          assert.equal(
            await p
              .getByRole('dialog', { name: 'Listing preview' })
              .locator('img')
              .first()
              .getAttribute('src'),
            '/static/testPic/laptop.webp'
          )
          await p.keyboard.press('Escape')
          await p
            .getByRole('dialog', { name: 'Listing preview' })
            .waitFor({ state: 'detached' })
          await chat
            .getByRole('button', { name: 'Add to conversation' })
            .click()
          await chat
            .getByRole('button', { name: 'Attachment', exact: true })
            .waitFor()
          await p.keyboard.press('Escape')
          await draft.fill('Send ' + role + ' ' + width)
          await draft.press('Enter')
          await chat
            .getByText('Send ' + role + ' ' + width, { exact: true })
            .waitFor()
          assert(
            await p.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth
            )
          )
          if (mobile) {
            await p.screenshot({
              path: path.join(
                root,
                'messages-' +
                  role +
                  '-mobile-' +
                  width +
                  '-' +
                  reducedMotion +
                  '.png'
              ),
            })
            await p
              .getByRole('button', { name: 'Go Back', exact: true })
              .click()
            await p.locator('[data-mobile-message-detail="false"]').waitFor()
            await p.waitForTimeout(360)
            await row(0).waitFor()
          }
          evidence.push({ width, reducedMotion, role, src: firstImage })
        }
        assert.equal(
          await p.evaluate(() => window.channels),
          1,
          'one existing subscription'
        )
        await p.evaluate(() => window.showBadges())
        const green = p.locator(
            '[data-offer-id="green"] [class*="offerStatus"]'
          ),
          red = p.locator('[data-offer-id="red"] [class*="offerStatus"]')
        await green.waitFor()
        const style = async (loc) =>
          loc.evaluate((n) => {
            const c = getComputedStyle(n)
            return {
              background: c.backgroundColor,
              color: c.color,
              border: c.borderWidth,
              shadow: c.boxShadow,
              radius: c.borderRadius,
              padding: c.padding,
              font: c.fontSize,
            }
          })
        const g = await style(green),
          r = await style(red)
        assert.equal(g.background, 'rgb(22, 163, 74)')
        assert.equal(g.color, 'rgb(255, 255, 255)')
        assert.equal(g.border, '0px')
        assert.equal(g.shadow, 'none')
        assert.equal(r.background, 'rgb(185, 28, 28)')
        assert.equal(g.radius, r.radius)
        assert.equal(g.padding, r.padding)
        assert.equal(g.font, r.font)
        assert.equal(
          (await style(p.locator('[data-agreement-status="open"] > span')))
            .background,
          g.background
        )
        await p
          .locator('[data-offer-id="green"]')
          .getByRole('button', {
            name: 'Open Buyer Offer: Accepted',
            exact: true,
          })
          .click()
        await p.getByRole('button', { name: 'View Order', exact: true }).click()
        await p.waitForFunction(() => window.actions.length === 2)
        assert.deepEqual(await p.evaluate(() => window.actions), [
          'offer',
          'order',
        ])
        await p.screenshot({
          path: path.join(
            root,
            'messages-badges-' + width + '-' + reducedMotion + '.png'
          ),
          fullPage: true,
        })
        assert.deepEqual(errors, [])
        console.log(
          'PASS Messages layout',
          width,
          reducedMotion,
          'Buying/Selling, rail/list selection/search/unread, header/media, draft/scroll/no-remount, View listing, send/attachments, mobile navigation and green/red badges'
        )
        await p.close()
      }
  } finally {
    await browser.close()
  }
  fs.writeFileSync(
    path.join(root, 'messages-layout-evidence.json'),
    JSON.stringify(evidence, null, 2)
  )
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
