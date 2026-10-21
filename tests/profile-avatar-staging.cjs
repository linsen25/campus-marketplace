/* global Request, document, innerWidth */
// Explicitly authorized B03 run only. Local server + actual app handlers, real
// Staging Auth/Storage/RPC; never SMTP, payments or an externally deployed app.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto'),
  http = require('node:http'),
  ts = require('typescript'),
  { spawnSync } = require('node:child_process'),
  sharp = require('sharp')
const { createClient } = require('@supabase/supabase-js')
assert.equal(process.env.B03_STAGING_WRITE_APPROVED, '1')
const ref = 'pcaqxezdfxofysghssyo',
  remote = `https://${ref}.supabase.co`
const env = require('../scripts/v2-maintenance-staging.cjs').environment()
for (const name of [
  'APP_ENV',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
])
  process.env[name] = env[name]
const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
}
const nativeFetch = global.fetch
let localOrigin,
  failObject = null
global.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  assert(
    [remote, localOrigin].includes(url.origin),
    'Only exact Staging/local origins'
  )
  assert(
    ![
      '/auth/v1/signup',
      '/auth/v1/recover',
      '/auth/v1/resend',
      '/auth/v1/otp',
    ].includes(url.pathname),
    'No email endpoints'
  )
  if (
    failObject &&
    url.pathname.includes(failObject) &&
    init?.method === 'POST'
  ) {
    failObject = null
    return Promise.resolve(
      new Response(JSON.stringify({ message: 'Injected upload failure' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    )
  }
  return nativeFetch(input, init)
}
const admin = createClient(remote, env.SUPABASE_SERVICE_ROLE_KEY, options)
const cache = new Map()
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full)
  const m = { exports: {} }
  cache.set(full, m.exports)
  new Function(
    'require',
    'module',
    'exports',
    ts.transpileModule(fs.readFileSync(full, 'utf8'), {
      compilerOptions: { module: 1, target: 7, esModuleInterop: true },
    }).outputText
  )(
    (name) =>
      name.startsWith('@/')
        ? load(name.slice(2) + '.ts')
        : name.startsWith('.')
        ? load(path.resolve(path.dirname(full), name + '.ts'))
        : require(name),
    m,
    m.exports
  )
  return m.exports
}
const handlers = {
  auth: load('pages/api/auth/[action].ts').default,
  account: load('pages/api/profile/account.ts').default,
  upload: load('pages/api/profile/avatar.ts').default,
  image: load('pages/api/profile/avatar/[id].ts').default,
}
const service = load('lib/server/profile-avatar-service.ts'),
  seller = load('lib/server/public-seller.ts')
const runId = crypto.randomUUID(),
  folder = path.resolve('tests/artifacts/b03-live-' + runId)
fs.mkdirSync(folder, { recursive: true })
const users = [],
  checks = [],
  actions = new Set()
let step = 'initial',
  cleanupComplete = false,
  server,
  browser
const save = () =>
  fs.writeFileSync(
    path.join(folder, 'result.json'),
    JSON.stringify(
      {
        runId,
        projectRef: ref,
        step,
        checks,
        users: users.map((u) => ({ id: u.id, cleaned: u.cleaned })),
        cleanupComplete,
      },
      null,
      2
    )
  )
