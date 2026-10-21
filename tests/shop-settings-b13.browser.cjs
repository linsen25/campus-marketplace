/* global window, document, getComputedStyle */
// Real hook + ProfileOverview/ShopSettings/editor; controlled in-memory HTTP only.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
const mocks = path.join(root, 'b13-mocks.jsx')
fs.writeFileSync(
  mocks,
  `export function useMarketplaceSession(){return window.session};export function NotificationSettings(){return <section aria-label="Notification preferences"><h3>Notifications</h3></section>};export function Link({href,children,...props}){return <a {...props} href={href}>{children}</a>}`
)
aliases['@/components/listings/marketplace-session'] = mocks
aliases['@/components/notifications/notification-settings'] = mocks
aliases['@ui/link/link'] = mocks
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import React,{useState,useEffect} from 'react';import {createRoot} from 'react-dom/client';import {LazyMotion,domAnimation} from 'framer-motion';import {ProfileOverview} from '@/components/home/profile-overview';import {useOwnShopProfile} from '@/hooks/use-own-shop-profile';import {ShopProBadge} from '@/components/shops/shop-pro-badge';
window.process={env:{}};window.actions=[];window.requests=[];window.pending=[];window.mode='normal';window.session={seller:{id:'owner-a'},loading:false,error:''};window.username='real_owner';let revision=1;let failGet=false;
const seed=(owner,name)=>({id:'shop-'+owner,ownerId:owner,name,category:'Electronics',description:'Private owner description',createdAt:'2026-10-19T00:00:00Z',updatedAt:'2026-10-19T12:34:56.123456+00:00'});
window.records={'owner-a':seed('owner-a','Owner Shop'),'owner-b':seed('owner-b','Second Owner')};window.tag=()=> '"shop-'+revision+'"';window.external=()=>{window.records['owner-a'].name='Changed elsewhere';revision++};
const reply=(status,body,etag=window.tag())=>({ok:status===200,status,json:async()=>body,headers:{get:key=>key==='ETag'?etag:null}});
window.fetch=async(url,options)=>{if(url!=='/api/shop')throw Error('Unexpected fetch '+url);const owner=window.session.seller?.id;const body=options.body?JSON.parse(options.body):undefined;window.requests.push({url,method:options.method,body,etag:options.headers['If-Match'],owner});
 const snapshot=window.records[owner]?{...window.records[owner]}:null;const tag=window.tag();
 if(options.method==='GET'){if(window.mode==='get-error'||failGet){failGet=false;return reply(503,{error:'Fetch unavailable'})};if(window.mode==='get-expired')return reply(401,{error:'Log in to manage your Shop.'});if(window.mode==='defer-get')return new Promise(resolve=>window.pending.push(()=>resolve(reply(200,snapshot,tag))));return reply(200,snapshot,tag)};
 if(options.method!=='PATCH')throw Error('Unexpected write '+options.method);
 if(window.mode==='expired')return reply(401,{error:'Log in to manage your Shop.'});if(window.mode==='invalid')return reply(400,{error:'Check the Shop profile fields.'});if(window.mode==='save-error')return reply(503,{error:'Save unavailable'});
 if(options.headers['If-Match']!==window.tag())return reply(409,{error:'Your Shop changed elsewhere. Close and reopen this editor to review the latest information.'});
 const commit=()=>{window.records[owner]={...window.records[owner],...body};revision++;return reply(200,{...window.records[owner]})};
 if(window.mode==='defer-patch')return new Promise(resolve=>window.pending.push(()=>resolve(commit())));
 if(window.mode==='lost'){commit();window.mode='normal';throw Error('Response lost')};if(window.mode==='lost-read-fails'){commit();failGet=true;window.mode='normal';throw Error('Response lost')};return commit();};
