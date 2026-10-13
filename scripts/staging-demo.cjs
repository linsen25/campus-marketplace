/* global fetch */
// Real hosted STAGING fixtures only. Never prints secrets or persists sessions.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')
const assert = require('node:assert/strict')
const { createClient } = require('@supabase/supabase-js')
const sharp = require('sharp')
const ref = 'pcaqxezdfxofysghssyo'
const project = 'western-marketplace-staging'
const url = `https://${ref}.supabase.co`
const marker = 'campus-marketplace-staging-demo-v1'
const root = path.resolve('tests/artifacts/staging-demo')
const stateFile = path.join(root, 'state.json')
const credentialFile = path.join(root, 'credentials.json')
const roles = ['seller-a', 'seller-b', 'buyer-a', 'buyer-b']
const catalog = [
  [
    'macbook',
    'seller-a',
    'MacBook Air M2',
    75000,
    'Electronics',
    'Computers & Tablets',
    '#d7dcec',
  ],
  [
    'nike',
    'seller-a',
    'Nike Dunk Low',
    8000,
    'Clothing & Accessories',
    'Shoes',
    '#dce5cf',
  ],
  [
    'lamp',
    'seller-a',
    'Desk Lamp',
    2500,
    'Home & Dorm',
    'Lighting & Decor',
    '#ecd9c6',
  ],
  [
    'controller',
    'seller-b',
    'PS5 Controller',
    5500,
    'Electronics',
    'Gaming & Consoles',
    '#d3dded',
  ],
  [
    'textbook',
    'seller-b',
    'Calculus Textbook',
    4000,
    'Textbooks & School',
    'Textbooks',
    '#efd7d6',
  ],
  [
    'monitor',
    'seller-b',
    '24-inch Monitor',
    12000,
    'Electronics',
    'Monitors',
    '#d9d4eb',
  ],
]
const q = (value) => "'" + String(value).replaceAll("'", "''") + "'"
const uuid = (value) => /^[0-9a-f-]{36}$/i.test(value)
function nonce(key) {
  const hex = crypto
    .createHash('sha256')
    .update(marker + ':' + key)
    .digest('hex')
    .slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(
    13,
    16
  )}-a${hex.slice(17, 20)}-${hex.slice(20)}`
}
function guard(info, keys) {
  assert.equal(info.ref || info.id, ref, 'Refusing a non-staging project')
  assert.equal(info.name, project, 'Refusing an unexpected project name')
  for (const [key, role] of [
    [keys.publicKey, 'anon'],
    [keys.secret, 'service_role'],
  ]) {
    const claims = JSON.parse(Buffer.from(key.split('.')[1] || '', 'base64url'))
    assert.equal(claims.ref, ref, 'Refusing a cross-project credential')
    assert.equal(claims.role, role, 'Refusing an incorrect credential role')
  }
}
function configureStagingLocal(keys) {
  const file = path.resolve('.env.staging.local')
  assert.equal(
    spawnSync('git', ['check-ignore', file], { stdio: 'ignore' }).status,
    0,
    'Staging credentials must be ignored'
  )
  const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const lines = old.split(/\r?\n/)
  const values = Object.fromEntries(
    lines
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const i = line.indexOf('=')
        return [
          line.slice(0, i),
          line
            .slice(i + 1)
            .trim()
            .replace(/^['"]|['"]$/g, ''),
        ]
      })
  )
  assert(
    !values.NEXT_PUBLIC_SUPABASE_URL || values.NEXT_PUBLIC_SUPABASE_URL === url,
    'Existing staging config points elsewhere; refusing overwrite'
  )
  if (values.SUPABASE_SERVICE_ROLE_KEY)
    guard(
      { ref, name: project },
      { ...keys, secret: values.SUPABASE_SERVICE_ROLE_KEY }
    )
  const managed = [
    'APP_ENV',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]
  const retained = lines.filter(
    (line) => line && !managed.some((name) => line.startsWith(name + '='))
  )
  const temporary = path.join(root, 'staging-config.tmp')
  fs.writeFileSync(
    temporary,
    retained
      .concat([
        'APP_ENV=staging',
        `NEXT_PUBLIC_SUPABASE_URL=${url}`,
        `NEXT_PUBLIC_SUPABASE_ANON_KEY=${keys.publicKey}`,
        `SUPABASE_SERVICE_ROLE_KEY=${keys.secret}`,
      ])
      .join('\n') + '\n',
    { mode: 0o600 }
  )
  fs.renameSync(temporary, file)
  console.log(
    'Ignored staging app configuration verified/prepared; production .env.local unchanged. No key values printed.'
  )
}
function save(file, data) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2), {
    mode: 0o600,
  })
  fs.renameSync(file + '.tmp', file)
}
function cli(args) {
  const result = spawnSync(
    process.platform === 'win32' ? 'cmd.exe' : 'npx',
    process.platform === 'win32'
      ? ['/d', '/c', 'npx.cmd', '--no-install', 'supabase', ...args]
      : ['--no-install', 'supabase', ...args],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 }
  )
  if (result.status !== 0)
    throw Error('Staging CLI operation failed; details withheld')
  const output = result.stdout.trim()
  return JSON.parse(output)
}
let serial = 0
function query(sql) {
  const file = path.join(root, `query-${serial++}.sql`)
  fs.writeFileSync(file, sql)
  try {
    return cli([
      'db',
      'query',
      '--linked',
      '--project-ref',
      ref,
      '--file',
      file,
      '--output',
      'json',
    ]).rows
  } finally {
    fs.unlinkSync(file)
  }
}
async function checked(promise, label) {
  const result = await promise
  if (result.error)
    throw Error(
      `${label} failed (${
        result.error.code || result.error.status || 'provider'
      }); details withheld`
    )
  return result.data
}
function owned(user) {
  return (
    user.app_metadata?.demo_system === marker &&
    roles.includes(user.app_metadata?.demo_role)
  )
}
function verifyDataset(state) {
  const ids = Object.values(state.users)
  assert.equal(ids.length, 4)
  assert(ids.every(uuid))
  const set = ids.map(q).join(',')
  const data = query(
    `select (select count(*) from public.listings where seller_id in (${set})) as listings,(select count(*) from public.listings where seller_id in (${set}) and published_at is not null and status='available') as available,(select count(*) from public.listings where seller_id in (${set}) and status='sold') as sold,(select count(*) from public.listing_images i join public.listings l on l.id=i.listing_id where l.seller_id in (${set}) and i.ready) as listing_images,(select count(*) from public.listing_favorites where user_id in (${set})) as favorites,(select count(*) from public.conversations where buyer_id in (${set}) and seller_id in (${set})) as conversations,(select count(*) from public.messages where sender_id in (${set}) and type='IMAGE') as image_messages;`
  )[0]
  assert.equal(Number(data.listings), 6)
  assert.equal(Number(data.available), 5)
  assert.equal(Number(data.sold), 1)
  assert(
    Number(data.listing_images) >= 7 &&
      Number(data.favorites) >= 5 &&
      Number(data.conversations) >= 4 &&
      Number(data.image_messages) >= 1,
    'Dataset incomplete; stop rather than duplicate'
  )
  console.log('Staging dataset inventory verified: ' + JSON.stringify(data))
}
async function users(admin) {
  const result = []
  for (let page = 1; ; page++) {
    const data = await checked(
      admin.auth.admin.listUsers({ page, perPage: 1000 }),
      'List staging identities'
    )
    result.push(...data.users.filter(owned))
    if (data.users.length < 1000) break
  }
  for (const role of roles)
    assert(
      result.filter((u) => u.app_metadata.demo_role === role).length <= 1,
      'Duplicate marker: stop for manual review'
    )
  for (const user of result) {
    assert(uuid(user.id))
    assert.equal(
      user.email,
      `${marker}-${user.app_metadata.demo_role}@uwo.ca`,
      'Demo email ownership mismatch'
    )
  }
  return result
}
async function image(item, variant = 0) {
  const [key, , title, , , , color] = item
  const shapes = {
    macbook:
      '<rect x="200" y="125" width="400" height="260" rx="16" fill="#485269"/><rect x="220" y="145" width="360" height="215" rx="5" fill="#aabed8"/><path d="M155 390h490l-35 40H190z" fill="#8391a7"/>',
    nike: '<path d="M180 320l90-90 90 35 65 58 135 25q65 30 50 65H175q-35-30 5-93z" fill="#f8f7f2" stroke="#475640" stroke-width="12"/><path d="M320 338q65 35 155-30l-125 75q-65 20-30-45z" fill="#344334"/>',
    lamp: '<path d="M320 210l160-85 110 110-185 80z" fill="#495450"/><path d="M430 290l-60 120" stroke="#495450" stroke-width="18"/><ellipse cx="365" cy="425" rx="130" ry="25" fill="#495450"/>',
    controller:
      '<path d="M245 235q155-65 310 0l65 150q-15 70-80 20l-40-50H300l-40 50q-65 50-80-20z" fill="#fafafa" stroke="#555e71" stroke-width="12"/><path d="M260 260v65m-32-32h64" stroke="#555e71" stroke-width="15"/><circle cx="540" cy="280" r="15" fill="#8f90bb"/><circle cx="500" cy="320" r="15" fill="#8f90bb"/>',
    textbook:
      '<rect x="255" y="120" width="290" height="330" rx="12" fill="#54776b"/><rect x="255" y="120" width="28" height="330" fill="#365b50"/><text x="310" y="230" fill="white" font-size="35">CALCULUS</text><text x="310" y="290" fill="#bce0cc" font-size="55">f(x)</text>',
    monitor:
      '<rect x="190" y="130" width="420" height="265" rx="14" fill="#41495e"/><rect x="207" y="147" width="386" height="225" fill="#9eb0ce"/><path d="M400 395v45m-90 10h180" stroke="#41495e" stroke-width="18"/>',
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="${color}"/><ellipse cx="400" cy="450" rx="250" ry="35" fill="#000" opacity=".08"/><g transform="translate(${
    variant * 8
  } 0)">${
    shapes[key]
  }</g><text x="40" y="60" fill="#384052" font-family="sans-serif" font-size="26">${title}</text><text x="40" y="565" fill="#566075" font-family="sans-serif" font-size="17">STAGING DEMO · Synthetic illustration · Not for sale</text></svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}
async function serve(keys, port = 0) {
  // Same app/API implementation, isolated dev output; never reads production keys.
  const child = spawn(
    process.execPath,
    [
      '-e',
      `
    const http=require('http');const next=require('next');const configExport=require('./next.config.js');
    const config=typeof configExport==='function'?configExport('phase-development-server',{defaultConfig:require('next/dist/server/config-shared').defaultConfig}):configExport;
    const app=next({dev:true,conf:{...config,distDir:'tests/artifacts/staging-demo/runtime'}});
    const original=global.fetch;global.fetch=(input,options)=>{const u=new URL(typeof input==='string'?input:input.url);if(u.origin!=='${url}')throw Error('Non-staging hosted request blocked');return original(input,options).then(async response=>{if(!response.ok){let body={};try{body=await response.clone().json()}catch{}const raw=String(body.code||body.error||body.statusCode||'unknown');const code=/^[A-Za-z0-9 _-]{1,60}$/.test(raw)?raw:'redacted';console.log('DEMO_REMOTE_STATUS:'+JSON.stringify({service:u.pathname.split('/')[1],status:response.status,code}))}return response})};
    app.prepare().then(()=>http.createServer(app.getRequestHandler()).listen(${port},'127.0.0.1',function(){console.log('DEMO_READY:'+this.address().port)}));
  `,
    ],
    {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        NODE_OPTIONS: '--openssl-legacy-provider',
        APP_ENV: 'staging',
        ORDER_PREVIEW_MODE: port === 3112 ? 'frozen-viewer' : '',
        NEXT_PUBLIC_SUPABASE_URL: url,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: keys.publicKey,
        SUPABASE_SERVICE_ROLE_KEY: keys.secret,
      },
    }
  )
  let output = ''
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(Error('Isolated staging app startup timeout'))
    }, 90000)
    child.on('error', () => {
      clearTimeout(timer)
      reject(Error('Staging app launch failed'))
    })
    child.on('exit', () => {
      clearTimeout(timer)
      reject(Error('Staging app exited before readiness'))
    })
    child.stdout.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/))
        if (line.startsWith('DEMO_REMOTE_STATUS:')) console.log(line)
      output += chunk
      const found = output.match(/DEMO_READY:(\d+)/)
      if (found) {
        clearTimeout(timer)
        resolve(`http://127.0.0.1:${found[1]}`)
        output = ''
      }
    })
  })
  child.on('exit', (code) => {
    if (!child.demoStopping)
      console.log('Temporary staging API exited unexpectedly: ' + code)
  })
  return { child, base }
}
function session(base) {
  const cookies = new Map()
  return async (
    endpoint,
    body,
    method = body === undefined ? 'GET' : 'POST',
    binary = false
  ) => {
    const response = await fetch(base + endpoint, {
      method,
      redirect: 'error',
      headers: {
        Connection: 'close',
        Origin: base,
        'X-Marketplace-Request': '1',
        Cookie: [...cookies].map(([k, v]) => k + '=' + v).join('; '),
        ...(body !== undefined
          ? { 'Content-Type': binary ? 'image/png' : 'application/json' }
          : {}),
      },
      ...(body !== undefined
        ? { body: binary ? body : JSON.stringify(body) }
        : {}),
    })
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(';')[0],
        split = pair.indexOf('=')
      cookies.set(pair.slice(0, split), pair.slice(split + 1))
    }
    if (!response.ok)
      throw Error(
        `Staging API ${endpoint.split('?')[0]} failed (HTTP ${
          response.status
        }); details withheld`
      )
    return response.json()
  }
}
async function seed(admin, keys, existing, state, credentials) {
  for (const role of roles) {
    let user = existing.find((u) => u.app_metadata.demo_role === role)
    const email = `${marker}-${role}@uwo.ca`
    if (!credentials[role]) {
      credentials[role] = {
        email,
        password: crypto.randomBytes(24).toString('hex') + 'Aa9!',
        username: 'Demo_' + role.replace('-', '_'),
      }
      save(credentialFile, credentials)
      if (user)
        await checked(
          admin.auth.admin.updateUserById(user.id, {
            password: credentials[role].password,
          }),
          'Recover own demo credentials'
        )
    }
    assert.equal(
      credentials[role].email,
      email,
      'Local demo credential email mismatch'
    )
    assert.equal(
      credentials[role].username,
      'Demo_' + role.replace('-', '_'),
      'Local demo username mismatch'
    )
    if (!user) {
      const data = await checked(
        admin.auth.admin.createUser({
          email,
          password: credentials[role].password,
          email_confirm: true,
          user_metadata: { username: credentials[role].username },
          app_metadata: { demo_system: marker, demo_role: role },
        }),
        'Create synthetic verified demo identity'
      )
      user = data.user
    }
    credentials[role].id = user.id
    state.users[role] = user.id
    save(credentialFile, credentials)
    save(stateFile, state)
  }
  if (state.complete) {
    verifyDataset(state)
    console.log(
      'Existing complete dataset retained; no duplicate inserts or read-state reset.'
    )
    return
  }
  const { child, base } = await serve(keys)
  try {
    console.log('Staging demo API ready; resuming marked fixture operations.')
    const api = {}
    for (const role of roles) {
      api[role] = session(base)
      await api[role]('/api/auth/sign-in', {
        email: credentials[role].email,
        password: credentials[role].password,
      })
      const identity = await api[role]('/api/auth/session')
      assert.equal(
        identity.seller?.id,
        state.users[role],
        'Demo session identity mismatch'
      )
    }
    console.log('Creating/reusing six demo listings and their real images.')
    for (const item of catalog) {
      const [key, owner, title, price, category, subcategory] = item
      const description = `[${marker}:${key}] Synthetic staging demonstration only. ${title} in good condition; pickup near campus. Not a real offer.`
      let rows = query(
        `begin read only; select id,published_at from public.listings where seller_id=${q(
          state.users[owner]
        )} and description=${q(description)}; rollback;`
      )
      assert(rows.length <= 1, 'Duplicate demo listing marker; stop')
      let listing = rows[0]
      if (!listing)
        listing = await api[owner]('/api/listings', {
          title: `[DEMO] ${title}`,
          description,
          price,
          currency: 'CAD',
          category,
          subcategory,
          condition: 'good',
          pickupArea: 'On campus',
          photoUrls: [],
          expectedImageCount: key === 'macbook' ? 2 : 1,
        })
      state.listings[key] = listing.id
      save(stateFile, state)
      if (!listing.published_at && !listing.publishedAt) {
        const creation = await api[owner](
          `/api/listings/${listing.id}/creation`
        )
        for (
          let i = creation.photoUrls.length;
          i < (creation.expectedImageCount || 1);
          i++
        )
          await api[owner](
            `/api/listing-images/${listing.id}`,
            await image(item, i),
            'POST',
            true
          )
        await api[owner](`/api/listings/${listing.id}/finalize`, {})
      }
    }
    for (const [buyer, favorites] of [
      ['buyer-a', ['macbook', 'nike', 'monitor']],
      ['buyer-b', ['nike', 'lamp']],
    ])
      for (const key of favorites)
        await api[buyer](`/api/favorites/${state.listings[key]}`, {})
    const discussions = [
      [
        'textbook-history',
        'buyer-a',
        'seller-b',
        'textbook',
        [
          ['buyer-a', 'Hi! Is the calculus textbook still available?'],
          ['seller-b', 'Yes, it is. No highlighting and all pages are intact.'],
          ['buyer-a', 'Great, $40 works. Can we meet at the library?'],
          ['seller-b', 'Sure, see you there. Thanks!'],
        ],
      ],
      [
        'nike-b',
        'buyer-b',
        'seller-a',
        'nike',
        [
          ['buyer-b', 'Hey, is this still available?'],
          ['seller-a', 'Yes, it is.'],
          ['buyer-b', 'Would you take $70?'],
          ['seller-a', 'I could do $80.'],
        ],
      ],
      [
        'monitor-a',
        'buyer-a',
        'seller-b',
        'monitor',
        [
          ['buyer-a', 'Does the monitor include its power cable?'],
          ['seller-b', 'Yes, and an HDMI cable too.'],
          ['buyer-a', 'Thanks! I will check my desk space first.'],
        ],
      ],
      [
        'nike-a',
        'buyer-a',
        'seller-a',
        'nike',
        [
          ['buyer-a', 'Hi! What size are the Nike Dunks?'],
          ['seller-a', 'Size 9. I can send a closer look.'],
        ],
      ],
    ]
    console.log(
      'Creating/reusing durable conversations and idempotent messages.'
    )
    for (const [key, buyer, seller, listingKey, lines] of discussions) {
      const found = query(
        `select id from public.conversations where listing_origin_id=${q(
          state.listings[listingKey]
        )} and buyer_id=${q(state.users[buyer])} and seller_id=${q(
          state.users[seller]
        )};`
      )
      assert(found.length <= 1)
      let conversation = found[0]?.id
      if (!conversation) {
        conversation = (
          await api[buyer]('/api/messages/conversations', {
            listingId: state.listings[listingKey],
          })
        ).id
        state.conversations[key] = conversation
        save(stateFile, state)
      }
      state.conversations[key] = conversation
      save(stateFile, state)
      let latest
      for (let i = 0; i < lines.length; i++) {
        const [sender, content] = lines[i]
        latest = await api[sender](
          `/api/messages/conversations/${conversation}/messages`,
          { type: 'TEXT', clientMessageId: nonce(`${key}:${i}`), content }
        )
      }
      if (key === 'nike-a') {
        const bytes = await image(catalog[1])
        const prepared = await api[seller](
          `/api/messages/images/${conversation}/prepare`,
          {
            clientMessageId: nonce('nike-a:photo'),
            images: [
              {
                original_name: 'demo-nike-detail.png',
                mime_type: 'image/png',
                size_bytes: bytes.length,
                sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
              },
            ],
          }
        )
        if (prepared.state !== 'finalized')
          for (const slot of prepared.manifest)
            await api[seller](
              `/api/messages/image-upload/${prepared.id}/${slot.id}`,
              bytes,
              'POST',
              true
            )
        await api[seller](`/api/messages/images/${prepared.id}/finalize`, {})
        latest = await api[seller](
          `/api/messages/conversations/${conversation}/messages`,
          {
            type: 'TEXT',
            clientMessageId: nonce('nike-a:last'),
            content:
              'Here is a synthetic close-up. The price is $80 and pickup is on campus.',
          }
        )
      }
      if (key === 'textbook-history') {
        await api[buyer](`/api/messages/conversations/${conversation}/read`, {
          throughSequence: latest.sequence,
        })
        await api[seller](`/api/messages/conversations/${conversation}/read`, {
          throughSequence: latest.sequence,
        })
        const current = await api[seller](
          `/api/listings/${state.listings.textbook}`
        )
        if (current.status !== 'sold')
          await api[seller](`/api/listings/${state.listings.textbook}/sold`, {})
      }
      // Natural durable timestamps, never rewrite message/activity history.
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    const buying = await api['buyer-a'](
      '/api/messages/conversations?role=buying'
    )
    const selling = await api['seller-a'](
      '/api/messages/conversations?role=selling'
    )
    assert(
      buying.conversations.length >= 3 && selling.conversations.length >= 2
    )
    assert(buying.conversations.some((c) => c.unreadCount > 0))
    verifyDataset(state)
    state.complete = true
    state.seededAt = new Date().toISOString()
    save(stateFile, state)
    console.log(
      'Verified real staging content: 6 listings (5 available, 1 sold), 5 Favorites, 4 conversations, TEXT + durable IMAGE, read/unread and shared Nike listing.'
    )
  } finally {
    child.demoStopping = true
    child.kill()
  }
}
async function cleanup(admin, existing, state) {
  const ids = existing.map((u) => u.id)
  // Recovery authority is server-controlled app_metadata, never a local list of IDs/paths.
  state.cleanupPaths = { listing: [], chat: [] }
  for (const user of existing) {
    const journal = user.app_metadata.demo_cleanup
    if (journal)
      for (const key of ['listing', 'chat'])
        state.cleanupPaths[key].push(...(journal[key] || []))
  }
  if (ids.length) {
    const set = ids.map(q).join(',')
    const foreign = query(
      `begin read only; select id from public.conversations where (buyer_id in (${set}) or seller_id in (${set})) and (buyer_id is null or seller_id is null or buyer_id not in (${set}) or seller_id not in (${set})) union all select f.user_id as id from public.listing_favorites f join public.listings l on l.id=f.listing_id where l.seller_id in (${set}) and f.user_id not in (${set}); rollback;`
    )
    assert.equal(
      foreign.length,
      0,
      'Unrelated participant/favorite references demo data; cleanup refuses destructive cascade'
    )
    const listingPaths = query(
      `select i.path from public.listing_images i join public.listings l on l.id=i.listing_id where l.seller_id in (${set});`
    ).map((r) => r.path)
    const chatPaths = query(
      `select i.storage_path as path from public.message_images i join public.messages m on m.id=i.message_id join public.conversations c on c.id=m.conversation_id where c.buyer_id in (${set}) and c.seller_id in (${set}) union select item->>'storage_path' as path from public.image_message_submissions s cross join lateral jsonb_array_elements(s.manifest) item where s.sender_id in (${set});`
    ).map((r) => r.path)
    state.cleanupPaths = {
      listing: [
        ...new Set([...(state.cleanupPaths?.listing || []), ...listingPaths]),
      ],
      chat: [...new Set([...(state.cleanupPaths?.chat || []), ...chatPaths])],
    }
    save(stateFile, state)
    await checked(
      admin.auth.admin.updateUserById(existing[0].id, {
        app_metadata: {
          ...existing[0].app_metadata,
          demo_cleanup: state.cleanupPaths,
        },
      }),
      'Persist scoped cleanup recovery journal'
    )
    await query(
      `begin; delete from public.conversations where buyer_id in (${set}) and seller_id in (${set}); delete from public.listings where seller_id in (${set}); commit;`
    )
  }
  for (const [bucket, paths] of [
    ['listing-images', state.cleanupPaths?.listing || []],
    ['chat-images', state.cleanupPaths?.chat || []],
  ]) {
    if (!paths.length) continue
    await checked(
      admin.storage.from(bucket).remove(paths),
      'Remove owned demo Storage objects'
    )
    for (const object of paths) {
      const rows = query(
        `select id from storage.objects where bucket_id=${q(
          bucket
        )} and name=${q(object)};`
      )
      assert.equal(rows.length, 0, 'Demo object removal not confirmed')
    }
  }
  // Exact demo paths only, after objects/references disappear. No broad queue drain.
  if (state.cleanupPaths?.chat?.length)
    query(
      `delete from marketplace_private.chat_image_cleanup q where q.storage_path in (${state.cleanupPaths.chat
        .map(q)
        .join(
          ','
        )}) and not exists(select 1 from storage.objects o where o.bucket_id='chat-images' and o.name=q.storage_path) and not exists(select 1 from public.message_images i where i.storage_path=q.storage_path) and not exists(select 1 from public.image_message_submissions s cross join lateral jsonb_array_elements(s.manifest) item where item->>'storage_path'=q.storage_path);`
    )
  if (state.cleanupPaths?.chat?.length) {
    const remaining = query(
      `select count(*) as remaining from marketplace_private.chat_image_cleanup where storage_path in (${state.cleanupPaths.chat
        .map(q)
        .join(',')});`
    )
    assert.equal(
      Number(remaining[0].remaining),
      0,
      'Owned demo cleanup queue residue remains'
    )
  }
  // Delete the authoritative journal holder last, including on recovery runs.
  const deletionOrder = [...existing].sort(
    (a, b) =>
      Number(Boolean(a.app_metadata.demo_cleanup)) -
      Number(Boolean(b.app_metadata.demo_cleanup))
  )
  if (existing[0])
    deletionOrder.sort(
      (a, b) =>
        Number(a.id === existing[0].id) - Number(b.id === existing[0].id)
    )
  for (const user of deletionOrder)
    await checked(
      admin.auth.admin.deleteUser(user.id),
      'Delete marked demo identity'
    )
  assert.equal((await users(admin)).length, 0)
  if (ids.length) {
    const set = ids.map(q).join(',')
    const rows = query(
      `select (select count(*) from public.profiles where id in (${set})) as profiles,(select count(*) from public.listings where seller_id in (${set})) as listings,(select count(*) from public.conversations where buyer_id in (${set}) or seller_id in (${set})) as conversations,(select count(*) from public.messages where sender_id in (${set})) as messages,(select count(*) from public.image_message_submissions where sender_id in (${set})) as submissions,(select count(*) from public.listing_favorites where user_id in (${set})) as favorites;`
    )
    assert(
      Object.values(rows[0]).every((value) => Number(value) === 0),
      'Demo residue remains'
    )
  }
  for (const file of [stateFile, credentialFile])
    if (fs.existsSync(file)) fs.unlinkSync(file)
  console.log(
    'Demo cleanup verified; only marked identities and their scoped fixtures/objects were removed. Local credentials and manifest deleted.'
  )
}
async function main() {
  const mode = process.argv[2]
  assert(
    ['seed', 'cleanup', 'dev'].includes(mode),
    'Use seed, cleanup or dev only; target cannot be overridden'
  )
  assert(
    !process.env.APP_ENV || process.env.APP_ENV === 'staging',
    'Refusing inherited non-staging APP_ENV'
  )
  fs.mkdirSync(root, { recursive: true })
  assert.equal(
    spawnSync('git', ['check-ignore', credentialFile], { stdio: 'ignore' })
      .status,
    0,
    'Credentials must be ignored before creation'
  )
  const lock = path.join(root, 'operation.lock')
  const handle = fs.openSync(lock, 'wx')
  fs.writeFileSync(handle, String(process.pid))
  try {
    const inventory = cli(['projects', 'list', '--output', 'json'])
    const info = (
      Array.isArray(inventory) ? inventory : inventory.projects
    ).find((p) => (p.ref || p.id) === ref)
    assert(info, 'Expected staging project missing')
    const response = cli([
      'projects',
      'api-keys',
      '--project-ref',
      ref,
      '--output',
      'json',
    ])
    const entries = Array.isArray(response) ? response : response.keys
    const keys = {
      publicKey: entries.find((k) => k.name === 'anon')?.api_key,
      secret: entries.find((k) => k.name === 'service_role')?.api_key,
    }
    guard(info, keys)
    if (mode !== 'cleanup') configureStagingLocal(keys)
    if (mode === 'dev') {
      const { child } = await serve(keys, 3112)
      console.log(
        'Isolated staging viewer ready: http://localhost:3112 (real data; separate ignored build cache). Close with Ctrl+C before seed/cleanup.'
      )
      await new Promise((resolve) => {
        const stop = () => {
          child.demoStopping = true
          child.kill()
        }
        process.once('SIGINT', stop)
        process.once('SIGTERM', stop)
        child.once('exit', () => {
          process.removeListener('SIGINT', stop)
          process.removeListener('SIGTERM', stop)
          resolve()
        })
      })
      return
    }
    const admin = createClient(url, keys.secret, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
    const state = fs.existsSync(stateFile)
      ? JSON.parse(fs.readFileSync(stateFile))
      : {
          marker,
          ref,
          users: {},
          listings: {},
          conversations: {},
          complete: false,
        }
    assert.equal(state.marker, marker)
    assert.equal(state.ref, ref)
    const credentials = fs.existsSync(credentialFile)
      ? JSON.parse(fs.readFileSync(credentialFile))
      : {}
    const existing = await users(admin)
    if (mode === 'seed') {
      assert(
        !existing.some((u) => u.app_metadata.demo_cleanup),
        'Interrupted cleanup exists; finish cleanup before reseeding'
      )
      if (state.complete)
        assert(
          roles.every((role) =>
            existing.some(
              (u) =>
                u.id === state.users[role] && u.app_metadata.demo_role === role
            )
          ),
          'Completed dataset identities changed; use cleanup/reseed'
        )
      await seed(admin, keys, existing, state, credentials)
      console.log(
        'Roles: Seller A, Seller B, Buyer A, Buyer B. Credentials are local-only: tests/artifacts/staging-demo/credentials.json (not printed).'
      )
    } else await cleanup(admin, existing, state)
  } finally {
    fs.closeSync(handle)
    fs.unlinkSync(lock)
  }
}
module.exports = { guard, nonce, marker, roles }
if (require.main === module)
  main().catch((error) => {
    console.error(
      'Staging demo stopped: ' +
        (error.code === 'EEXIST'
          ? 'Another operation/lock exists. Stop; inspect the local operation.lock.'
          : error.message)
    )
    process.exitCode = 1
  })
