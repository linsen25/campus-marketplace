const { testPictureDataUrl } = require('../scripts/lib/test-pictures.cjs')
/* global window, document, getComputedStyle */
// Offline real-component qualification. All mutations are controlled local callbacks.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import {LazyMotion,domAnimation} from 'framer-motion';import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {MessageHistory} from '@/components/home/message-history';
import {OfferCard,OfferEditor,OfferEconomicsSummary} from '@/components/home/offer-ui';
import {AgreementCard} from '@/components/home/agreement-card';
import {FormalV2OrderDetail} from '@/components/home/formal-v2-order-detail';
import '@/components/animata/button/shining-button.css';
import chat from '@/components/home/messages-chat.module.css';
const root=createRoot(document.getElementById('root'));
window.actions=[];window.closedCount=0;window.sends=0;
window.fixtureRequest=async(url,method)=>{if(method!=='GET')throw Error('Unexpected mutation');if(url.endsWith('/fulfillment'))return {orderId:'order',handoffReady:false,handoffConfirmedAt:null,protectionStartedAt:null,protectionExpiresAt:null,serverTime:new Date().toISOString()};if(url.endsWith('/checkout'))return {orderId:'order',address:null};if(url.endsWith('/courier'))return {state:'not_shipped'};throw Error('Unexpected fixture request')};
window.showCase=(v)=>{window.actions=[];window.closedCount=0;window.sends=0;
const listing={title:'Fixture item',price:9900,photoUrls:[],live:{price:9900,pickupArea:'Weldon',preferredFulfillment:'ON_CAMPUS'}};
const scheduled=new Date(Date.now()+86400000);scheduled.setHours(12,0,0,0);
const terms={itemAmountCents:7000,currency:'CAD',note:'',fulfillment:'on_campus',meetupLocation:'Weldon',scheduledAt:scheduled.toISOString()};
const offer={id:'offer-1',protocolVersion:2,conversationId:'conversation',listingId:'listing',buyerId:'buyer',sellerId:'seller',senderId:v.sender||'seller',recipientId:v.sender==='buyer'?'seller':'buyer',status:v.status||'Active',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),terms,askingPriceCents:8000,linkedOrderId:null,canWithdraw:true,canAccept:true,changedFields:['Price'],mutationKind:'create'};
const agreements=['open','cancelled','expired','completed'].map(status=>({id:'order-'+status,offerId:'offer-1',createdAt:new Date().toISOString(),status,listingTitle:'Fixture item',buyerId:'buyer',sellerId:'seller',terms}));
if(v.multipleCancelled)agreements.push({...agreements[1],id:'order-cancelled-2'});
if(v.minuteBoundary){offer.createdAt=new Date(Date.now()+60000).toISOString();agreements.forEach(a=>{a.createdAt=new Date(Date.now()+120000).toISOString()})}
window.agreementFixtures=agreements;window.agreementBefore=JSON.stringify(agreements);
if(v.kind==='rhythm'){
const base=Math.floor(Date.now()/60000)*60000,at=i=>new Date(base+i*1000).toISOString();
const image=${JSON.stringify(testPictureDataUrl('monitor'))};
const messages=[0,1,2,4,6,7].map(i=>({id:'rhythm-'+i,type:i===2?'IMAGE':'TEXT',content:i===6?'':'new message',senderId:'seller',createdAt:at(i),sequence:i+1,canWithdraw:false,withdrawnAt:i===6?at(i):null,images:i===2?[{id:'photo',previewUrl:image,name:'Fixture image',position:0}]:[]}));
const rich={...offer,createdAt:at(3)},agreement={...agreements[0],createdAt:at(5)};
flushSync(()=>root.render(<LazyMotion features={domAnimation}><section className={chat.panel} style={{height:3000,width:'100%'}}><div className={chat.contentViewport}><div className={chat.normalChat}><MessageHistory conversationId={'rhythm-'+v.viewer} currentUserId={v.viewer} name="Other" active={false} messages={messages} offers={[rich]} agreements={[agreement]} renderOffer={()=><OfferCard offer={rich} listing={listing} viewerId={v.viewer} participantName="Other" blocked={false}/>} renderAgreement={a=><AgreementCard agreement={a} onView={()=>{}}/>}/></div></div></section></LazyMotion>));return;}
const card=<OfferCard offer={offer} listing={listing} viewerId={v.viewer} participantName="Other" blocked={false} canEdit={true} onEdit={()=>window.actions.push('revise')} onWithdraw={async()=>{window.actions.push('withdraw')}} onAccept={async()=>{window.actions.push('accept')}} onDeny={async()=>{window.actions.push('deny')}}/>;
const editor=<OfferEditor listing={listing} initial={v.fresh?undefined:offer} viewerId={v.viewer} buyer={v.viewer==='buyer'} onClose={()=>window.closedCount++} onSend={()=>{window.sends++;return new Promise((resolve,reject)=>{window.resolveSend=resolve;window.rejectSend=reject})}}/>;
const delivery={...terms,fulfillment:'delivery',deliveryFeeCents:1000,deliveryMethod:'courier',deliveryArea:{countryCode:'CA',provinceCode:'ON',cityLabel:'London',postalPrefix:'N6A'}};
const order={id:'order',protocolVersion:2,lifecycle:'cancelled',paymentStatus:'pending',paymentPaidAt:null,payoutStatus:'not_eligible',fulfillmentStatus:'pending',holdsListing:false,canCancel:false,canSimulatePayment:false,snapshot:{listing:{title:'Fixture item',category:'Electronics',photoUrls:[]},buyer:'Buyer',seller:'Seller'},v2:{terms:delivery,askingPriceCents:8000,condition:'Good',description:'Frozen description',subcategory:'Other'},economics:{itemCents:7000,deliveryCents:1000,buyerServiceFeeCents:70,buyerTotalCents:8070,sellerPlatformFeeCents:0,sellerGrossCents:8000}};
flushSync(()=>root.render(<LazyMotion features={domAnimation}><React.Fragment key={JSON.stringify(v)}>{v.kind==='editor'?editor:v.kind==='order'?<FormalV2OrderDetail order={order} role={v.viewer} mode={v.viewer==='buyer'?'purchases':'sales'} offset={0} onBack={()=>{}} onRefresh={async()=>{}} onCancelled={()=>{}}/>:v.kind==='economics'?<OfferEconomicsSummary terms={v.delivery?delivery:terms} buyer={v.viewer==='buyer'} askingPrice={8000}/>:<section className={chat.panel} style={{height:3000,width:'100%'}}><div className={chat.contentViewport}><div className={chat.normalChat}><MessageHistory conversationId={JSON.stringify(v)} currentUserId={v.viewer} name="Other" active={false} messages={[{id:'text',type:'TEXT',content:'im seller',senderId:'seller',createdAt:new Date().toISOString(),sequence:1,canWithdraw:true}]} offers={v.rich===false?[]:[offer]} agreements={v.rich===false?[]:agreements} renderOffer={()=>card} renderAgreement={a=><AgreementCard agreement={a} onView={()=>window.actions.push(a.id)}/>}/></div></div></section>}</React.Fragment></LazyMotion>));};
`
)
async function run() {
  await build(require('./browser-fixture-mocks.cjs')(root))
  for (const name of ['entry.tsx', 'api.ts'])
    fs.unlinkSync(path.join(root, name))
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  let checks = 0
  try {
    for (const width of [390, 430, 1280, 1536]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } }),
        errors = []
      page.on('pageerror', (e) => {
        errors.push(e.message)
        console.error(e.message)
      })
      await page.route(/^https?:/, () => {
        throw Error('Unexpected network request')
      })
      await page.addInitScript(() => {
        window.process = { env: {} }
      })
      await page.goto(
        'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      await page.waitForFunction(() => typeof window.showCase === 'function')
      for (const viewer of ['buyer', 'seller']) {
        await page.evaluate((v) => window.showCase(v), {
          kind: 'rhythm',
          viewer,
        })
        await page
          .locator('[data-timeline-id] img')
          .evaluateAll((images) => Promise.all(images.map((i) => i.decode())))
        const rhythmGeometry = await page.evaluate(() => {
          const items = [
            ...document.querySelectorAll(
              '[data-timeline-id], [data-timeline-agreement] > [class*="agreement"]'
            ),
          ]
          const rects = items.map((e) => e.getBoundingClientRect())
          return {
            gaps: rects.slice(1).map((r, i) => r.top - rects[i].bottom),
            centers: [...document.querySelectorAll('[class*="messagePayload"]')]
              .filter((e) => e.parentElement.querySelector('[class*="avatar"]'))
              .map((e) => {
                const avatar =
                  e.parentElement.querySelector('[class*="avatar"]')
                const a = avatar.getBoundingClientRect(),
                  p = e.getBoundingClientRect()
                return (a.top + a.bottom - p.top - p.bottom) / 2
              }),
          }
        })
        assert.equal(rhythmGeometry.gaps.length, 7)
        for (const gap of rhythmGeometry.gaps)
          assert(Math.abs(gap - 4) < 1, JSON.stringify(rhythmGeometry))
        for (const center of rhythmGeometry.centers)
          assert(Math.abs(center) < 1)
        checks++
        await page.evaluate((v) => window.showCase(v), {
          viewer,
          kind: 'timeline',
          minuteBoundary: true,
          status: 'Accepted',
        })
        const badgeClear = await page
          .locator('[data-offer-own]')
          .evaluate((e) => {
            const row = e.closest('[data-timeline-id]'),
              group = row.closest('section'),
              badge = e.querySelector('[class*="offerStatus"]'),
              stamp = group.querySelector('[data-time-separator]'),
              previous = group.previousElementSibling,
              next = group.nextElementSibling,
              b = badge.getBoundingClientRect(),
              r = e.getBoundingClientRect()
            return {
              timestamp: stamp && stamp.getBoundingClientRect().bottom <= b.top,
              previous:
                previous && previous.getBoundingClientRect().bottom <= b.top,
              next: next && r.bottom <= next.getBoundingClientRect().top,
            }
          })
        assert.deepEqual(badgeClear, {
          timestamp: true,
          previous: true,
          next: true,
        })
        checks++
        let baseline
        for (const rich of [false, true]) {
          await page.evaluate((v) => window.showCase(v), { viewer, rich })
          const dimensions = await page
            .locator('[class*="messagePayload"]')
            .evaluate((e) => {
              const r = e.getBoundingClientRect()
              return { x: r.x, width: r.width, height: r.height }
            })
          if (!rich) baseline = dimensions
          else assert.deepEqual(dimensions, baseline)
          checks++
        }
        if (viewer === 'seller') {
          const payload = page.locator('[class*="messagePayload"]')
          const box = await payload.boundingBox()
          await payload.click()
          await page.getByRole('menu').waitFor()
          assert.deepEqual(await payload.boundingBox(), box)
          await page.keyboard.press('Escape')
          await payload.click()
          await page.mouse.click(2, 2)
          assert.equal(await page.getByRole('menu').count(), 0)
          checks++
        }
        for (const sender of ['buyer', 'seller'])
          for (const status of [
            'Active',
            'Replaced',
            'Accepted',
            'Declined',
            'Closed',
            'Expired',
          ]) {
            await page.evaluate((v) => window.showCase(v), {
              viewer,
              sender,
              status,
            })
            const card = page.locator('[data-offer-own]'),
              label = card.locator('[class*="offerStatus"]'),
              button = card.locator('button').first()
            const own = sender === viewer,
              text = status === 'Closed' ? 'No longer available' : status
            assert.equal(await label.textContent(), text)
            assert(!(await button.textContent()).includes(text))
            const geometry = await card.evaluate((e) => {
              const b = e.querySelector('[class*="offerButton"]'),
                s = e.querySelector('[class*="offerStatus"]'),
                br = b.getBoundingClientRect(),
                sr = s.getBoundingClientRect()
              return {
                color: getComputedStyle(b).backgroundColor,
                gradientDisplay: getComputedStyle(b, '::before').display,
                gradient: getComputedStyle(b, '::before').backgroundImage,
                border: getComputedStyle(b).borderTopColor,
                borderWidth: getComputedStyle(b).borderTopWidth,
                outlineWidth: getComputedStyle(b).outlineWidth,
                outlineStyle: getComputedStyle(b).outlineStyle,
                outlineColor: getComputedStyle(b).outlineColor,
                outlineOffset: getComputedStyle(b).outlineOffset,
                bx: br.x,
                bw: br.width,
                by: br.y,
                sx: sr.x,
                sr: sr.right,
                sy: sr.y,
                bottom: sr.bottom,
                badgeBackground: getComputedStyle(s).backgroundColor,
                badgeColor: getComputedStyle(s).color,
                badgeBlur: getComputedStyle(s).filter,
                badgeImage: getComputedStyle(s).backgroundImage,
                position: getComputedStyle(s).position,
              }
            })
            assert.equal(
              geometry.color,
              status === 'Active'
                ? own
                  ? 'rgb(37, 99, 235)'
                  : 'rgb(109, 40, 217)'
                : 'rgb(33, 30, 40)'
            )
            assert.equal(
              geometry.gradientDisplay,
              status === 'Active' ? 'block' : 'none'
            )
            if (status === 'Active')
              assert.equal(
                (geometry.gradient.match(/radial-gradient/g) || []).length,
                2
              )
            assert.equal(geometry.position, 'static')
            assert.equal(geometry.borderWidth, '0px')
            assert.equal(
              geometry.outlineStyle,
              status === 'Active' ? 'none' : 'solid'
            )
            if (status !== 'Active') {
              assert.equal(geometry.outlineWidth, '1px')
              assert.equal(
                geometry.outlineColor,
                own ? 'rgb(96, 165, 250)' : 'rgb(119, 84, 151)'
              )
              assert.equal(geometry.outlineOffset, '-1px')
            }
            assert(geometry.sy < geometry.by)
            assert(
              Math.abs(
                own
                  ? geometry.sx - geometry.bx
                  : geometry.sr - (geometry.bx + geometry.bw)
              ) < 0.01
            )
            assert(Math.abs(geometry.by - geometry.bottom - 4) < 0.01)
            assert.equal(
              geometry.badgeBackground,
              ['Active', 'Accepted'].includes(status)
                ? 'rgb(22, 163, 74)'
                : 'rgb(185, 28, 28)'
            )
            assert.equal(geometry.badgeColor, 'rgb(255, 255, 255)')
            assert.equal(geometry.badgeBlur, 'none')
            assert.equal(geometry.badgeImage, 'none')
            const unaffected = await card.evaluate((e) => {
              const badge = e.querySelector('[class*="offerStatus"]'),
                body = e.querySelector('[class*="offerButton"]'),
                row = e.closest('[data-timeline-id]')
              const measure = () =>
                [body, ...body.children].map((n) => {
                  const r = n.getBoundingClientRect()
                  return [r.x, r.y, r.width, r.height]
                })
              const before = measure()
              body.style.outline = 'none'
              const withoutOutline = measure()
              body.style.removeProperty('outline')
              body.style.border = '1px solid transparent'
              body.style.padding = '0'
              const after = measure()
              body.style.removeProperty('border')
              body.style.removeProperty('padding')
              const b = badge.getBoundingClientRect(),
                r = e.getBoundingClientRect(),
                rr = row.getBoundingClientRect()
              return {
                before,
                withoutOutline,
                after,
                badgeInItem: b.top >= r.top && b.bottom <= r.bottom,
                badgeInRow: b.top >= rr.top && b.bottom <= rr.bottom,
              }
            })
            assert.deepEqual(unaffected.before, unaffected.after)
            assert.deepEqual(unaffected.before, unaffected.withoutOutline)
            assert(unaffected.badgeInItem && unaffected.badgeInRow)
            if (own && status === 'Active') {
              await button.click()
              await page.getByRole('dialog').waitFor()
              assert.equal(await page.getByRole('menu').count(), 0)
              assert.equal(
                await page
                  .getByRole('dialog')
                  .getByRole('button', { name: 'Withdraw', exact: true })
                  .count(),
                0
              )
              const detail = await page.getByRole('dialog').textContent()
              assert(!detail.includes('Original asking price'))
              assert(!detail.includes('Current Offer price'))
              assert(detail.includes('CA$70.00'))
              assert(detail.includes('Item offer'))
              await page.keyboard.press('Escape')
              await page.getByRole('dialog').waitFor({ state: 'detached' })
              await button.dispatchEvent('pointerdown', {
                pointerType: 'touch',
                button: 0,
              })
              await page.waitForTimeout(600)
              await button.dispatchEvent('pointerup', { button: 0 })
              assert.equal(await page.getByRole('menu').count(), 0)
            }
            checks++
          }
        await page.evaluate((v) => window.showCase(v), {
          viewer,
          minuteBoundary: true,
        })
        for (const status of ['open', 'cancelled', 'expired', 'completed']) {
          const card = page.locator(`[data-agreement-status="${status}"]`),
            info = card.locator('[class*="agreementInfo"]'),
            cta = card.getByRole('button')
          if (status === 'cancelled') {
            assert.equal(await card.textContent(), 'Order cancelled')
            assert.equal(await cta.count(), 0)
            assert.equal(
              await card
                .locator(
                  '[class*="agreementInfo"], [class*="agreementStatus"], [class*="agreementCta"]'
                )
                .count(),
              0
            )
            const event = await card.evaluate((e) => {
              const r = e.getBoundingClientRect(),
                group = e.closest('[data-timeline-agreement]'),
                p = group.getBoundingClientRect(),
                stamp = group.querySelector('[data-time-separator]'),
                prev = group.previousElementSibling,
                next = group.nextElementSibling
              return {
                tag: e.tagName,
                tabindex: e.getAttribute('tabindex'),
                role: e.getAttribute('role'),
                center: Math.abs(r.left + r.right - p.left - p.right),
                width: r.width,
                height: r.height,
                timestampClear:
                  !stamp || stamp.getBoundingClientRect().bottom <= r.top,
                neighborsClear:
                  (!prev || prev.getBoundingClientRect().bottom <= r.top) &&
                  (!next || r.bottom <= next.getBoundingClientRect().top),
                border: getComputedStyle(e).borderTopWidth,
                background: getComputedStyle(e).backgroundColor,
                gradient: getComputedStyle(e).backgroundImage,
                after: getComputedStyle(e, '::after').content,
              }
            })
            assert.equal(event.tag, 'P')
            assert.equal(event.tabindex, null)
            assert.equal(event.role, null)
            assert(event.center < 1 && event.width < 150 && event.height === 20)
            assert(event.timestampClear && event.neighborsClear)
            assert.equal(event.border, '0px')
            assert.equal(event.background, 'rgba(0, 0, 0, 0)')
            assert.equal(event.gradient, 'none')
            assert.equal(event.after, 'none')
            await card.click()
            assert.deepEqual(await page.evaluate(() => window.actions), [])
            assert.equal(
              await page.getByText('Order cancelled', { exact: true }).count(),
              1
            )
            checks++
            continue
          }
          assert.equal(await card.getByRole('button').count(), 1)
          assert.equal(
            await info.evaluate((e) => getComputedStyle(e).color),
            'rgb(255, 255, 255)'
          )
          const field = await info.evaluate((e) => {
            const layer = getComputedStyle(e, '::before')
            return {
              background: layer.backgroundImage,
              display: layer.display,
              color: getComputedStyle(e).backgroundColor,
              blur: layer.filter,
              clip: getComputedStyle(e).overflow,
              foreground: getComputedStyle(e.firstElementChild).zIndex,
            }
          })
          const historical = ['cancelled', 'expired'].includes(status)
          assert.equal(field.display, historical ? 'none' : 'block')
          assert.equal(
            field.color,
            historical ? 'rgb(33, 30, 40)' : 'rgb(67, 52, 122)'
          )
          if (!historical)
            assert.equal(
              (field.background.match(/radial-gradient/g) || []).length,
              2
            )
          assert(!field.background.includes('linear-gradient'))
          assert.equal(field.blur, 'blur(18px)')
          assert.equal(field.clip, 'hidden')
          assert.equal(field.foreground, '1')
          const badge = card.locator('[class*="agreementStatus"]')
          const title =
            status === 'open'
              ? 'Agreement reached'
              : status.charAt(0).toUpperCase() + status.slice(1)
          assert.equal(await badge.textContent(), title)
          assert(!(await info.textContent()).includes(title))
          const badgeGeometry = await card.evaluate((e) => {
            const badge = e.querySelector('[class*="agreementStatus"]'),
              body = e.querySelector('[class*="agreementInfo"]').parentElement,
              b = badge.getBoundingClientRect(),
              r = body.getBoundingClientRect(),
              item = e.getBoundingClientRect(),
              group = e.closest('[data-timeline-agreement]'),
              stamp = group.querySelector('[data-time-separator]')
            return {
              center: Math.abs(b.left + b.right - r.left - r.right),
              gap: r.top - b.bottom,
              inItem: b.top >= item.top && b.bottom <= item.bottom,
              timestampClear:
                !stamp || stamp.getBoundingClientRect().bottom <= b.top,
              badgeColor: getComputedStyle(badge).backgroundColor,
              width: r.width,
              padding: getComputedStyle(body.firstElementChild).padding,
            }
          })
          assert(badgeGeometry.center < 1)
          assert.equal(badgeGeometry.gap, 4)
          assert(badgeGeometry.inItem && badgeGeometry.timestampClear)
          assert.equal(
            badgeGeometry.badgeColor,
            historical ? 'rgb(185, 28, 28)' : 'rgb(22, 163, 74)'
          )
          assert.equal(badgeGeometry.padding, '16px')
          assert(badgeGeometry.width <= 400)
          const shellGeometry = await info.evaluate((info) => {
            const shell = info.parentElement
            const measure = () =>
              [shell, ...shell.children].map((node) => {
                const r = node.getBoundingClientRect()
                return [r.x, r.y, r.width, r.height]
              })
            const style = getComputedStyle(shell, '::after')
            const outline = {
              width: style.borderTopWidth,
              style: style.borderTopStyle,
              color: style.borderTopColor,
              pointerEvents: style.pointerEvents,
              zIndex: style.zIndex,
              content: style.content,
            }
            const before = measure()
            const hide = document.createElement('style')
            hide.textContent =
              '[data-outline-measure]::after { display: none !important; }'
            shell.setAttribute('data-outline-measure', 'true')
            document.head.appendChild(hide)
            const without = measure()
            hide.remove()
            shell.removeAttribute('data-outline-measure')
            return { outline, before, without }
          })
          assert.deepEqual(shellGeometry.before, shellGeometry.without)
          if (status !== 'completed') {
            assert.equal(shellGeometry.outline.style, 'solid')
            assert.equal(shellGeometry.outline.width, '1px')
            assert.equal(shellGeometry.outline.color, 'rgb(142, 129, 148)')
            assert.equal(shellGeometry.outline.pointerEvents, 'none')
            assert.equal(shellGeometry.outline.zIndex, '30')
          } else assert.equal(shellGeometry.outline.content, 'none')
          assert.equal(
            await cta.evaluate(
              (e) =>
                getComputedStyle(e.querySelector('.shining-button__body'))
                  .backgroundColor
            ),
            'rgb(255, 255, 255)'
          )
          const centred = await card.evaluate((e) => {
            const r = e.getBoundingClientRect(),
              p = e.parentElement.getBoundingClientRect()
            return Math.abs(r.left + r.right - (p.left + p.right)) < 2
          })
          assert(centred)
          await info.click()
          assert.deepEqual(await page.evaluate(() => window.actions), [])
          await cta.click()
          await page.waitForFunction(() => window.actions.length === 1)
          assert.deepEqual(await page.evaluate(() => window.actions), [
            'order-' + status,
          ])
          await page.evaluate(() => {
            window.actions = []
          })
          checks++
        }
        assert.equal(
          await page.evaluate(() => JSON.stringify(window.agreementFixtures)),
          await page.evaluate(() => window.agreementBefore)
        )
        await page.evaluate((v) => window.showCase(v), {
          viewer,
          minuteBoundary: true,
          multipleCancelled: true,
        })
        assert.equal(
          await page.getByText('Order cancelled', { exact: true }).count(),
          2
        )
        assert.equal(
          await page
            .locator(
              '[data-timeline-agreement="order-cancelled"] [data-agreement-status="cancelled"]'
            )
            .count(),
          1
        )
        assert.equal(
          await page
            .locator(
              '[data-timeline-agreement="order-cancelled-2"] [data-agreement-status="cancelled"]'
            )
            .count(),
          1
        )
        assert.equal(
          await page.evaluate(() => JSON.stringify(window.agreementFixtures)),
          await page.evaluate(() => window.agreementBefore)
        )
        checks++
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        )
        if (process.env.TIMELINE_STATUS_ONLY) continue
        for (const delivery of [false, true]) {
          await page.evaluate((v) => window.showCase(v), {
            kind: 'economics',
            viewer,
            delivery,
          })
          const text = await page.locator('#root').textContent()
          assert(text.includes('CA$80.00'))
          assert(text.includes('CA$70.00'))
          assert(
            text.includes(
              viewer === 'buyer' ? 'Buyer service fee' : 'Seller platform fee'
            )
          )
          assert(
            !text.includes(
              viewer === 'buyer' ? 'Seller platform fee' : 'Buyer service fee'
            )
          )
          assert(
            text.includes(
              viewer === 'buyer'
                ? delivery
                  ? 'CA$80.70'
                  : 'CA$70.70'
                : delivery
                ? 'CA$80.00'
                : 'CA$70.00'
            )
          )
          checks++
        }
        // This pass qualifies Messages/Offer interaction, not the later Order-stage redesign.
        if (process.argv.includes('--messages-only')) continue
        await page.evaluate((v) => window.showCase(v), {
          kind: 'order',
          viewer,
        })
        // Closed stage shows the authoritative outcome, not the former Overview.
        const summary = page.getByRole('region', { name: 'Order outcome' })
        assert((await summary.textContent()).includes('Order cancelled'))
        assert((await summary.textContent()).includes('Payment: pending'))
        assert.equal(
          await page
            .getByRole('navigation', { name: 'Order page navigation' })
            .count(),
          0
        )
        checks++
        await page.evaluate((v) => window.showCase(v), {
          kind: 'editor',
          viewer,
        })
        const form = page.getByRole('form', { name: 'Offer terms' })
        const rhythm = await form.evaluate((e) => {
          const fs = e.firstElementChild,
            children = [...fs.children],
            a = children[0].getBoundingClientRect(),
            b = children[1].getBoundingClientRect(),
            c = children[2].getBoundingClientRect()
          return {
            gap: getComputedStyle(fs).gap,
            first: b.top - a.bottom,
            second: c.top - b.bottom,
          }
        })
        assert.equal(rhythm.gap, '20px')
        assert(Math.abs(rhythm.first - 20) < 1)
        assert(Math.abs(rhythm.second - 20) < 1)
        const scheduleGap = await form
          .locator('[class*="scheduleGroups"]')
          .evaluate((e) => {
            const fields = [...e.firstElementChild.children]
            const a = fields[0].getBoundingClientRect(),
              b = fields[1].getBoundingClientRect()
            return b.top - a.bottom
          })
        assert(Math.abs(scheduleGap - 20) < 1)
        await page
          .getByRole('button', { name: 'Review Offer', exact: true })
          .click()
        const review = page.getByRole('dialog', { name: 'Review your Offer' })
        await review.waitFor()
        assert((await review.textContent()).includes('CA$80.00'))
        assert(
          (await review.textContent()).includes(
            viewer === 'buyer' ? 'CA$70.70' : 'Seller platform fee'
          )
        )
        const send = review.getByRole('button', { name: /Send|Revise|Counter/ })
        await send.click()
        await send.evaluate((e) => e.click())
        assert.equal(await page.evaluate(() => window.sends), 1)
        await page.evaluate(() =>
          window.rejectSend(Error('Controlled failure'))
        )
        await review
          .getByRole('alert')
          .filter({ hasText: 'Controlled failure' })
          .waitFor()
        await page.waitForTimeout(2100)
        await send.click()
        assert.equal(await page.evaluate(() => window.sends), 2)
        await page.evaluate(() => window.resolveSend())
        await review.locator('button[data-state="success"]').waitFor()
        assert.equal(await page.evaluate(() => window.closedCount), 0)
        await send.evaluate((e) => e.click())
        assert.equal(await page.evaluate(() => window.sends), 2)
        await page.waitForFunction(() => window.closedCount === 1)
        checks++
        await page.evaluate((v) => window.showCase(v), {
          kind: 'editor',
          fresh: true,
          viewer,
        })
        await page
          .getByRole('button', { name: 'Delivery', exact: true })
          .click()
        await page.getByLabel('Delivery fee (CA$)', { exact: true }).fill('10')
        await page
          .getByRole('button', { name: 'Courier / shipping', exact: true })
          .click()
        await page.getByLabel('Delivery city', { exact: true }).fill('London')
        await page
          .getByLabel('Postal prefix (first 3 characters)', { exact: true })
          .fill('N6A')
        await page
          .getByRole('button', { name: 'Review Offer', exact: true })
          .click()
        const freshReview = page.getByRole('dialog', {
          name: 'Review your Offer',
        })
        const freshSend = freshReview.getByRole('button', {
          name: 'Send Offer',
          exact: true,
        })
        await freshSend.waitFor()
        assert.equal(
          await freshSend.evaluate((e) =>
            getComputedStyle(e).getPropertyValue('--surface').trim()
          ),
          '#166534'
        )
        const labelGeometry = await freshSend
          .locator('[class*="sendLabel"]')
          .evaluate((e) => {
            const range = document.createRange()
            range.selectNodeContents(e)
            return {
              height: range.getBoundingClientRect().height,
              line: parseFloat(getComputedStyle(e).lineHeight),
            }
          })
        assert(labelGeometry.height <= labelGeometry.line + 1)
        assert(
          (await freshReview.textContent()).includes('Current Offer price')
        )
        assert(!(await freshReview.textContent()).includes('You saved'))
        checks++
      }
      assert.deepEqual(errors, [])
      await page.close()
    }
    console.log(
      JSON.stringify({
        passed: true,
        checks,
        widths: [390, 430, 1280, 1536],
        roles: ['buyer', 'seller'],
        hostedWrites: 0,
      })
    )
  } finally {
    await browser.close()
  }
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
