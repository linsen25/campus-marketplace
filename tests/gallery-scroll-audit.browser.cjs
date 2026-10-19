const { testPictureDataUrl } = require('../scripts/lib/test-pictures.cjs')
// Actual animated Gallery + active history, offline scroll-authority qualification.
/* global window, document, getComputedStyle, Element, requestAnimationFrame, scrollY, visualViewport */
const assert = require('node:assert/strict')
const fs = require('node:fs'),
  path = require('node:path')
const { root, build } = require('./message-payload.browser.cjs')
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `import 'tailwindcss/src/css/preflight.css';import React from 'react';import {createRoot} from 'react-dom/client';import {MessageHistory} from '@/components/home/message-history';import chat from '@/components/home/messages-chat.module.css';const img=${JSON.stringify(
    testPictureDataUrl('monitor')
  )};let ms=Array.from({length:24},(_,i)=>({id:'text'+i,type:'TEXT',senderId:'buyer',content:'normal message '+i+' '.repeat(2)+'Useful normal words for the timeline.',sequence:i+1,createdAt:new Date(Date.now()-600000+i*1000).toISOString(),canWithdraw:false}));ms.splice(24,0,{id:'image',type:'IMAGE',senderId:'buyer',createdAt:new Date(Date.now()+1000).toISOString(),sequence:12,canWithdraw:false,images:Array.from({length:window.imageCount||4},(_,i)=>({id:'photo'+i,name:'Photo '+i,previewUrl:img,position:i}))});const reactRoot=createRoot(document.getElementById('root'));const render=()=>reactRoot.render(<section className={chat.panel} style={{height:600,width:'100%'}}><header data-header>Header</header><div className={chat.contentViewport}><div className={chat.normalChat}><MessageHistory conversationId="audit" currentUserId="buyer" name="Other" active messages={ms}/></div></div><footer data-composer>Composer</footer></section>);render();window.append=()=>{ms=[...ms,{id:"newest",type:"TEXT",senderId:"buyer",content:"New own message after gallery return",sequence:30,createdAt:new Date(Date.now()+5000).toISOString(),canWithdraw:false}];render()};`
)
;(async () => {
  await build()
  for (const n of ['entry.tsx', 'api.ts']) fs.unlinkSync(path.join(root, n))
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const b = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const variant of [
      { count: 4, motion: 'no-preference' },
      { count: 1, motion: 'no-preference' },
      { count: 4, motion: 'reduce' },
      { count: 1, motion: 'reduce' },
    ])
      for (const width of [390, 430, 1280, 1536]) {
        const p = await b.newPage({
          viewport: { width, height: 900 },
          reducedMotion: variant.motion,
        })
        await p.addInitScript((count) => {
          window.imageCount = count
          window.trace = []
          const d = Object.getOwnPropertyDescriptor(
            Element.prototype,
            'scrollTop'
          )
          Object.defineProperty(Element.prototype, 'scrollTop', {
            ...d,
            set(v) {
              if (this.matches('[data-message-history]'))
                window.trace.push({
                  kind: 'write',
                  v,
                  before: d.get.call(this),
                  height: this.scrollHeight,
                  client: this.clientHeight,
                  stack: new Error().stack.split('\n').slice(2, 5),
                })
              d.set.call(this, v)
            },
          })
          window.sample = () => {
            const h = document.querySelector('[data-message-history]')
            return {
              top: h.scrollTop,
              height: h.scrollHeight,
              client: h.clientHeight,
              y: scrollY,
              overflow: getComputedStyle(document.body).overflow,
              viewport: visualViewport.height,
              header: document
                .querySelector('[data-header]')
                .getBoundingClientRect().y,
              composer: document
                .querySelector('[data-composer]')
                .getBoundingClientRect().y,
            }
          }
        }, variant.count)
        await p.goto(
          'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
        )
        await p.locator('[data-expanded]').waitFor()
        await p.waitForTimeout(1200)
        await p
          .locator('[data-expanded] button')
          .last()
          .scrollIntoViewIfNeeded()
        const before = await p.evaluate(() => window.sample())
        await p.locator('[data-expanded] button').last().click()
        await p.waitForTimeout(1200)
        const during = await p.evaluate(() => window.sample())
        assert.notEqual(during.height, before.height)
        await p.evaluate(() => {
          window.trace = []
          window.frames = []
          let n = 0
          function tick() {
            window.frames.push(window.sample())
            if (++n < 100) requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
        })
        await p.getByRole('button', { name: 'Go back to chat' }).click()
        await p.waitForTimeout(1800)
        const after = await p.evaluate(() => window.sample())
        const frames = await p.evaluate(() => window.frames)
        const trace = await p.evaluate(() => window.trace)
        assert.equal(after.top, before.top)
        assert.equal(after.height, before.height)
        for (const frame of frames) {
          for (const key of [
            'client',
            'y',
            'overflow',
            'viewport',
            'header',
            'composer',
          ])
            assert.equal(frame[key], before[key])
        }
        const restored = frames.findIndex((frame) => frame.top === before.top)
        assert(restored >= 0)
        assert(
          frames
            .slice(restored)
            .every((frame) => Math.abs(frame.top - before.top) <= 1)
        )
        assert.equal(await p.locator('[data-gallery-restoring]').count(), 0)
        assert(
          trace.every(
            (write) =>
              Math.abs(write.v - before.top) <= 1 ||
              (write.before === before.top && write.height === before.height)
          )
        )
        console.log(
          'PASS ' +
            variant.count +
            ' photos/' +
            variant.motion +
            ' ' +
            width +
            ': Gallery close scrollTop ' +
            before.top +
            ' -> ' +
            after.top +
            '; no rebound; header/composer/body/visualViewport stable; restoration guard released.'
        )
        await p.evaluate(() => window.append())
        await p
          .getByText('New own message after gallery return', { exact: true })
          .waitFor()
        await p.waitForTimeout(100)
        const latest = await p.evaluate(() => window.sample())
        assert(Math.abs(latest.height - latest.client - latest.top) <= 1)
        await p.locator('[data-message-history]').evaluate((e) => {
          e.scrollTop -= 100
        })
        await p.waitForTimeout(100)
        const scrolled = await p.evaluate(() => window.sample())
        assert(scrolled.top < latest.top)
        await p.close()
      }
  } finally {
    await b.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
