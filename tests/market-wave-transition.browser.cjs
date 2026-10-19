/* global window, document, getComputedStyle, DOMMatrixReadOnly, innerWidth */
// Real Market carrier/motion and original wave props. Shader is a lightweight
// probe here; the unchanged WebGL implementation gets a separate visual smoke.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
fs.writeFileSync(
  path.join(root, 'wave-probe.jsx'),
  `import React from 'react';export default function Wave(props){return <div data-wave-probe data-wave-props={JSON.stringify(props)} style={{height:'100%',width:'100%'}}/>}`
)
aliases['@/components/ui/GradientWaves'] = path.join(root, 'wave-probe.jsx')
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `import 'tailwindcss/src/css/preflight.css';import React,{useState}from'react';import{createRoot}from'react-dom/client';import{LazyMotion,domAnimation}from'framer-motion';import{MarketBackground}from'@/components/listings/market-background';import styles from '@/components/listings/market-layout.module.css';function App(){const[mode,setMode]=useState(new URLSearchParams(location.search).get('mode')||'resale');window.mode=setMode;return <LazyMotion features={domAnimation}><main className={styles.page}><MarketBackground mode={mode}/><header data-controls style={{height:100}}>Fixed controls</header><section data-content style={{height:1600}}>Unmoving content</section></main></LazyMotion>}createRoot(document.getElementById('root')).render(<App/>);`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#0b0b0b}</style><script>window.process={env:{}}</script><div id="root"></div><script src="bundle.js"></script>'
)
async function main() {
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
    for (const width of [390, 430, 820, 1280, 1536])
      for (const reduced of [false, true]) {
        const p = await browser.newPage({
          viewport: { width, height: 900 },
          reducedMotion: reduced ? 'reduce' : 'no-preference',
        })
        const errors = []
        p.on('pageerror', (e) => errors.push(e.message))
        await p.route('http://localhost:4177/**', (r) => {
          const u = new URL(r.request().url())
          return r.fulfill({
            path: path.join(
              root,
              u.pathname === '/' ? 'index.html' : path.basename(u.pathname)
            ),
          })
        })
        await p.goto('http://localhost:4177/')
        await p.locator('[data-wave-probe]').waitFor()
        await p.clock.install()
        await p.clock.pauseAt(new Date())
        const carrier = p.locator('[data-market-wave-mode]'),
          probe = p.locator('[data-wave-probe]')
        const sample = () =>
          carrier.evaluate((n) => ({
            y: new DOMMatrixReadOnly(getComputedStyle(n).transform).m42,
            opacity: Number(getComputedStyle(n).opacity),
            mode: n.dataset.marketWaveMode,
            rect: { width: n.clientWidth, height: n.clientHeight },
          }))
        const props = () =>
          probe.evaluate((n) => JSON.parse(n.dataset.waveProps))
        const base = await props()
        assert.deepEqual(
          [base.horizonColor, base.waveColor, base.crestColor],
          ['#9000ff', '#ff9ffc', '#ffb3b3']
        )
        assert.equal(base.height, -12)
        assert.equal((await sample()).y, 0)
        await p.clock.runFor(1100)
        assert.equal((await sample()).y, 0, 'no initial travel')
        await p.evaluate(() => {
          window.waveIdentity = document.querySelector('[data-wave-probe]')
          window.scrollTo(0, 180)
        })
        const rect = await p.locator('[data-controls]').boundingBox(),
          scroll = await p.evaluate(() => window.scrollY)
        await p.evaluate(() => window.mode('shop'))
        await p.clock.runFor(250)
        const sinking = await sample()
        if (reduced) assert.equal(sinking.y, 0)
        else {
          assert(
            sinking.y > 200 && sinking.y < 900,
            'background sinks without layout'
          )
          assert.equal(
            sinking.mode,
            'resale',
            'color remains original while sinking'
          )
        }
        await p.clock.runFor(280)
        assert.equal((await sample()).mode, 'shop')
        await p.clock.runFor(600)
        const final = await sample()
        assert(Math.abs(final.y) < 0.01)
        assert.equal(final.opacity, 1)
        assert.deepEqual(final.rect, { width, height: 900 })
        const shop = await props()
        assert.deepEqual(
          {
            ...shop,
            horizonColor: base.horizonColor,
            waveColor: base.waveColor,
            crestColor: base.crestColor,
          },
          base,
          'all geometry/shader parameters retained'
        )
        assert.equal(shop.waveColor, '#b4d6bf')
        assert.deepEqual(
          await p.locator('[data-controls]').boundingBox(),
          rect,
          'content stays in place'
        )
        assert.equal(await p.evaluate(() => window.scrollY), scroll)
        assert(
          await p.evaluate(
            () =>
              window.waveIdentity ===
              document.querySelector('[data-wave-probe]')
          ),
          'same wave instance'
        )
        await p.evaluate(() => window.mode('resale'))
        await p.clock.runFor(1150)
        assert.equal((await sample()).mode, 'resale')
        assert.deepEqual(await props(), base)
        for (const mode of ['shop', 'resale', 'shop', 'resale', 'shop']) {
          await p.evaluate((m) => window.mode(m), mode)
          await p.clock.runFor(140)
        }
        await p.clock.runFor(1200)
        assert.equal((await sample()).mode, 'shop')
        assert(Math.abs((await sample()).y) < 0.01)
        assert.equal(await p.locator('[data-wave-probe]').count(), 1)
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        )
        assert.deepEqual(errors, [])
        // Initial Shop render must already be green and must not play entry travel.
        await p.goto('http://localhost:4177/?mode=shop')
        await p.locator('[data-wave-probe]').waitFor()
        await p.clock.runFor(1200)
        assert.equal((await sample()).mode, 'shop')
        assert.equal((await sample()).y, 0)
        console.log(
          'PASS Market wave',
          width,
          'reduced=' + reduced,
          '500ms sink/color/500ms rise; same props/instance/geometry; rapid latest mode; no scroll/layout shift'
        )
        await p.close()
      }
  } finally {
    await browser.close()
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
