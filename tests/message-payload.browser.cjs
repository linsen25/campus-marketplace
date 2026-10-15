// Offline component qualification: production MessageHistory/WithdrawContext/photos,
// no app server, hosted data, session, or real API requests.
/* global window, document, getComputedStyle */
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const webpack = require('webpack')
const root = path.resolve('tests/artifacts/message-payload-qualification')
assert.equal(
  spawnSync('git', ['check-ignore', path.join(root, 'probe')]).status,
  0
)
fs.mkdirSync(root, { recursive: true })
fs.writeFileSync(
  path.join(root, 'ts-loader.cjs'),
  `module.exports=function(s){return require(${JSON.stringify(
    require.resolve('typescript')
  )}).transpileModule(s,{fileName:this.resourcePath,compilerOptions:{jsx:4,module:99,target:7,esModuleInterop:true}}).outputText}`
)
fs.writeFileSync(
  path.join(root, 'css-loader.cjs'),
  `module.exports=require(${JSON.stringify(
    path.resolve('tests/browser-css-loader.cjs')
  )})`
)
fs.writeFileSync(
  path.join(root, 'api.ts'),
  `export async function withdrawMessage(id:string){window.mockWrites++;return {...window.messageFixtures.find(x=>x.id===id),withdrawnAt:new Date().toISOString(),content:''}}`
)
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {MessageHistory} from '@/components/home/message-history';
import chat from '@/components/home/messages-chat.module.css';
import request from '@/components/home/order-request-preview.module.css';
import offer from '@/components/home/offer-ui.module.css';
const root=createRoot(document.getElementById('root'));window.mockWrites=0;
window.setCase=(value)=>{window.messageFixtures=value.messages;flushSync(()=>root.render(<section className={chat.panel} style={{height:5000,width:'100%'}}><div className={chat.contentViewport}><div className={chat.normalChat}><MessageHistory conversationId={value.key} messages={value.messages} currentUserId={value.viewer} name="Other" active={false} offers={value.rich?[{id:'offer',senderId:'seller',createdAt:value.at}]:[]} agreements={value.rich?[{id:'agreement',createdAt:value.at}]:[]} orderRequests={value.rich?[{id:'v1',createdAt:value.at}]:[]} orderRequestSenderId="seller" renderOffer={()=> <div className={offer.timelineCard}><button className={request.collapsed}>Offer</button></div>} renderAgreement={()=> <div className={offer.agreement}>Agreement</div>} renderOrderRequest={()=> <button className={request.collapsed}>V1 Request</button>}/></div></div></section>));};
`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:12px;font-family:Arial}html{scrollbar-gutter:stable}</style><div id="root"></div><script src="bundle.js"></script>'
)
const build = (aliases = {}) =>
  new Promise((resolve, reject) =>
    webpack(
      {
        mode: 'development',
        devtool: false,
        entry: path.join(root, 'entry.tsx'),
        output: { path: root, filename: 'bundle.js', hashFunction: 'sha256' },
        resolve: {
          extensions: ['.tsx', '.ts', '.jsx', '.js'],
          alias: {
            '@/lib/messages-api': path.join(root, 'api.ts'),
            ...aliases,
            '@': path.resolve('.'),
            '@ui': path.resolve('components/@ui'),
          },
        },
        module: {
          rules: [
            {
              test: /\.(tsx?|jsx)$/,
              use: path.join(root, 'ts-loader.cjs'),
              exclude: /node_modules/,
            },
            { test: /\.css$/, use: path.join(root, 'css-loader.cjs') },
          ],
        },
        plugins: [
          new webpack.DefinePlugin({
            'process.env.NODE_ENV': JSON.stringify('development'),
          }),
        ],
      },
      (error, stats) =>
        error
          ? reject(error)
          : stats.hasErrors()
          ? reject(Error(stats.toString({ all: false, errors: true })))
          : resolve()
    )
  )
async function run() {
  await build()
  // Generated TS fixtures are bundle inputs, not part of the application's tsc scope.
  fs.unlinkSync(path.join(root, 'entry.tsx'))
  fs.unlinkSync(path.join(root, 'api.ts'))
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE ||
    './artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath:
      process.env.BROWSER_EXECUTABLE ||
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  let cases = 0
  try {
    for (const width of [390, 430, 1280, 1536]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } }),
        errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.route(/^https?:/, (route) => {
        throw Error(
          'Unexpected network request: ' +
            new URL(route.request().url()).hostname
        )
      })
      await page.goto(
        'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      await page.waitForFunction(() => typeof window.setCase === 'function')
      const ratio = width < 1024 ? 0.82 : 0.65
      const at = new Date().toISOString(),
        uri =
          'data:image/svg+xml,' +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="purple"/></svg>'
          )
      for (const viewer of ['buyer', 'seller'])
        for (const sender of ['buyer', 'seller']) {
          const samples = [
            'text',
            'im seller',
            'new message',
            Array(80).fill('normal sentence with words').join(' '),
            'X'.repeat(800),
          ]
          for (let index = 0; index < samples.length; index++) {
            let baseline
            for (const enabled of [false, true])
              for (const rich of [false, true]) {
                const msg = {
                  id: 'm',
                  senderId: sender,
                  createdAt: at,
                  type: 'TEXT',
                  content: samples[index],
                  canWithdraw: enabled,
                }
                await page.evaluate((v) => window.setCase(v), {
                  key: `${viewer}-${sender}-${index}-${enabled}-${rich}`,
                  messages: [msg],
                  viewer,
                  rich,
                  at,
                })
                const measured = await page
                  .locator('[data-message-id="m"]')
                  .evaluate((row) => {
                    const payload = row.querySelector(
                        '[class*="messagePayload"]'
                      ),
                      interaction = payload.firstElementChild,
                      bubble = interaction.querySelector('p')
                    const box = (e) => {
                      const r = e.getBoundingClientRect()
                      return { x: r.x, width: r.width, height: r.height }
                    }
                    const text = bubble.firstChild,
                      wordRects = []
                    for (const match of bubble.textContent.matchAll(/\S+/g)) {
                      const range = document.createRange()
                      range.setStart(text, match.index)
                      range.setEnd(text, match.index + match[0].length)
                      wordRects.push(
                        Array.from(range.getClientRects()).map((r) => r.y)
                      )
                    }
                    return {
                      row: box(row),
                      group: box(row.parentElement),
                      payload: box(payload),
                      interaction: box(interaction),
                      bubble: box(bubble),
                      max: getComputedStyle(payload).maxWidth,
                      bubbleMax: getComputedStyle(bubble).maxWidth,
                      overflow: bubble.scrollWidth - bubble.clientWidth,
                      words: wordRects,
                      own: row.dataset.sent,
                      eligible: interaction.getAttribute('aria-label'),
                    }
                  })
                assert.equal(measured.max, width < 1024 ? '82%' : '65%')
                assert(
                  Math.abs(measured.row.width - measured.group.width) < 0.1
                )
                assert.equal(measured.bubbleMax, 'none')
                assert(measured.payload.width <= measured.row.width * ratio + 1)
                assert(measured.overflow <= 1)
                assert.equal(measured.own, String(viewer === sender))
                assert.equal(
                  measured.eligible,
                  enabled && viewer === sender ? 'Own content actions' : null
                )
                assert(
                  Math.abs(
                    measured.payload.width - measured.interaction.width
                  ) < 1
                )
                assert(
                  Math.abs(measured.payload.width - measured.bubble.width) < 1
                )
                if (index < 3) {
                  assert(measured.bubble.height < 45)
                  assert(measured.words.every((rs) => new Set(rs).size === 1))
                }
                if (index === 3) {
                  assert(
                    Math.abs(
                      measured.payload.width - measured.row.width * ratio
                    ) < 1
                  )
                  assert(measured.words.every((rs) => new Set(rs).size === 1))
                }
                if (viewer === sender)
                  assert(
                    Math.abs(
                      measured.payload.x +
                        measured.payload.width -
                        measured.row.x -
                        measured.row.width
                    ) < 1
                  )
                else
                  assert(Math.abs(measured.payload.x - measured.row.x - 40) < 1)
                if (!baseline) baseline = measured
                else {
                  assert(
                    Math.abs(baseline.payload.width - measured.payload.width) <
                      0.1
                  )
                  assert(
                    Math.abs(baseline.bubble.height - measured.bubble.height) <
                      0.1
                  )
                }
                cases++
              }
          }
          for (const count of [1, 2]) {
            let imageBaseline
            for (const enabled of [false, true])
              for (const rich of [false, true]) {
                const images = Array.from({ length: count }, (_, i) => ({
                  id: String(i),
                  name: 'test',
                  size: 10,
                  mimeType: 'image/svg+xml',
                  previewUrl: uri,
                }))
                await page.evaluate((v) => window.setCase(v), {
                  key: `img-${viewer}-${sender}-${count}-${enabled}-${rich}`,
                  messages: [
                    {
                      id: 'image',
                      senderId: sender,
                      createdAt: at,
                      type: 'IMAGE',
                      canWithdraw: enabled,
                      images,
                    },
                  ],
                  viewer,
                  at,
                  rich,
                })
                await page.waitForFunction((count) => {
                  const row = document.querySelector(
                    '[data-message-id="image"]'
                  )
                  return (
                    row &&
                    Boolean(row.querySelector('[data-image-gallery]')) ===
                      count > 1 &&
                    row.querySelectorAll('img').length === count
                  )
                }, count)
                await page
                  .locator('[data-message-id="image"] img')
                  .first()
                  .evaluate((img) => img.decode())
                const result = await page
                  .locator('[data-message-id="image"]')
                  .evaluate((row) => {
                    const p = row.querySelector('[class*="messagePayload"]'),
                      img = p.querySelector('img')
                    return {
                      row: row.clientWidth,
                      p: p.getBoundingClientRect().width,
                      height: p.getBoundingClientRect().height,
                      child: p.firstElementChild.getBoundingClientRect().width,
                      img: img.getBoundingClientRect().width,
                      overflow: p.scrollWidth - p.clientWidth,
                    }
                  })
                assert(result.p > 50 && result.p <= result.row * ratio + 1)
                assert(Math.abs(result.p - result.child) < 1)
                assert(result.overflow <= 1)
                assert(result.img > 0)
                if (!imageBaseline) imageBaseline = result
                else {
                  assert(Math.abs(imageBaseline.p - result.p) < 0.1)
                  assert(
                    Math.abs(imageBaseline.height - result.height) < 0.1,
                    JSON.stringify({
                      width,
                      viewer,
                      sender,
                      count,
                      enabled,
                      rich,
                      imageBaseline,
                      result,
                    })
                  )
                }
                assert.equal(await page.getByRole('menu').count(), 0)
                cases++
              }
          }
        }
      assert.equal(await page.evaluate(() => window.mockWrites), 0)
      assert.deepEqual(errors, [])
      await page.close()
    }
    console.log(
      JSON.stringify({
        passed: true,
        cases,
        widths: [390, 430, 1280, 1536],
        networkRequests: 0,
        hostedWrites: 0,
        mockedWithdrawals: 0,
      })
    )
  } finally {
    await browser.close()
  }
}
module.exports = { root, build }
if (require.main === module)
  run().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
