// Actual Current Step/QR/dialog/forms; deterministic camera and API boundaries offline.
/* global window, document, navigator, Event */
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
fs.writeFileSync(
  path.join(root, 'scanner-mock.js'),
  `window.decoderLoads=(window.decoderLoads||0)+1;export default class Scanner{static NO_QR_CODE_FOUND='No QR code found';constructor(video,callback,options){this.video=video;this.callback=callback;this.options=options;this.active=true;window.scanners.push(this);window.emitScan=v=>callback({data:v});window.emitDecoderError=e=>options.onDecodeError(e);}async start(){window.cameraStarts++;if(window.cameraMode==='denied')throw new DOMException('Denied','NotAllowedError');if(window.cameraMode==='none')throw Error('No camera');if(window.cameraMode==='delayed')await new Promise(r=>window.finishPermission=r);const c=document.createElement('canvas');c.width=c.height=20;const stream=c.captureStream(1);window.streams.push(stream);if(!this.active){stream.getTracks().forEach(t=>t.stop());return;}this.video.srcObject=stream;}async pause(){this.active=false;if(this.video.srcObject)this.video.srcObject.getTracks().forEach(t=>t.stop());this.video.srcObject=null;}destroy(){this.active=false;window.destroyed++;this.pause();}}`
)
aliases['qr-scanner'] = path.join(root, 'scanner-mock.js')
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {LazyMotion,domAnimation} from 'framer-motion';import {OrderCurrentStep} from '@/components/home/order-current-step';
window.fixtureRequest=async url=>{if(!url.endsWith('/generate-qr'))throw Error('Unexpected fixture request');return {available:true,qrToken:'a'.repeat(64),expiresAt:new Date(Date.now()+60000).toISOString(),serverTime:new Date().toISOString()}};
const root=createRoot(document.getElementById('root'));let m;window.streams=[];window.scanners=[];window.cameraStarts=0;window.destroyed=0;window.writes=[];window.decoderLoads=0;window.actions=[];
window.fetch=async(url,opts)=>{if(!url.endsWith('/handoff'))throw Error('Unexpected endpoint');const body=JSON.parse(opts.body);window.writes.push({url,...body});await new Promise(r=>setTimeout(r,50));if(m.failure){const failure=m.failure;m.failure=null;if(failure==='handoff_already_redeemed')m.protection=true;return new Response(JSON.stringify({errorCode:failure,retryAt:failure==='numeric_temporarily_locked'?'2030-01-01T12:00:00Z':undefined}),{status:409})}m.protection=true;return new Response(JSON.stringify({verified:true}),{status:200})};
const render=()=>{const paid=m.payment==='paid',terms={fulfillment:m.mode==='meeting'?'on_campus':'delivery',deliveryMethod:m.mode==='courier'?'courier':'seller_delivery'};const order={id:m.key,buyerId:'buyer',sellerId:'seller',lifecycle:m.terminal?'cancelled':'open',paymentStatus:m.payment,v2:{terms},economics:{},snapshot:{listing:{title:'Fixture'}}};const data={fulfillment:{handoffReady:paid&&!m.protection,deliveryStartedAt:m.started?'2026-01-01T00:00:00Z':null,cancellation:{state:m.hold?'disputed':null},protectionStartedAt:m.protection?'2026-01-01T00:00:00Z':null,protectionHold:false},credential:m.loading?null:{available:true,code:'012345',qrToken:'a'.repeat(64)},courier:{state:'not_shipped'},checkout:null};const stage=m.terminal?'cancelled':m.hold?'cancellation':m.protection?'protection':!paid?'loading':m.mode==='courier'?'shipment':m.mode==='seller_delivery'&&!m.started?'delivery':'handoff';flushSync(()=>root.render(<LazyMotion features={domAnimation}><OrderCurrentStep key={m.key} order={order} role={m.role} stage={stage} flow={{data,error:'',refresh:async()=>{if(m.refreshFail)throw Error('Offline refresh');render()}}} onRefresh={async()=>{if(m.refreshFail)throw Error('Offline refresh');render()}} onUpdated={()=>{}}/></LazyMotion>));};
window.show=v=>{m={key:String(Math.random()),role:'buyer',mode:'meeting',payment:'paid',started:false,protection:false,...v};window.model=m;window.cameraMode=v.cameraMode||'ok';window.writes=[];render()};window.rerender=render;
`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:16px;background:#160d23;color:white;font-family:Arial}button{cursor:pointer}html{scrollbar-gutter:stable}</style><div id="root"></div><script src="bundle.js"></script>'
)
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
      })
      p.setDefaultTimeout(8000)
      const errors = []
      p.on('pageerror', (e) => errors.push(e.message))
      await p.route(/^https?:/, (r) => r.abort())
      await p.addInitScript(() => {
        window.process = { env: {} }
        Object.defineProperty(navigator, 'mediaDevices', {
          configurable: true,
          value: {
            getUserMedia: async () => {
              throw Error('Scanner mock only')
            },
          },
        })
      })
      await p.goto(
        'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      const show = (v) => p.evaluate((v) => window.show(v), v),
        scan = async () => {
          await p.getByRole('tab', { name: 'Scan QR', exact: true }).click()
          await p
            .getByRole('button', { name: 'Open scanner', exact: true })
            .click()
        },
        close = async () => {
          await p
            .getByRole('dialog')
            .getByRole('button', { name: 'Close', exact: true })
            .click()
          await p.getByRole('dialog').waitFor({ state: 'detached' })
        }
      let cleanNumber = 0
      const clean = async () => {
        cleanNumber++
        const states = await p.evaluate(() =>
          window.streams.map((s) => s.getTracks().map((t) => t.readyState))
        )
        assert(
          states.every((s) => s.every((t) => t === 'ended')),
          'Camera release check ' + cleanNumber + ': ' + JSON.stringify(states)
        )
      }
      await show({})
      assert.equal(
        await p.getByRole('img', { name: /Handoff QR/ }).count(),
        0,
        'No automatic QR'
      )
      assert(
        !(await p.getByLabel('6-digit handoff code').textContent()).includes(
          '012 345'
        )
      )
      await p.getByRole('button', { name: 'Show code', exact: true }).click()
      await p.getByRole('button', { name: 'Hide code', exact: true }).click()
      await p
        .getByRole('button', { name: 'Generate QR code', exact: true })
        .click()
      await p.getByRole('img', { name: /Handoff QR/ }).waitFor()
      const qr = await p.getByRole('img', { name: /Handoff QR/ }).boundingBox()
      assert.equal(Math.round(qr.width), width >= 1024 ? 240 : 224)
      assert.equal(qr.width, qr.height)
      assert(
        await p
          .getByLabel('6-digit handoff code')
          .textContent()
          .then((s) => !s.includes('012 345'))
      )
      assert.equal(await p.evaluate(() => window.decoderLoads), 0)
      assert.equal(
        await p
          .getByRole('button', { name: 'Open scanner', exact: true })
          .count(),
        0
      )
      await show({ loading: true })
      await p
        .getByText('Waiting for the server-issued handoff credential.')
        .waitFor()
      for (const mode of ['courier'])
        for (const role of ['buyer', 'seller']) {
          await show({ mode, role })
          assert.equal(
            await p.getByRole('img', { name: /Handoff QR/ }).count(),
            0
          )
          assert.equal(
            await p
              .getByRole('button', { name: 'Open scanner', exact: true })
              .count(),
            0
          )
          assert.equal(
            await p.getByLabel('Handoff verification', { exact: true }).count(),
            0
          )
        }
      for (const v of [
        { payment: 'pending' },
        { terminal: true },
        { hold: true },
        { mode: 'seller_delivery', started: false },
      ]) {
        await show(v)
        assert.equal(
          await p.getByRole('img', { name: /Handoff QR/ }).count(),
          0
        )
      }
      await show({ role: 'seller' })
      await scan()
      await p
        .getByRole('dialog')
        .getByText(/Point the camera/)
        .waitFor()
      assert.equal(await p.evaluate(() => window.cameraStarts), 1)
      await close()
      await clean()
      assert(
        await p
          .getByRole('button', { name: 'Open scanner', exact: true })
          .evaluate((e) => e === document.activeElement)
      )
      for (const cameraMode of ['denied', 'none']) {
        await show({ role: 'seller', cameraMode })
        await scan()
        await p.getByRole('dialog').getByRole('alert').waitFor()
        await clean()
        await close()
        await p.getByRole('tab', { name: 'Enter code', exact: true }).click()
        assert(await p.getByLabel('Buyer handoff code').isVisible())
      }
      await show({ role: 'seller', cameraMode: 'delayed' })
      await scan()
      await p.waitForFunction(
        () => typeof window.finishPermission === 'function'
      )
      await close()
      await p.evaluate(() => window.finishPermission())
      await p.waitForTimeout(30)
      await clean()
      await show({ role: 'seller' })
      await scan()
      await p
        .getByRole('dialog')
        .getByText(/Point the camera/)
        .waitFor()
      await p.evaluate(() => window.emitScan('not-a-handoff'))
      await p.getByText(/This is not a handoff QR/).waitFor()
      assert.equal(await p.evaluate(() => window.writes.length), 0)
      await p.evaluate(() => {
        window.emitScan('a'.repeat(64))
        window.emitScan('a'.repeat(64))
      })
      await p.waitForFunction(() => window.model.protection)
      await p.getByRole('dialog').waitFor({ state: 'detached' })
      assert.equal(await p.evaluate(() => window.writes.length), 1)
      assert(
        await p.evaluate(
          () =>
            window.writes[0].channel === 'qr' &&
            window.writes[0].credential === 'a'.repeat(64) &&
            !window.writes[0].url.includes('a'.repeat(64))
        )
      )
      await clean()
      await show({ role: 'seller', failure: 'invalid_handoff_credential' })
      await scan()
      await p
        .getByRole('dialog')
        .getByText(/Point the camera/)
        .waitFor()
      await p.evaluate(() => window.emitScan('a'.repeat(64)))
      await p.getByRole('dialog').getByRole('alert').waitFor()
      await clean()
      await p.getByRole('button', { name: 'Scan again', exact: true }).click()
      await p
        .getByRole('dialog')
        .getByText(/Point the camera/)
        .waitFor()
      await p.evaluate(() => window.emitScan('a'.repeat(64)))
      await p.getByRole('dialog').waitFor({ state: 'detached' })
      assert(
        await p.evaluate(
          () =>
            window.writes.length === 2 &&
            window.writes[0].clientActionId === window.writes[1].clientActionId
        ),
        'Stable existing command across retry'
      )
      await clean()
      await show({ role: 'seller', failure: 'numeric_temporarily_locked' })
      await p.getByRole('tab', { name: 'Enter code', exact: true }).click()
      await p.getByLabel('Buyer handoff code').fill('012345')
      await p
        .getByRole('button', { name: 'Verify handoff', exact: true })
        .click()
      await p.getByText(/Numeric entry is temporarily locked until/).waitFor()
      assert(
        await p.getByRole('tab', { name: 'Scan QR', exact: true }).isEnabled()
      )
      await scan()
      await p
        .getByRole('dialog')
        .getByText(/Point the camera/)
        .waitFor()
      await p.keyboard.press('Escape')
      await clean()
      await show({ role: 'seller' })
      await p.getByRole('tab', { name: 'Enter code', exact: true }).click()
      await p.getByLabel('Buyer handoff code').fill('012345')
      await p
        .getByRole('button', { name: 'Verify handoff', exact: true })
        .click()
      await p.waitForFunction(() => window.model.protection)
      assert(
        await p.evaluate(
          () =>
            window.writes.length === 1 && window.writes[0].channel === 'code'
        )
      )
      await show({ role: 'seller' })
      await scan()
      await p
        .getByRole('dialog')
        .getByText(/Point the camera/)
        .waitFor()
      await p.evaluate(() =>
        window.dispatchEvent(new Event('marketplace-session-ended'))
      )
      await p.getByRole('dialog').waitFor({ state: 'detached' })
      await clean()
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      )
      if (width === 390) {
        await show({ role: 'seller' })
        await scan()
        await p
          .getByRole('dialog')
          .getByText(/Point the camera/)
          .waitFor()
        await p.evaluate(() => window.emitDecoderError('No QR code found'))
        assert.equal(await p.getByRole('dialog').getByRole('alert').count(), 0)
        await p.evaluate(() =>
          window.emitDecoderError(Error('Decoder unavailable'))
        )
        await p.getByRole('dialog').getByRole('alert').waitFor()
        await clean()
        await close()

        await show({ role: 'seller' })
        await scan()
        await p
          .getByRole('dialog')
          .getByText(/Point the camera/)
          .waitFor()
        await show({ role: 'buyer' })
        await clean()
        assert.equal(await p.getByRole('dialog').count(), 0)
        await show({ role: 'seller' })
        await scan()
        await p
          .getByRole('dialog')
          .getByText(/Point the camera/)
          .waitFor()
        await p.evaluate(() => {
          Object.defineProperty(document, 'hidden', {
            value: true,
            configurable: true,
          })
          document.dispatchEvent(new Event('visibilitychange'))
          delete document.hidden
        })
        await p.getByRole('dialog').waitFor({ state: 'detached' })
        await clean()
        await show({ role: 'seller', failure: 'handoff_already_redeemed' })
        await scan()
        await p
          .getByRole('dialog')
          .getByText(/Point the camera/)
          .waitFor()
        await p.evaluate(() => window.emitScan('a'.repeat(64)))
        await p.getByRole('dialog').waitFor({ state: 'detached' })
        assert(await p.evaluate(() => window.model.protection))
        await clean()
        await show({ role: 'seller', refreshFail: true })
        await scan()
        await p
          .getByRole('dialog')
          .getByText(/Point the camera/)
          .waitFor()
        await p.evaluate(() => window.emitScan('a'.repeat(64)))
        await p.getByRole('dialog').getByRole('alert').waitFor()
        assert.equal(
          await p.locator('[data-current-step="handoff"]').count(),
          1
        )
        await p.evaluate(() => (window.model.refreshFail = false))
        await p.getByRole('button', { name: 'Scan again', exact: true }).click()
        await p
          .getByRole('dialog')
          .getByText(/Point the camera/)
          .waitFor()
        await p.evaluate(() => window.emitScan('a'.repeat(64)))
        await p.getByRole('dialog').waitFor({ state: 'detached' })
        assert.equal(await p.evaluate(() => window.writes.length), 1)
        await clean()
      }
      assert.deepEqual(errors, [])
      console.log(
        'PASS handoff QR ' +
          width +
          ': Buyer/Seller/Courier/stage gates; lazy camera, cleanup/late permission/logout, malformed/duplicate frames, stable retry, numeric lock/fallback, responsive bounds'
      )
      await p.close()
    }
  } finally {
    await b.close()
  }
}
run().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
