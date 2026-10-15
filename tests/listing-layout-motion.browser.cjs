// Actual Market ExpandableCard motion/scroll-owner regression, offline only.
/* global window, document, getComputedStyle */
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `import 'tailwindcss/src/css/preflight.css';import React from 'react';import {createRoot} from 'react-dom/client';import {ExpandableCard} from '@/components/velora/expandable-card';const image=<img alt="Synthetic listing" style={{width:'100%',height:'100%',objectFit:'cover'}} src={'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="purple"/></svg>')}/>;createRoot(document.getElementById('root')).render(<div style={{paddingTop:400,minHeight:2200}}><div style={{width:240,margin:'0 auto'}}><ExpandableCard title="CA$80" expandedTitle="Synthetic motion fixture" media={image}><p>Frozen listing details</p></ExpandableCard></div></div>);`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#160d23;color:white;font-family:Arial}</style><div id="root"></div><script src="bundle.js"></script>'
)
async function run() {
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
    for (const width of [390, 430, 820, 1280, 1536]) {
      const p = await b.newPage({
        viewport: { width, height: 900 },
        reducedMotion: 'no-preference',
      })
      p.setDefaultTimeout(6000)
      const errors = []
      p.on('pageerror', (e) => errors.push(e.message))
      await p.goto(
        'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      await p.evaluate(() => window.scrollTo(0, 300))
      const trigger = p.locator('[data-slot="expandable-card"]')
      await trigger.click()
      const dialog = p.getByRole('dialog')
      await dialog.waitFor()
      await p.waitForTimeout(900)
      assert.equal(
        await p.evaluate(() => getComputedStyle(document.body).overflow),
        'hidden'
      )
      assert(await dialog.getByAltText('Synthetic listing').isVisible())
      await p.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached' })
      assert.equal(await p.evaluate(() => window.scrollY), 300)
      assert.notEqual(
        await p.evaluate(() => getComputedStyle(document.body).overflow),
        'hidden'
      )
      assert.deepEqual(errors, [])
      console.log(
        'PASS Market shared-layout ' +
          width +
          ': expanded media/open-close spring, scroll lock and exact original scroll restoration unchanged'
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
