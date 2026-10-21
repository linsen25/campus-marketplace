/* global window, document, File, Event, innerWidth */
// Actual AvatarDialog, hook, API client and CSS. Offline transport only.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict'),
  sharp = require('sharp')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
async function main() {
  const png = await sharp({
    create: { width: 60, height: 60, channels: 3, background: '#466d55' },
  })
    .png()
    .toBuffer()
  const image = 'data:image/png;base64,' + png.toString('base64')
  fs.writeFileSync(
    path.join(root, 'entry.tsx'),
    `
 import 'tailwindcss/src/css/preflight.css';import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {LazyMotion,domAnimation} from 'framer-motion';
 import {AvatarDialog,ProfileAvatar} from '@/components/home/profile-avatar';import {useProfileAvatar} from '@/hooks/use-profile-avatar';
 const root=createRoot(document.getElementById('root'));window.user='owner-a';window.writes=[];window.failed=false;window.hold=false;
 window.store=JSON.parse(sessionStorage.getItem('avatar-store')||'{}');
 window.fixtureRequest=async()=>({...window.store[window.user]||{avatarUrl:null,avatarVersion:null}});
 window.fetch=async(url,options)=>{if(url!='/api/profile/avatar')throw Error('Unexpected HTTP');const owner=window.user;window.writes.push({owner,action:options.headers['X-Avatar-Action'],expected:options.headers['X-Avatar-Version']});
  const finish=()=>{if(window.failed){window.failed=false;return {ok:false,status:503,json:async()=>({error:'Controlled avatar failure'})}}const data={avatarUrl:${JSON.stringify(
    image
  )},avatarVersion:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};window.store[owner]=data;sessionStorage.setItem('avatar-store',JSON.stringify(window.store));return {ok:true,status:200,json:async()=>data}};
  if(window.hold)return new Promise(resolve=>{window.finishSave=()=>resolve(finish())});return finish();};
 function App({owner}){const {avatarImage,saveAvatar}=useProfileAvatar(owner);const [open,setOpen]=useState(false);window.saveDirect=saveAvatar;return <LazyMotion features={domAnimation}><div data-avatar-account><ProfileAvatar username={owner} image={avatarImage}/><button onClick={()=>setOpen(true)}>Open avatar</button></div>{open&&<AvatarDialog key={owner} username={owner} onSave={saveAvatar} onClose={()=>setOpen(false)}/>}</LazyMotion>}
 window.show=owner=>{window.user=owner;flushSync(()=>root.render(<App owner={owner}/>))};window.show(window.user);document.body.style.background='#0b0b0b';document.body.style.color='white';
 `
  )
  await build(aliases)
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const width of [390, 430, 820, 1280, 1536]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        serviceWorkers: 'block',
      })
      await page.addInitScript(() => {
        window.process = { env: { NODE_ENV: 'development' } }
      })
      await page.route(/^https?:/, (r) => r.abort())
      await page.goto(
        'file://' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      await page.waitForTimeout(100)
      const setFile = () =>
        page.locator('input[type=file]').setInputFiles({
          name: 'avatar.png',
          mimeType: 'image/png',
          buffer: png,
        })
      await page
        .getByRole('button', { name: 'Open avatar', exact: true })
        .click()
      await setFile()
      await page.waitForTimeout(250)
      const dialogBox = await page.getByRole('dialog').boundingBox()
      assert(dialogBox.x >= 0 && dialogBox.x + dialogBox.width <= width + 1)
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      )
      const save = page.getByRole('button', { name: 'Save', exact: true })
      await save.waitFor()
      await page.waitForFunction(
        () =>
          !Array.from(document.querySelectorAll('button')).find(
            (b) => b.textContent.trim() === 'Save'
          ).disabled
      )
      await page.evaluate(() => {
        window.failed = true
        window.hold = true
      })
      await save.click()
      await page.waitForFunction(() => window.writes.length === 1)
      assert.equal(
        await page.getByRole('dialog').count(),
        1,
        'dialog waits for server'
      )
      assert(await save.isDisabled(), 'pending Save cannot submit twice')
      await page.screenshot({
        path: path.join(root, 'avatar-pending-' + width + '.png'),
      })
      await page.evaluate(() => window.finishSave())
      await page
        .getByRole('alert')
        .filter({ hasText: 'Controlled avatar failure' })
        .waitFor()
      assert.equal(
        await page.getByText('avatar.png', { exact: true }).count(),
        1
      )
      assert.equal(
        await page.locator('[data-avatar-account] img').count(),
        0,
        'failed save preserves fallback'
      )
      await page.evaluate(() => {
        window.hold = false
      })
      await save.click()
      await page.getByRole('dialog').waitFor({ state: 'detached' })
      assert.equal(await page.locator('[data-avatar-account] img').count(), 1)
      const writes = await page.evaluate(() => window.writes)
      assert.equal(writes.length, 2)
      assert.equal(writes[0].action, writes[1].action, 'retry same intent')
      await page.reload()
      await page.locator('[data-avatar-account] img').waitFor()
      await page.evaluate(() => window.show('owner-b'))
      await page.waitForTimeout(60)
      assert.equal(
        await page.locator('[data-avatar-account] img').count(),
        0,
        'other account fallback'
      )
      await page.evaluate(() => window.show('owner-a'))
      await page.locator('[data-avatar-account] img').waitFor()
      // Logout clears immediately; late completion cannot restore the former owner.
      await page.evaluate(async () => {
        window.hold = true
        window.pending = window
          .saveDirect(new File(['image'], 'pending.png', { type: 'image/png' }))
          .catch(() => {})
      })
      await page.waitForFunction(() => Boolean(window.finishSave))
      await page.evaluate(() => {
        window.dispatchEvent(new Event('marketplace-session-ended'))
        window.show('owner-b')
        window.finishSave()
      })
      await page.waitForTimeout(80)
      assert.equal(await page.locator('[data-avatar-account] img').count(), 0)
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        ),
        'no horizontal overflow'
      )
      console.log(
        'PASS avatar ' +
          width +
          ': async Save, no duplicate submit, failure/retry same UUID, unchanged fallback, reload restore, account isolation and stale logout response'
      )
      await page.screenshot({
        path: path.join(root, 'avatar-persistence-' + width + '.png'),
      })
      await page.close()
    }
  } finally {
    await browser.close()
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
