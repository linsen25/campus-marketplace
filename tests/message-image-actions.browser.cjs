// Actual uploader, gallery, history and contextual menu with offline transport only.
/* global window, document, getComputedStyle */
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {LazyMotion,domAnimation} from 'framer-motion';import {MessageHistory} from '@/components/home/message-history';import {MessageAttachments} from '@/components/home/message-attachments';import chat from '@/components/home/messages-chat.module.css';import sort from '@/components/filter-interaction.module.css';import '@/components/animata/button/shining-button.css';
const root=createRoot(document.getElementById('root'));window.mockWrites=0;window.actions=[];
window.show=v=>{window.mockWrites=0;const at=new Date(Date.now()-(v.expired?600000:0)).toISOString();const img='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="purple"/></svg>');window.messageFixtures=v.text?[{id:'text',type:'TEXT',content:'My own text message',senderId:v.own?'buyer':'seller',createdAt:at,sequence:1,canWithdraw:!!v.own}]:[{id:'image',type:'IMAGE',senderId:v.own?'buyer':'seller',createdAt:at,sequence:1,canWithdraw:!!v.own,images:Array.from({length:v.count||1},(_,i)=>({id:'photo-'+i,name:'Photo '+i,previewUrl:img,position:i}))}];flushSync(()=>root.render(<LazyMotion features={domAnimation}><div key={JSON.stringify(v)} style={{height:850,width:'100%'}}>{v.upload?<MessageAttachments conversationId="fixture" onCancel={()=>{}} onSend={async()=>{throw Error('Unexpected send')}} onComplete={()=>{}} sendClassName={chat.send}/>:<section className={chat.panel} style={{height:800}}><div className={chat.contentViewport}><div className={chat.normalChat}><MessageHistory conversationId="fixture" currentUserId="buyer" name="Other" active={false} messages={window.messageFixtures}/></div></div></section>}<div data-sort-reference className={sort.panel} style={{display:'none'}}><button className={sort.option}>Sort</button></div></div></LazyMotion>));};
`
)
const aliases = require('./browser-fixture-mocks.cjs')(root)
const mock = path.join(root, 'image-menu-api.js')
fs.writeFileSync(
  mock,
  `