window.fixtureRequest=async(url,method,body)=>{if(url==='/api/profile/account')return {username:window.username,email:'fixture@uwo.ca',emailVerified:true,createdAt:'2026-10-01',nextUsernameChangeAt:null};if(url.startsWith('/api/auth/username-availability'))return {available:true};if(url==='/api/profile/username'){window.username=body.username;return {username:body.username,next_change_allowed_at:null}};throw Error('Unexpected request '+url)};
function App(){const [n,setN]=useState(0);const [enabled,setEnabled]=useState(true);const [desktop,setDesktop]=useState(innerWidth>=1024);const own=useOwnShopProfile(enabled);window.ownerState=own;window.rerender=()=>setN(x=>x+1);window.reopen=()=>{setEnabled(false);setTimeout(()=>setEnabled(true),30)};useEffect(()=>{const resize=()=>setDesktop(innerWidth>=1024);window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize)},[]);return <LazyMotion features={domAnimation}><div style={{maxWidth:1100,margin:'0 auto',padding:20}} data-branch={desktop?'desktop':'mobile'}><aside aria-label="Unchanged badge"><ShopProBadge/></aside>{enabled&&<ProfileOverview key={(window.session.seller?.id||'anonymous')+'-'+desktop} settings ownShop={own} onAvatarSave={()=>{}} sessionAction={<button>Fixture logout</button>}/>}</div></LazyMotion>};document.body.style.background='#160f1d';createRoot(document.getElementById('root')).render(<App/>);
`
)
async function main() {
  await build(aliases)
  for (const file of ['entry.tsx', 'api.ts'])
    fs.unlinkSync(path.join(root, file))
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const reduced of [false, true])
      for (const width of (process.env.B13_WIDTHS || '390,430,820,1280,1536')
        .split(',')
        .map(Number)) {
        const p = await browser.newPage({
          viewport: { width, height: 900 },
          reducedMotion: reduced ? 'reduce' : 'no-preference',
        })
        const errors = []
        p.on('pageerror', (e) => errors.push(e.message))
        await p.route(/^https?:/, (r) => r.abort())
        await p.goto(
          'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
        )
        const shop = p.getByRole('region', {
          name: 'Shop settings',
          exact: true,
        })
        await shop.getByText('Owner Shop', { exact: true }).waitFor()
        assert.equal(await shop.getByText('PRO', { exact: true }).count(), 0)
        await p
          .getByLabel('Unchanged badge')
          .getByText('PRO', { exact: true })
          .waitFor()
        assert.equal(
          await p.evaluate(() => window.requests.length),
          1,
          'one shared owner GET'
        )
        const fit = async () =>
          assert(
            await p.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth
            ),
            'no horizontal overflow'
          )
        const open = async (field = 'shop name') => {
          await shop
            .getByRole('button', { name: 'Change ' + field, exact: true })
            .click()
          const d = p.getByRole('dialog')
          await d.waitFor()
          await d.evaluate(async (node) => {
            await Promise.all(
              node.getAnimations().map((animation) => animation.finished)
            )
          })
          return d
        }
        const save = async (d) => {
          await d
            .getByRole('button', { name: 'Save changes', exact: true })
            .click()
        }
        const input = (d) =>
          d.getByRole('textbox', { name: 'Shop name', exact: true })
        let d = await open()
        await d
          .getByText('Changes are saved to your Shop profile.', { exact: true })
          .waitFor()
        const geometry = await d.boundingBox()
        assert(geometry.x >= 0 && geometry.x + geometry.width <= width + 1)
        await fit()
        await p.screenshot({
          path: path.join(
            root,
            `b13-editor-${width}-${reduced ? 'reduced' : 'normal'}.png`
          ),
          fullPage: true,
        })
        assert.equal(
          await d.count(),
          1,
          `dialog remains after screenshot ${width}`
        )
        await input(d).fill('')
        assert.equal(
          await d
            .getByRole('button', { name: 'Save changes', exact: true })
            .isDisabled(),
          true
        )
        await input(d).fill('Saved Name')
        await save(d)
        await d.waitFor({ state: 'detached' })
        await shop.getByText('Saved Name', { exact: true }).waitFor()
        assert.deepEqual(
          await p.evaluate(
            () =>
              window.requests.filter((r) => r.method === 'PATCH').at(-1).body
          ),
          { name: 'Saved Name' }
        )
        d = await open('description')
        await d
          .getByRole('textbox', { name: 'Description', exact: true })
          .fill('Updated description')
        await save(d)
        await d.waitFor({ state: 'detached' })
        d = await open('category')
        await d.getByRole('button', { name: 'Category', exact: true }).click()
        await p
          .getByRole('button', { name: 'Collectibles', exact: true })
          .click()
        await save(d)
        await d.waitFor({ state: 'detached' })
        await shop.getByText('Collectibles', { exact: true }).waitFor()
        await p.evaluate(() => window.reopen())
        await shop.getByText('Saved Name', { exact: true }).waitFor()
        await shop.getByText('Updated description', { exact: true }).waitFor()
        await p.screenshot({
          path: path.join(
            root,
            `b13-loaded-${width}-${reduced ? 'reduced' : 'normal'}.png`
          ),
          fullPage: true,
        })
        // Focus refresh errors must not remove an existing draft or confirmed data.
        d = await open()
        await input(d).fill('Unsaved input survives GET failure')
        await p.evaluate(() => {
          window.mode = 'get-error'
          window.dispatchEvent(new Event('focus'))
        })
        await shop
          .getByText(
            'Unable to load Shop settings. Reopen Settings to retry.',
            { exact: true }
          )
          .waitFor()
        assert.equal(
          await input(d).inputValue(),
          'Unsaved input survives GET failure'
        )
        await shop.getByText('Saved Name', { exact: true }).waitFor()
        await p.evaluate(() => {
          window.mode = 'normal'
          window.dispatchEvent(new Event('focus'))
        })
        await shop
          .getByText(
            'Unable to load Shop settings. Reopen Settings to retry.',
            { exact: true }
          )
          .waitFor({ state: 'detached' })
        await p.keyboard.press('Escape')
        await d.waitFor({ state: 'detached' })
        // A GET started before PATCH must not overwrite its confirmed response.
        await p.evaluate(() => {
          window.mode = 'defer-get'
          window.dispatchEvent(new Event('focus'))
        })
        await p.waitForFunction(() => window.pending.length === 1)
        d = await open()
        await input(d).fill('Newer than delayed GET')
        await p.evaluate(() => (window.mode = 'normal'))
        await save(d)
        await d.waitFor({ state: 'detached' })
        await p.evaluate(() => window.pending.shift()())
        await shop
          .getByText('Newer than delayed GET', { exact: true })
          .waitFor()
        // Conflict keeps attempted value and latest confirmed record, never auto-writes.
        d = await open()
        await input(d).fill('Stale attempted name')
        await p.evaluate(() => window.external())
        await save(d)
        await d
          .getByRole('alert')
          .getByText(/changed elsewhere/)
          .waitFor()
        assert.equal(await input(d).inputValue(), 'Stale attempted name')
        await shop.getByText('Changed elsewhere', { exact: true }).waitFor()
        const writes = await p.evaluate(
          () => window.requests.filter((r) => r.method === 'PATCH').length
        )
        await save(d)
        assert.equal(
          await p.evaluate(
            () => window.requests.filter((r) => r.method === 'PATCH').length
          ),
          writes
        )
        await p.keyboard.press('Escape')
        await d.waitFor({ state: 'detached' })
        // Lost PATCH response is confirmed by GET; no duplicate write.
        d = await open()
        await input(d).fill('Lost response confirmed')
        await p.evaluate(() => (window.mode = 'lost'))
        await save(d)
        await d.waitFor({ state: 'detached' })
        await shop
          .getByText('Lost response confirmed', { exact: true })
          .waitFor()
        // Uncertain response + failed reconciliation must GET before next PATCH.
        d = await open()
        await input(d).fill('Retry confirms server')
        await p.evaluate(() => (window.mode = 'lost-read-fails'))
        await save(d)
        await d.getByRole('alert').waitFor()
        const count = await p.evaluate(
          () => window.requests.filter((r) => r.method === 'PATCH').length
        )
        await save(d)
        await d.waitFor({ state: 'detached' })
        assert.equal(
          await p.evaluate(
            () => window.requests.filter((r) => r.method === 'PATCH').length
          ),
          count
        )
        // Failed save retains input/confirmed value; existing retry succeeds.
        d = await open()
        await input(d).fill('Safe retry')
        await p.evaluate(() => (window.mode = 'save-error'))
        await save(d)
        await d.getByRole('alert').waitFor()
        await shop.getByText('Retry confirms server', { exact: true }).waitFor()
        assert.equal(await input(d).inputValue(), 'Safe retry')
        await p.evaluate(() => (window.mode = 'normal'))
        await save(d)
        await d.waitFor({ state: 'detached' })
        // Duplicate programmatic saves are blocked synchronously while pending.
        d = await open()
        await input(d).fill('Pending write')
        await p.evaluate(() => (window.mode = 'defer-patch'))
        await save(d)
        await p.waitForFunction(() => window.pending.length === 1)
        await p.evaluate(() => {
          const b = document.querySelector(
            '[role="dialog"] button[data-state="loading"]'
          )
          b?.click()
        })
        assert.equal(await p.evaluate(() => window.pending.length), 1)
        await p.keyboard.press('Escape')
        assert.equal(await d.count(), 1)
        await p.evaluate(() => {
          window.mode = 'normal'
          window.pending.shift()()
        })
        await d.waitFor({ state: 'detached' })
        // Username authority is independent of Shop Name.
        await p
          .getByRole('button', { name: 'Change username', exact: true })
          .click()
        d = p.getByRole('dialog')
        await d
          .getByRole('textbox', { name: 'Username', exact: true })
          .fill('updated_owner')
        await d
          .getByText('Username available (case-insensitive)', { exact: true })
          .waitFor()
        await d.getByRole('button', { name: 'Save', exact: true }).click()
        await d.waitFor({ state: 'detached' })
        await shop.getByText('/shop/updated_owner', { exact: false }).waitFor()
        await shop.getByText('Pending write', { exact: true }).waitFor()
        // Responsive remount uses the same hook record without another GET.
        const reads = await p.evaluate(
          () => window.requests.filter((r) => r.method === 'GET').length
        )
        await p.setViewportSize({
          width: width < 1024 ? 1280 : 430,
          height: 900,
        })
        await shop.getByText('Pending write', { exact: true }).waitFor()
        assert.equal(
          await p.evaluate(
            () => window.requests.filter((r) => r.method === 'GET').length
          ),
          reads
        )
        await p.setViewportSize({ width, height: 900 })
        await fit()
        // Explicit no-Shop and GET error differ; never provisioning or demo fallback.
        await p.evaluate(() => {
          window.records['owner-a'] = null
          window.reopen()
        })
        await shop
          .getByText('Your account does not have a Shop yet.', { exact: true })
          .waitFor()
        assert.equal(await shop.getByRole('button').count(), 0)
        await p.evaluate(() => {
          window.mode = 'get-error'
          window.reopen()
        })
        await shop
          .getByText(
            'Unable to load Shop settings. Reopen Settings to retry.',
            { exact: true }
          )
          .waitFor()
        await p.evaluate(() => {
          window.mode = 'defer-get'
          window.reopen()
        })
        await shop
          .getByText('Loading Shop settings…', { exact: true })
          .waitFor()
        await p.waitForFunction(() => window.pending.length === 1)
        // Switching owner invalidates delayed GET and resets authoritative username.
        await p.evaluate(() => {
          window.mode = 'normal'
          window.session = {
            seller: { id: 'owner-b' },
            loading: false,
            error: '',
          }
          window.username = 'second_owner'
          window.rerender()
        })
        await shop.getByText('Second Owner', { exact: true }).waitFor()
        await p.evaluate(() => window.pending.shift()())
        await shop.getByText('Second Owner', { exact: true }).waitFor()
        await shop.getByText('/shop/second_owner', { exact: false }).waitFor()
        // Old PATCH completion cannot populate a newly selected account.
        d = await open()
        await input(d).fill('Old account request')
        await p.evaluate(() => (window.mode = 'defer-patch'))
        await save(d)
        await p.waitForFunction(() => window.pending.length === 1)
        await p.evaluate(() => {
          window.mode = 'normal'
          window.records['owner-a'] = {
            ...window.records['owner-b'],
            ownerId: 'owner-a',
            id: 'shop-owner-a',
            name: 'Restored owner',
          }
          window.session = {
            seller: { id: 'owner-a' },
            loading: false,
            error: '',
          }
          window.rerender()
        })
        await shop.getByText('Restored owner', { exact: true }).waitFor()
        await p.evaluate(() => window.pending.shift()())
        await shop.getByText('Restored owner', { exact: true }).waitFor()
        assert.equal(
          await shop.getByText('Old account request', { exact: true }).count(),
          0
        )
        d = await open()
        await input(d).fill('Expired write')
        await p.evaluate(() => (window.mode = 'expired'))
        await save(d)
        await shop
          .getByText('Log in to manage your Shop.', { exact: true })
          .waitFor()
        await d.waitFor({ state: 'detached' })
        assert.equal(
          await shop.getByText('Restored owner', { exact: true }).count(),
          0
        )
        await p.evaluate(() =>
          window.dispatchEvent(new Event('marketplace-session-ended'))
        )
        const before = await p.evaluate(() => window.requests.length)
        await p.evaluate(() => window.dispatchEvent(new Event('focus')))
        assert.equal(await p.evaluate(() => window.requests.length), before)
        assert(
          await p.evaluate(() =>
            window.requests.every(
              (r) => r.method === 'GET' || r.method === 'PATCH'
            )
          ),
          'no provisioning, membership, publication or Resale writes'
        )
        await fit()
        assert.deepEqual(errors, [])
        await p.screenshot({
          path: path.join(
            root,
            `b13-settings-${width}-${reduced ? 'reduced' : 'normal'}.png`
          ),
          fullPage: true,
        })
        console.log(
          `PASS B13 real components ${width} reduced=${reduced}: owner GET/partial PATCH/persistence, conflicts, lost response/retry, duplicate guard, session/account isolation, shared responsive state, unchanged badge elsewhere, no overflow`
        )
        await p.close()
      }
  } finally {
    await browser.close()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