function pass(text) {
  checks.push(text)
  save()
  console.log('PASS ' + text)
}
async function ok(p) {
  const r = await p
  assert(!r.error, 'Provider rejected at ' + step)
  return r.data
}
function query(sql) {
  const file = path.join(folder, 'operation.sql')
  fs.writeFileSync(file, sql)
  const r = spawnSync(
    process.execPath,
    [
      'tests/artifacts/scheduler-staging-query.cjs',
      file,
      path.join(folder, 'query-result.json'),
    ],
    { windowsHide: true, encoding: 'utf8', timeout: 60000 }
  )
  assert.equal(r.status, 0, 'Explicit Staging query failed')
  return JSON.parse(
    fs.readFileSync(path.join(folder, 'query-result.json'), 'utf8')
  ).rows
}
async function start() {
  const { root, build } = require('./message-payload.browser.cjs')
  const aliases = require('./browser-fixture-mocks.cjs')(root)
  fs.writeFileSync(
    path.join(root, 'request-mock.js'),
    `export async function marketplaceRequest(url,method,body){const r=await fetch(url,{method,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Marketplace-Request':'1'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Error(data.error||'Request failed');return data}`
  )
  fs.writeFileSync(
    path.join(root, 'entry.tsx'),
    `
 import 'tailwindcss/src/css/preflight.css';import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {LazyMotion,domAnimation} from 'framer-motion';import {AvatarDialog,ProfileAvatar} from '@/components/home/profile-avatar';import {useProfileAvatar} from '@/hooks/use-profile-avatar';
 function App({owner}){const {avatarImage,saveAvatar}=useProfileAvatar(owner);const [open,setOpen]=useState(false);return <LazyMotion features={domAnimation}><div data-avatar-account><ProfileAvatar username="B03 fixture" image={avatarImage}/><button onClick={()=>setOpen(true)}>Set avatar</button></div>{open&&<AvatarDialog username="B03 fixture" onSave={saveAvatar} onClose={()=>setOpen(false)}/>}</LazyMotion>}
 fetch('/api/auth/session').then(r=>r.json()).then(data=>createRoot(document.getElementById('root')).render(<App owner={data.seller?.id}/>));document.body.style.background='#0b0b0b';document.body.style.color='white';`
  )
  await build(aliases)
  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, localOrigin || 'http://localhost')
      req.query = Object.fromEntries(url.searchParams)
      res.status = (n) => {
        res.statusCode = n
        return res
      }
      res.json = (value) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(value))
        return res
      }
      res.send = (value) => {
        res.end(value)
        return res
      }
      if (url.pathname === '/') {
        res.setHeader('Content-Type', 'text/html')
        return res.end(
          '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:12px}</style><div id="root"></div><script>window.process={env:{NODE_ENV:"development"}}</script><script src="/bundle.js"></script>'
        )
      }
      if (url.pathname === '/bundle.js') {
        res.setHeader('Content-Type', 'application/javascript')
        return res.end(fs.readFileSync(path.join(root, 'bundle.js')))
      }
      if (url.pathname.startsWith('/api/auth/')) {
        req.query.action = url.pathname.split('/').pop()
        if (req.method === 'POST') {
          const chunks = []
          for await (const c of req) chunks.push(c)
          req.body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
        }
        return await handlers.auth(req, res)
      }
      if (url.pathname === '/api/profile/account')
        return await handlers.account(req, res)
      if (url.pathname === '/api/profile/avatar')
        return await handlers.upload(req, res)
      if (url.pathname.startsWith('/api/profile/avatar/')) {
        req.query.id = url.pathname.split('/').pop()
        return await handlers.image(req, res)
      }
      res.statusCode = 404
      res.end()
    } catch {
      res.statusCode = 500
      res.end('Local fixture request failed')
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  localOrigin = 'http://127.0.0.1:' + server.address().port
}
async function login(ctx, u) {
  const r = await ctx.request.post(localOrigin + '/api/auth/sign-in', {
    headers: { Origin: localOrigin, 'X-Marketplace-Request': '1' },
    data: { email: u.email, password: u.password },
  })
  assert.equal(r.status(), 200, 'local actual Auth sign-in')
}
async function account(ctx) {
  const r = await ctx.request.get(localOrigin + '/api/profile/account')
  assert.equal(r.status(), 200)
  return r.json()
}
async function upload(
  ctx,
  bytes,
  type,
  version,
  action = crypto.randomUUID(),
  expected = 200
) {
  actions.add(action)
  const r = await ctx.request.post(localOrigin + '/api/profile/avatar', {
    headers: {
      Origin: localOrigin,
      'X-Marketplace-Request': '1',
      'Content-Type': type,
      'X-Avatar-Action': action,
      'X-Avatar-Version': version || 'none',
    },
    data: bytes,
  })
  assert.equal(r.status(), expected, 'avatar upload at ' + step)
  return { body: await r.json(), action }
}
async function main() {
  save()
  try {
    step = 'local application fixture'
    await start()
    const {
      chromium,
    } = require('./artifacts/browser-tools/node_modules/playwright-core')
    browser = await chromium.launch({
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: true,
    })
    step = 'create only run-scoped accounts'
    for (let i = 0; i < 2; i++) {
      const u = {
        email: `b03-${runId}-${i}@uwo.ca`,
        password: crypto.randomBytes(20).toString('hex') + 'Aa1!',
        username: 'B03_' + runId.replaceAll('-', '').slice(0, 10) + i,
      }
      const data = await ok(
        admin.auth.admin.createUser({
          email: u.email,
          password: u.password,
          email_confirm: true,
          user_metadata: { username: u.username, b03QualificationRun: runId },
        })
      )
      u.id = data.user.id
      users.push(u)
      save()
      u.context = await browser.newContext()
      await login(u.context, u)
    }
    const [a, b] = users,
      ctx = a.context
    const fallbackPage = await b.context.newPage()
    await fallbackPage.goto(localOrigin)
    await fallbackPage
      .getByRole('button', { name: 'Set avatar', exact: true })
      .waitFor()
    assert.equal(
      await fallbackPage.locator('[data-avatar-account] img').count(),
      0
    )
    assert.equal(
      await fallbackPage
        .locator('[data-avatar-account] [role=img]')
        .textContent(),
      'B'
    )
    await fallbackPage.close()
    pass(
      'Two no-email disposable users authenticate through unchanged Auth handler'
    )
    const raw = sharp({
        create: { width: 80, height: 60, channels: 3, background: '#608e72' },
      }),
      png = await raw.clone().png().toBuffer(),
      jpeg = await raw.clone().jpeg().toBuffer(),
      webp = await raw.clone().webp().toBuffer()
    step = 'fallback and three real formats'
    assert.equal((await account(ctx)).avatarUrl, null)
    let current = await account(ctx)
    for (const [bytes, type] of [
      [jpeg, 'image/jpeg'],
      [png, 'image/png'],
      [webp, 'image/webp'],
    ]) {
      const result = await upload(ctx, bytes, type, current.avatarVersion)
      current = result.body
      const image = await nativeFetch(localOrigin + current.avatarUrl)
      assert.equal(image.status, 200)
      assert.equal(image.headers.get('content-type'), 'image/webp')
      const meta = await sharp(
        Buffer.from(await image.arrayBuffer())
      ).metadata()
      assert.equal(meta.format, 'webp')
      assert(!meta.exif)
    }
    pass(
      'JPEG/PNG/WebP actual Sharp conversion, private Storage upload, canonical anonymous image read'
    )
    step = 'invalid and failed replacement'
    for (const [bytes, type, status] of [
      [Buffer.from('<svg/>'), 'image/svg+xml', 400],
      [png.subarray(0, 18), 'image/png', 400],
      [Buffer.alloc(3 * 1024 * 1024 + 1), 'image/png', 413],
    ])
      await upload(ctx, bytes, type, current.avatarVersion, undefined, status)
    const failed = crypto.randomUUID()
    failObject = failed
    await upload(ctx, png, 'image/png', current.avatarVersion, failed, 503)
    assert.equal((await account(ctx)).avatarUrl, current.avatarUrl)
    const retry = await upload(
      ctx,
      png,
      'image/png',
      current.avatarVersion,
      failed
    )
    current = retry.body
    const duplicate = await upload(
      ctx,
      png,
      'image/png',
      current.avatarVersion === failed
        ? (
            await query(
              `begin read only;select expected_path from marketplace_private.profile_avatar_uploads where id='${failed}';rollback;`
            )
          )[0].expected_path
            ?.split('/')[1]
            ?.slice(0, -5)
        : null,
      failed
    )
    assert.equal(duplicate.body.avatarUrl, current.avatarUrl)
    pass(
      'Invalid/oversized/corrupt rejection; injected Storage failure preserves avatar; same-action retry/deduplication'
    )
    step = 'cross-user and public access'
    const aSession = await ok(
      createClient(
        remote,
        env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        options
      ).auth.signInWithPassword({ email: a.email, password: a.password })
    )
    const userClient = createClient(remote, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      ...options,
      global: {
        headers: { Authorization: 'Bearer ' + aSession.session.access_token },
      },
    })
    assert(
      (
        await userClient.rpc('marketplace_commit_profile_avatar', {
          p_owner: b.id,
          p_action: failed,
        })
      ).error
    )
    assert(
      (
        await userClient
          .from('profiles')
          .update({ avatar_path: `${b.id}/${failed}.webp` })
          .eq('id', b.id)
      ).error
    )
    assert(
      (
        await userClient.storage
          .from('profile-avatars')
          .upload(`${b.id}/${crypto.randomUUID()}.webp`, webp, {
            contentType: 'image/webp',
          })
      ).error
    )
    assert(
      (
        await userClient.storage
          .from('profile-avatars')
          .download(`${a.id}/${failed}.webp`)
      ).error
    )
    const anon = createClient(
      remote,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      options
    )
    assert(
      (
        await anon.storage
          .from('profile-avatars')
          .download(`${a.id}/${failed}.webp`)
      ).error
    )
    assert(
      !(
        await nativeFetch(
          remote +
            `/storage/v1/object/public/profile-avatars/${a.id}/${failed}.webp`
        )
      ).ok
    )
    assert.equal((await account(b.context)).avatarUrl, null)
    const publicA = await seller.getPublicSeller(a.id)
    assert.equal(publicA.avatarUrl, current.avatarUrl)
    assert.equal(
      (await seller.getPublicSeller(a.username)).avatarUrl,
      current.avatarUrl
    )
    assert.equal(
      (await nativeFetch(localOrigin + current.avatarUrl + '&path=arbitrary'))
        .status,
      404
    )
    pass(
      'Cross-user RPC/Profile/Storage mutations denied; authenticated and anonymous direct private reads denied; Seller UUID/username projections match'
    )
    step = 'concurrent replacement'
    const old = crypto.randomUUID(),
      next = crypto.randomUUID()
    actions.add(old)
    actions.add(next)
    const decoded = await service.decodeAvatar(png, 'image/png')
    const prepare = (id) =>
      ok(
        admin.rpc('marketplace_prepare_profile_avatar', {
          p_owner: a.id,
          p_action: id,
          p_expected: current.avatarVersion,
          p_source_sha256: decoded.sourceHash,
          p_stored_sha256: decoded.storedHash,
          p_size: decoded.stored.length,
        })
      )
    await prepare(old)
    await prepare(next)
    await Promise.all(
      [old, next].map((id) =>
        ok(
          admin.storage
            .from('profile-avatars')
            .upload(`${a.id}/${id}.webp`, decoded.stored, {
              contentType: 'image/webp',
            })
        )
      )
    )
    const settled = await Promise.all([
      admin.rpc('marketplace_commit_profile_avatar', {
        p_owner: a.id,
        p_action: old,
      }),
      admin.rpc('marketplace_commit_profile_avatar', {
        p_owner: a.id,
        p_action: next,
      }),
    ])
    assert(settled[0].error)
    assert(!settled[1].error)
    current = await account(ctx)
    assert.equal(current.avatarVersion, next)
    assert.equal(
      (await nativeFetch(localOrigin + publicA.avatarUrl)).status,
      404
    )
    pass(
      'Two real concurrent commits: newer prepared intent wins, late older request rejected, former public URL denied'
    )
    step = 'browser refresh relogin responsive'
    for (const width of [390, 430, 820, 1280, 1536]) {
      const p = await ctx.newPage()
      await p.setViewportSize({ width, height: 900 })
      await p.route('**/*', (r) => {
        const u = new URL(r.request().url())
        return [localOrigin, 'data:', 'blob:'].includes(u.origin) ||
          ['data:', 'blob:'].includes(u.protocol)
          ? r.continue()
          : r.abort()
      })
      await p.goto(localOrigin)
      await p.locator('[data-avatar-account] img').waitFor()
      await p.getByRole('button', { name: 'Set avatar', exact: true }).click()
      await p
        .locator('input[type=file]')
        .setInputFiles({ name: 'b03.png', mimeType: 'image/png', buffer: png })
      await p.getByRole('button', { name: 'Save', exact: true }).click()
      await p.getByRole('dialog').waitFor({ state: 'detached' })
      await p.reload()
      await p.locator('[data-avatar-account] img').waitFor()
      await p.waitForFunction(() => {
        const image = document.querySelector('[data-avatar-account] img')
        return image?.complete && image.naturalWidth > 0
      })
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      )
      await p.screenshot({
        path: path.join(folder, 'avatar-' + width + '.png'),
      })
      await p.close()
    }
    current = await account(ctx)
    const out = await ctx.request.post(localOrigin + '/api/auth/sign-out', {
      headers: { Origin: localOrigin, 'X-Marketplace-Request': '1' },
    })
    assert.equal(out.status(), 200)
    await login(ctx, a)
    assert.equal((await account(ctx)).avatarUrl, current.avatarUrl)
    pass(
      'Real browser upload/refresh at 390/430/820/1280/1536, no overflow; canonical avatar persists after logout/relogin'
    )
    step = 'completed'
  } finally {
    for (const u of users) {
      const found = await admin.auth.admin.getUserById(u.id)
      assert.equal(
        found.data.user?.user_metadata?.b03QualificationRun,
        runId,
        'Cleanup exact run only'
      )
      // Account deletion releases the sole official pointer first; then delete only
      // names listed within this run-owned UUID prefix. Never a bucket-wide delete.
      await ok(admin.auth.admin.deleteUser(u.id))
      const objects = await ok(
        admin.storage.from('profile-avatars').list(u.id, { limit: 100 })
      )
      assert(objects.length < 100)
      const paths = objects.map((o) => {
        assert(/^[0-9a-f-]{36}\.webp$/.test(o.name))
        return u.id + '/' + o.name
      })
      if (paths.length)
        await ok(admin.storage.from('profile-avatars').remove(paths))
      assert.equal(
        (
          await ok(
            admin.storage.from('profile-avatars').list(u.id, { limit: 100 })
          )
        ).length,
        0
      )
      const rows = query(
        `begin;delete from marketplace_private.profile_avatar_uploads where owner_id='${u.id}' and not exists(select 1 from public.profiles where id='${u.id}');commit;begin read only;select (select count(*) from marketplace_private.profile_avatar_uploads where owner_id='${u.id}') uploads,(select count(*) from storage.objects where bucket_id='profile-avatars' and name like '${u.id}/%') objects,(select count(*) from public.profiles where id='${u.id}') profiles,(select count(*) from auth.users where id='${u.id}') users;rollback;`
      )[0]
      assert(Object.values(rows).every((v) => v === 0))
      u.cleaned = true
      save()
    }
    cleanupComplete = true
    save()
    await browser?.close()
    if (server) await new Promise((resolve) => server.close(resolve))
    console.log('PASS exact B03 account/object/upload-record cleanup')
  }
}
main().catch(() => {
  save()
  console.error(
    'B03 stopped at ' +
      step +
      '; sanitized journal ' +
      path.join(folder, 'result.json')
  )
  process.exitCode = 1
})