export async function withdrawMessage(id){window.mockWrites++;return {...window.messageFixtures.find(m=>m.id===id),withdrawnAt:new Date().toISOString(),content:''}}
export async function refreshMessageImages(){throw Error('Unexpected renewal')}
export async function cancelImageSubmission(){throw Error('Unexpected upload mutation')}
export async function finalizeImageSubmission(){throw Error('Unexpected upload mutation')}
export async function prepareImageSubmission(){throw Error('Unexpected upload mutation')}
export async function uploadImageSlot(){throw Error('Unexpected upload mutation')}
`
)
aliases['@/lib/messages-api'] = mock
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
    for (const width of [390, 430, 1280, 1536]) {
      const p = await b.newPage({
        viewport: { width, height: 900 },
        reducedMotion: 'reduce',
      })
      const errors = []
      p.on('pageerror', (e) => errors.push(e.message))
      await p.addInitScript(() => (window.process = { env: {} }))
      await p.route(/^https?:/, (r) => r.abort())
      await p.goto(
        'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      await p.evaluate(() => window.show({ upload: true }))
      const drop = p.locator('[data-slot="file-drop"] > label'),
        helper = p.getByText(
          '1-4 photos. JPEG, PNG or WebP. Maximum 3 MB each.',
          { exact: true }
        )
      const d = await drop.boundingBox(),
        h = await helper.boundingBox()
      assert(h.y >= d.y + d.height)
      assert(Math.abs(h.x + h.width / 2 - d.x - d.width / 2) < 1)
      assert.equal(
        await helper.evaluate((e) => getComputedStyle(e).textAlign),
        'center'
      )
      assert.equal(
        await drop.evaluate((e) => getComputedStyle(e).borderTopColor),
        'rgb(255, 255, 255)'
      )
      assert.equal(
        await drop.evaluate((e) => getComputedStyle(e).borderTopStyle),
        'dashed'
      )
      await drop.hover()
      assert.equal(
        await drop.evaluate((e) => getComputedStyle(e).borderTopColor),
        'rgb(255, 255, 255)'
      )
      await p.getByLabel('Attachment photos', { exact: true }).setInputFiles({
        name: 'draft.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG9sAAAAASUVORK5CYII=',
          'base64'
        ),
      })
      await p.getByRole('button', { name: 'Discard', exact: true }).click()
      assert.equal(
        await p.getByRole('button', { name: 'Withdraw', exact: true }).count(),
        0
      )
      assert.equal(await p.evaluate(() => window.mockWrites), 0)
      for (const v of [
        { own: true },
        { own: false },
        { own: true, expired: true },
      ]) {
        await p.evaluate((v) => window.show(v), { ...v, text: true })
        const bubble = p.locator('[class*="bubble"]').first(),
          payload = p.locator('[class*="messagePayload"]')
        const initial = await payload.boundingBox()
        await bubble.click()
        const menu = p.getByRole('menu', { name: 'Content actions' })
        if (!v.own || v.expired) {
          assert.equal(await menu.count(), 0)
          continue
        }
        await menu.waitFor()
        assert.equal(await p.evaluate(() => window.mockWrites), 0)
        assert.deepEqual(await menu.getByRole('menuitem').allTextContents(), [
          'Withdraw',
        ])
        const visual = await menu.evaluate((e) => {
          const ref = document.querySelector('[data-sort-reference]'),
            row = e.querySelector('button'),
            rr = ref.querySelector('button')
          const props = [
            'backgroundColor',
            'borderTopColor',
            'borderRadius',
            'padding',
            'boxShadow',
          ]
          return {
            menu: props.map((k) => getComputedStyle(e)[k]),
            sort: props.map((k) => getComputedStyle(ref)[k]),
            row: ['padding', 'borderRadius', 'fontSize'].map(
              (k) => getComputedStyle(row)[k]
            ),
            sortRow: ['padding', 'borderRadius', 'fontSize'].map(
              (k) => getComputedStyle(rr)[k]
            ),
          }
        })
        assert.deepEqual(visual.menu, visual.sort)
        assert.deepEqual(visual.row, visual.sortRow)
        const br = await bubble.boundingBox(),
          mr = await menu.boundingBox()
        assert(Math.abs(mr.y - br.y - br.height - 8) < 1)
        assert(mr.x >= 8 && mr.x + mr.width <= width - 8)
        assert.deepEqual(await payload.boundingBox(), initial)
        await p.keyboard.press('Escape')
        assert.equal(await menu.count(), 0)
        await bubble.click()
        await p.mouse.click(width - 2, 2)
        assert.equal(await menu.count(), 0)
        await bubble.click()
        await p.locator('[data-message-history]').dispatchEvent('scroll')
        await menu.waitFor({ state: 'detached' })
        assert.equal(await menu.count(), 0)
        await bubble.click()
        await menu
          .getByRole('menuitem', { name: 'Withdraw', exact: true })
          .click()
        await p.getByText('You withdrew a message.', { exact: true }).waitFor()
        assert.equal(await p.evaluate(() => window.mockWrites), 1)
        assert.equal(await p.getByRole('menu').count(), 0)
      }
      for (const count of [1, 4])
        for (const v of [
          { own: true },
          { own: false },
          { own: true, expired: true },
        ]) {
          await p.evaluate((v) => window.show(v), { ...v, count })
          const payload = p.locator('[class*="messagePayload"]')
          const photo = payload.locator('img').first()
          await photo.evaluate((e) => e.decode())
          assert.equal(await p.getByText(/See all .*photos/).count(), 0)
          assert.equal(
            await payload.locator('img').count(),
            count === 4 ? 3 : 1
          )
          await photo.dispatchEvent('pointerdown', {
            pointerType: 'touch',
            button: 0,
          })
          await p.waitForTimeout(600)
          await photo.dispatchEvent('pointerup', { button: 0 })
          await photo.dispatchEvent('contextmenu')
          assert.equal(await p.getByRole('menu').count(), 0)
          await payload
            .getByRole('button', { name: /^(Open photo|View photo)/ })
            .last()
            .click()
          await payload.locator('[data-expanded="true"]').waitFor()
          await p.waitForTimeout(100)
          assert.equal(await payload.locator('img').count(), count)
          const tile = payload.locator('[class*="expandedPhoto"]').last()
          assert.equal(
            await tile
              .locator('img')
              .evaluate((e) => getComputedStyle(e).objectFit),
            'cover'
          )
          assert.equal(
            await tile.evaluate(
              (e) => getComputedStyle(e, '::after').borderTopColor
            ),
            'rgb(255, 255, 255)'
          )
          assert.equal(
            await tile.evaluate(
              (e) => getComputedStyle(e, '::after').borderTopWidth
            ),
            '1px'
          )
          const tileRect = await tile.boundingBox(),
            imgRect = await tile.locator('img').boundingBox()
          assert(Math.abs(tileRect.width - imgRect.width) < 1)
          assert(Math.abs(tileRect.height - imgRect.height) < 1)
          const galleryTop = await payload.evaluate(
            (e) => e.closest('[data-message-history]').scrollTop
          )
          await tile.click()
          const viewer = p.getByRole('dialog', { name: 'Full image viewer' })
          await viewer.waitFor()
          await viewer
            .getByRole('group', { name: count + ' of ' + count, exact: true })
            .waitFor()
          assert.equal(
            await viewer
              .locator('img')
              .last()
              .evaluate((e) => getComputedStyle(e).objectFit),
            'contain'
          )
          assert.equal(await p.getByRole('menu').count(), 0)
          if (count > 1) {
            await viewer.getByRole('button', { name: 'Previous slide' }).click()
            await viewer
              .getByRole('group', {
                name: count - 1 + ' of ' + count,
                exact: true,
              })
              .waitFor()
            await viewer.getByRole('button', { name: 'Next slide' }).click()
            await viewer
              .getByRole('group', { name: count + ' of ' + count, exact: true })
              .waitFor()
            if (width < 1024) {
              const image = viewer.locator('img').last()
              await image.dispatchEvent('pointerdown', {
                pointerType: 'touch',
                clientX: 100,
                clientY: 100,
              })
              await image.dispatchEvent('pointerup', {
                pointerType: 'touch',
                clientX: 180,
                clientY: 100,
              })
              await viewer
                .getByRole('group', {
                  name: count - 1 + ' of ' + count,
                  exact: true,
                })
                .waitFor()
              await image.dispatchEvent('click')
              const nextImage = viewer.locator('img').last()
              await nextImage.dispatchEvent('pointerdown', {
                pointerType: 'touch',
                clientX: 180,
                clientY: 100,
              })
              await nextImage.dispatchEvent('pointerup', {
                pointerType: 'touch',
                clientX: 100,
                clientY: 100,
              })
              await viewer
                .getByRole('group', {
                  name: count + ' of ' + count,
                  exact: true,
                })
                .waitFor()
              await nextImage.dispatchEvent('click')
            }
          } else
            assert.equal(
              await viewer.getByRole('button', { name: 'Next slide' }).count(),
              0
            )
          await viewer.getByRole('button', { name: 'Back to gallery' }).click()
          await viewer.waitFor({ state: 'detached' })
          assert.equal(
            await payload.locator('[data-expanded="true"]').count(),
            1
          )
          assert.equal(
            await payload.evaluate(
              (e) => e.closest('[data-message-history]').scrollTop
            ),
            galleryTop
          )
          await tile.click()
          await viewer.waitFor()
          await p.keyboard.press('Escape')
          await viewer.waitFor({ state: 'detached' })
          assert.equal(
            await payload.locator('[data-expanded="true"]').count(),
            1
          )
          await payload.getByRole('button', { name: 'Go back to chat' }).click()
          await payload.locator('[data-expanded="false"]').waitFor()
          assert.equal(await p.evaluate(() => window.mockWrites), 0)
          assert(
            await p.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth
            )
          )
        }
      assert.deepEqual(errors, [])
      console.log(
        'PASS ' +
          width +
          ': draft unchanged; TEXT-only Sort menu; image stack/Gallery/selected-index full viewer; arrows/back; white borders/cover; zero image writes; offline.'
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
