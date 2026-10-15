// Offline production combobox qualification; no hosted data or Google requests.
/* global window, document, innerWidth */
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {MeetingLocationInput} from '@/components/listings/meeting-location-input';
window.calls=[];window.pending=[];window.fetch=(url,options)=>new Promise(resolve=>{const call={url,body:JSON.parse(options.body)};window.calls.push(call);window.pending.push(data=>resolve({ok:!data.fail,json:async()=>data}));});
function App(){const [value,setValue]=useState(''),[selected,setSelected]=useState(null);window.current={value,selected};return <form onSubmit={e=>{e.preventDefault();window.submitted=window.current}} style={{padding:24,maxWidth:650,margin:'auto'}}><MeetingLocationInput value={value} selected={selected} onChange={v=>{setValue(v);setSelected(null)}} onSelect={p=>setSelected(p?{provider:'google',placeId:p.placeId}:null)} required/><button>Continue</button></form>};createRoot(document.getElementById('root')).render(<App/>);
`
)
async function run() {
  await build()
  for (const n of ['entry.tsx', 'api.ts']) fs.unlinkSync(path.join(root, n))
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const width of [390, 430, 820, 1280, 1536]) {
      const p = await browser.newPage({ viewport: { width, height: 900 } }),
        errors = []
      p.on('pageerror', (e) => errors.push(e.message))
      await p.goto(
        'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      const input = p.getByRole('combobox'),
        option = {
          placeId: 'fixture_place_1',
          primaryText: 'Google transient name',
          secondaryText: 'Transient address',
          displayText: 'Transient full text',
        }
      await input.fill('We')
      await p.waitForTimeout(100)
      assert.equal(await p.evaluate(() => window.calls.length), 0)
      await input.fill('Western')
      await p.waitForFunction(() => window.calls.length === 1)
      await input.fill('Weldon')
      await p.waitForFunction(() => window.calls.length === 2)
      await p.evaluate(() =>
        window.pending[0]({
          suggestions: [{ placeId: 'stale_place', primaryText: 'STALE' }],
        })
      )
      assert.equal(await p.getByRole('option').count(), 0)
      await p.evaluate((o) => window.pending[1]({ suggestions: [o] }), option)
      await p.getByRole('option').waitFor()
      const panel = await p.getByRole('listbox').locator('..').boundingBox()
      assert(
        panel.x >= 0 &&
          panel.x + panel.width <= width &&
          panel.y + panel.height <= 900
      )
      await input.press('ArrowDown')
      assert(await input.getAttribute('aria-activedescendant'))
      await input.press('Enter')
      await p.waitForFunction(() => window.calls.length === 3)
      assert.equal(
        await p.evaluate(() => window.calls[1].body.sessionToken),
        await p.evaluate(() => window.calls[2].body.sessionToken)
      )
      await p.evaluate(() =>
        window.pending[2]({
          placeId: 'fixture_place_1',
          displayName: 'Google transient name',
          formattedAddress: 'Transient address',
        })
      )
      await p.waitForFunction(
        () => window.current.selected?.placeId === 'fixture_place_1'
      )
      assert.equal(await input.inputValue(), 'Google transient name')
      assert.deepEqual(await p.evaluate(() => window.current.selected), {
        provider: 'google',
        placeId: 'fixture_place_1',
      })
      await input.fill('My entrance')
      await p.waitForFunction(() => window.calls.length === 4)
      assert.equal(await p.evaluate(() => window.current.selected), null)
      assert.notEqual(
        await p.evaluate(() => window.calls[1].body.sessionToken),
        await p.evaluate(() => window.calls[3].body.sessionToken)
      )
      await p.evaluate((o) => window.pending[3]({ suggestions: [o] }), option)
      await p.getByRole('option').click()
      await p.waitForFunction(() => window.calls.length === 5)
      await p.evaluate(() =>
        window.pending[4]({
          placeId: 'fixture_place_1',
          displayName: 'Name',
          formattedAddress: 'Address',
        })
      )
      await p.waitForFunction(() => window.current.selected !== null)
      await input.fill('Manual description')
      await p.waitForFunction(() => window.calls.length === 6)
      await p.evaluate(() => window.pending[5]({ fail: true }))
      await p
        .getByText(
          'Location search unavailable. You can enter a location manually.'
        )
        .first()
        .waitFor()
      assert.equal(await input.inputValue(), 'Manual description')
      await input.press('Escape')
      assert.equal(await input.getAttribute('aria-expanded'), 'false')
      await p.getByRole('button', { name: 'Continue' }).click()
      assert.equal(
        await p.evaluate(() => window.submitted.value),
        'Manual description'
      )
      await input.fill('Again')
      await p.waitForFunction(() => window.calls.length === 7)
      await p.evaluate((o) => window.pending[6]({ suggestions: [o] }), option)
      await p.getByRole('option').waitFor()
      // Reduced visible height approximates the keyboard viewport constraint.
      await p.setViewportSize({ width, height: 320 })
      const reduced = await p.getByRole('listbox').locator('..').boundingBox()
      assert(reduced.x >= 0 && reduced.x + reduced.width <= width)
      assert(reduced.y >= 0 && reduced.y + reduced.height <= 320)
      await input.press('Tab')
      assert.equal(await input.getAttribute('aria-expanded'), 'false')
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        ),
        true
      )
      assert.deepEqual(errors, [])
      console.log(
        'PASS combobox ' +
          width +
          ': debounce/stale/keyboard/pointer/token/edit/free-text/Escape/Tab/geometry'
      )
      await p.close()
    }
  } finally {
    await browser.close()
  }
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
