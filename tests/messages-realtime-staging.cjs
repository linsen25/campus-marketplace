/* global fetch */
// Opt-in HOSTED STAGING ONLY. Real HTTP API/Auth/Storage and independent private WebSockets.
// No final frontend Realtime integration. Credentials/JWTs/cookies remain in memory.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const { createClient } = require('@supabase/supabase-js')
const sharp = require('sharp')
const ref = 'pcaqxezdfxofysghssyo'
const url = `https://${ref}.supabase.co`
const base = 'http://localhost:3107'
const root = path.resolve('tests/artifacts/messages-phase3b')
const run = crypto.randomUUID().slice(0, 8)
const folder = path.join(root, run)
const topic = (id) => `marketplace:messages:${id}`
const q = (x) => "'" + String(x).replaceAll("'", "''") + "'"
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const results = [], users = [], listingIds = [], conversationIds = [], sockets = [], chatPaths = new Set()
let admin, server, queryIndex = 0, restoreSql = null
fs.mkdirSync(folder, { recursive: true })
const originalFetch = global.fetch
global.fetch = (input, options) => {
  const target = new URL(typeof input === 'string' ? input : input.url || String(input))
  assert([url, base].includes(target.origin), 'HTTP targets are staging or isolated local app only')
  return originalFetch(input, options)
}
function cli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('cmd.exe', ['/d', '/c', 'npx.cmd', '--no-install', 'supabase', ...args], { windowsHide: true })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', () => {})
    child.on('error', () => reject(new Error('Staging CLI launch failed')))
    child.on('close', (code) => {
      if (code) return reject(new Error('Staging CLI failed; provider details suppressed'))
      try { resolve(JSON.parse(output.slice(output.indexOf('{')))) }
      catch { reject(new Error('Invalid staging CLI response')) }
    })
  })
}
async function query(sql) {
  const file = path.join(folder, `query-${queryIndex++}.sql`)
  fs.writeFileSync(file, sql)
  try { return await cli(['db', 'query', '--linked', '--project-ref', ref, '--file', file]) }
  finally { fs.unlinkSync(file) }
}
async function ok(promise, label) {
  const response = await promise
  if (response.error) throw new Error(`${label}: rejected (${response.error.code || response.error.status || 'provider'})`)
  return response.data
}
function pass(test, detail = {}) {
  const entry = { test, result: 'PASS', ...detail }
  results.push(entry)
  console.log(JSON.stringify(entry))
}
async function api(user, endpoint, data, method = data === undefined ? 'GET' : 'POST', raw = false, expected = 200) {
  const response = await fetch(base + endpoint, {
    method, headers: { Origin: base, 'X-Marketplace-Request': '1',
      'Content-Type': raw ? 'image/jpeg' : 'application/json',
      Cookie: [...user.cookies].map(([name, value]) => `${name}=${value}`).join('; ') },
    ...(data === undefined ? {} : { body: raw ? data : JSON.stringify(data) }),
  })
  for (const header of response.headers.getSetCookie()) {
    const item = header.split(';')[0], at = item.indexOf('=')
    user.cookies.set(item.slice(0, at), item.slice(at + 1))
  }
  assert.equal(response.status, expected, `${endpoint}: HTTP status (body suppressed)`)
  assert.match(response.headers.get('cache-control') || '', /no-store/)
  return response.json().catch(() => null)
}
const messages = '/api/messages/conversations'
async function text(user, id, label) {
  return api(user, `${messages}/${id}/messages`, { type: 'TEXT', content: `Phase3B ${label}`, clientMessageId: crypto.randomUUID() })
}
async function image(user, id, jpeg) {
  const submission = await api(user, `/api/messages/images/${id}/prepare`, {
    clientMessageId: crypto.randomUUID(), images: [{ original_name: 'staging-fixture.jpg', mime_type: 'image/jpeg', size_bytes: jpeg.length, sha256: crypto.createHash('sha256').update(jpeg).digest('hex') }],
  })
  const paths = await query(`select storage_path from public.image_message_submissions s cross join lateral jsonb_to_recordset(s.manifest) as x(storage_path text) where s.id=${q(submission.id)};`)
  paths.rows.forEach((row) => chatPaths.add(row.storage_path))
  await api(user, `/api/messages/image-upload/${submission.id}/${submission.manifest[0].id}`, jpeg, 'POST', true)
  const result = await api(user, `/api/messages/images/${submission.id}/finalize`, {})
  assert.equal(result.type, 'IMAGE'); assert.equal(result.images.length, 1)
  const bytes = await fetch(result.images[0].previewUrl)
  assert.equal(bytes.status, 200)
  assert((await sharp(Buffer.from(await bytes.arrayBuffer())).metadata()).width > 0)
  return result
}
async function listen(user, destination = topic(user.id), privateChannel = true, expected = 'SUBSCRIBED', tokenOverride) {
  const holder = { token: tokenOverride === undefined ? user.token : tokenOverride, events: [], states: [], rejected: false }
  holder.client = createClient(url, user.publicKey, {
    accessToken: async () => holder.token,
    realtime: { timeout: 10000, heartbeatIntervalMs: 10000 },
  })
  assert.equal(new URL(holder.client.realtime.endPoint).hostname, `${ref}.supabase.co`, 'WebSocket must stay on staging')
  sockets.push(holder)
  await holder.client.realtime.setAuth()
  holder.channel = holder.client.channel(destination, { config: { private: privateChannel, broadcast: { ack: true } } })
    .on('broadcast', { event: '*' }, (event) => {
      holder.events.push(event)
      if (expected !== 'SUBSCRIBED') holder.rejected = true
    })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket join exceeded bounded deadline')), 16000)
    holder.channel.subscribe((status, error) => {
      holder.states.push(status)
      if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer)
        if (expected === 'PUBLIC_PROBE' ? status !== 'TIMED_OUT' : expected === 'SUBSCRIBED' ? status === expected : status === 'CHANNEL_ERROR') resolve()
        else {
          const detail = String(error?.message || '').split(holder.token || '[none]').join('[token]').split(user.publicKey).join('[key]')
            .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[token]')
            .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9-]{23,}/gi, '[id]')
          reject(new Error(`Unexpected WebSocket join status: ${status}; ${detail.slice(0,300)}`))
        }
      }
    })
  })
  return holder
}
async function close(holder) {
  if (!holder || holder.closed) return
  holder.closed = true
  await holder.client.removeAllChannels()
  holder.client.realtime.disconnect()
  holder.token = null
}
async function delivered(buyer, seller, outsider, id, previous, label) {
  const deadline = Date.now() + 12000
  while (Date.now() < deadline) {
    if ([buyer, seller].every((holder, index) => holder.events.slice(previous[index]).some((x) => x.payload.conversationId === id && x.payload.scope === 'history'))) break
    await wait(100)
  }
  for (const [index, holder] of [buyer, seller].entries()) {
    const events = holder.events.slice(previous[index]).filter((x) => x.payload.conversationId === id)
    assert(events.some((x) => x.payload.scope === 'history'), `${label}: message invalidation`)
    assert(events.some((x) => x.payload.scope === 'list'), `${label}: list invalidation`)
    for (const event of events) {
      assert.equal(event.event, 'messages_changed')
      // Hosted realtime.send adds its notification UUID; it is transport metadata.
      assert.deepEqual(Object.keys(event.payload).sort(), ['conversationId', 'id', 'role', 'scope'])
      assert.match(event.payload.id, /^[a-f0-9-]{36}$/i)
      assert.equal(event.payload.role, index === 0 ? 'buying' : 'selling')
      assert(['history', 'list'].includes(event.payload.scope))
    }
  }
  assert.equal(outsider.events.length, 0, 'Unrelated own topic must remain silent')
  pass(label, { buyerSignals: buyer.events.length - previous[0], sellerSignals: seller.events.length - previous[1], outsiderSignals: 0, minimalPayload: true })
}
async function main() {
  const linked = (await cli(['projects', 'list'])).projects.filter((x) => x.linked)
  assert.equal(linked.length, 1); assert.equal(linked[0].ref, ref); assert.equal(linked[0].name, 'western-marketplace-staging')
  const history = await query('begin read only; select version from supabase_migrations.schema_migrations order by version; rollback;')
  assert.deepEqual(history.rows.map((x) => x.version), ['202609290001','202610030001','202610040001','202610050001','202610070001','202610070002','202610080001'])
  const keys = (await cli(['projects', 'api-keys', '--project-ref', ref])).keys
  const publicKey = keys.find((x) => x.name === 'anon').api_key
  const privateKey = keys.find((x) => x.name === 'service_role').api_key
  for (const [key, role] of [[publicKey, 'anon'], [privateKey, 'service_role']]) {
    const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url'))
    assert.equal(claims.ref, ref); assert.equal(claims.role, role)
  }
  admin = createClient(url, privateKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  pass('staging identity, real credential project claims and seven applied migrations')
  const serverFile = path.join(folder, 'server.cjs')
  fs.writeFileSync(serverFile, `process.env.NODE_ENV='development';process.env.NEXT_TELEMETRY_DISABLED='1';
const assert=require('node:assert/strict');assert.equal(process.env.APP_ENV,'staging');assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,'${url}');
const oldFetch=global.fetch;global.fetch=(input,opts)=>{const u=new URL(typeof input==='string'?input:input.url||String(input));if(u.origin!=='${url}')throw Error('Non-staging network blocked');return oldFetch(input,opts)};
(async()=>{const config=await require('next/dist/server/config').default(require('next/constants').PHASE_DEVELOPMENT_SERVER,process.cwd());config.distDir=${JSON.stringify(path.relative(process.cwd(), path.join(folder,'next')).replaceAll('\\','/'))};const app=require('next')({dev:true,dir:process.cwd(),conf:config,hostname:'localhost',port:3107});await app.prepare();const server=require('node:http').createServer(app.getRequestHandler());server.listen(3107,()=>console.log('PHASE3B_SERVER_READY'));process.on('SIGTERM',()=>server.close(()=>process.exit()))})().catch(()=>{console.error('STAGING_SERVER_FAILED');process.exit(1)});`)
  let ready = false
  server = spawn(process.execPath, [serverFile], { windowsHide: true, env: { ...process.env, APP_ENV: 'staging', NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: publicKey, SUPABASE_SERVICE_ROLE_KEY: privateKey } })
  server.stdout.on('data', (chunk) => { if (String(chunk).includes('PHASE3B_SERVER_READY')) ready = true })
  server.stderr.on('data', () => {})
  for (let n=0;n<60&&!ready;n++) await wait(1000)
  assert(ready, 'Isolated staging app ready')
  const password = crypto.randomBytes(24).toString('hex') + 'Aa9!'
  for (const name of ['Seller','Buyer','Outsider']) {
    const email = `phase3b-${run}-${name.toLowerCase()}@uwo.ca`
    const created = await ok(admin.auth.admin.createUser({ email, password, email_confirm:true, user_metadata:{ username:`P3B_${name[0]}_${run}` } }), 'create disposable user')
    const user = { id:created.user.id, cookies:new Map(), publicKey }
    users.push(user)
    await api(user, '/api/auth/sign-in', { email, password })
    assert.equal((await api(user, '/api/auth/session')).seller.id, user.id)
    user.auth = createClient(url, publicKey, { auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false} })
    const signed = await ok(user.auth.auth.signInWithPassword({ email, password }), 'real SDK session')
    user.token = signed.session.access_token
  }
  const [seller,buyer,outsider] = users
  pass('three independent real Auth API cookies and user JWT sessions; no token/session files')
  const jpeg = await sharp({create:{width:64,height:48,channels:3,background:'#775599'}}).jpeg().toBuffer()
  const listing = await api(seller, '/api/listings', { title:`Phase3B TEMP staging ${run}`, description:'Disposable Realtime backend fixture',price:4500,currency:'CAD',category:'Home & Dorm',subcategory:'Furniture',condition:'good',pickupArea:'On campus',photoUrls:[],expectedImageCount:1 }, 'POST', false, 201)
  listingIds.push(listing.id)
  await api(seller, `/api/listing-images/${listing.id}`, jpeg, 'POST', true)
  await api(seller, `/api/listings/${listing.id}/finalize`, {})
  const conversation = await api(buyer, messages, {listingId:listing.id})
  conversationIds.push(conversation.id)
  fs.writeFileSync(path.join(folder,'fixture-ids.json'), JSON.stringify({users:users.map(x=>x.id),listingIds,conversationIds}))
  const id = conversation.id
  const cold = await query("select count(*)::integer as partitions from pg_inherits where inhparent='realtime.messages'::regclass;")
  const genuinelyCold = cold.rows[0].partitions === 0
  const coldText = await text(buyer,id,'cold text')
  const coldImage = await image(buyer,id,jpeg)
  assert.equal(coldText.sequence,1);assert.equal(coldImage.sequence,2)
  assert.equal((await api(buyer,`${messages}/${id}/messages`)).messages.length,2)
  assert.equal((await query("select count(*)::integer as partitions from pg_inherits where inhparent='realtime.messages'::regclass;")).rows[0].partitions,cold.rows[0].partitions)
  pass(genuinelyCold ? 'genuine zero-partition / no-WebSocket cold start: existing TEXT and complete IMAGE APIs persist and sign successfully' : 'no connected test channels: existing TEXT and complete IMAGE APIs persist; partitions already initialized by prior diagnostic',{messages:2,partitions:cold.rows[0].partitions})
  const buyerFeed = await listen(buyer), sellerFeed = await listen(seller), outsiderFeed = await listen(outsider)
  pass('three independent own-topic private receive-only WebSocket joins',{private:true,channelsPerUser:1})
  const rejected = []
  for (const [user,destination] of [[buyer,topic(seller.id)],[seller,topic(buyer.id)],[outsider,topic(buyer.id)],[outsider,topic(seller.id)],[buyer,topic(crypto.randomUUID())],[buyer,`${topic(buyer.id)}:extra`],[buyer,'marketplace:messages:../invalid']]) {
    rejected.push(await listen(user,destination,true,'CHANNEL_ERROR'))
  }
  const anonymous = { id:crypto.randomUUID(),publicKey,token:publicKey }
  rejected.push(await listen(anonymous,topic(buyer.id),true,'CHANNEL_ERROR'))
  const invalidParts = buyer.token.split('.')
  invalidParts[2] = (invalidParts[2].startsWith('A') ? 'B' : 'A') + invalidParts[2].slice(1)
  const invalid = invalidParts.join('.')
  rejected.push(await listen(buyer,topic(buyer.id),true,'CHANNEL_ERROR',invalid))
  pass('cross-user/outsider/anonymous/guessed/malicious/invalid JWT private joins rejected',{rejectedJoins:rejected.length})
  rejected.forEach((x)=>{assert.equal(x.events.length,0)})
  for (const holder of rejected) await close(holder)
  const counts=()=>[buyerFeed.events.length,sellerFeed.events.length]
  let previous=counts();await text(buyer,id,'live buyer');await delivered(buyerFeed,sellerFeed,outsiderFeed,id,previous,'Buyer TEXT and conversation list invalidations')
  previous=counts();await text(seller,id,'live seller');await delivered(buyerFeed,sellerFeed,outsiderFeed,id,previous,'Seller TEXT reciprocal invalidations')
  previous=counts();await image(buyer,id,jpeg);await delivered(buyerFeed,sellerFeed,outsiderFeed,id,previous,'real prepare/upload/receipt/finalize IMAGE invalidations and API-signed bytes')
  await wait(600)
  const readBefore=counts(),latest=(await api(buyer,`${messages}/${id}/messages`)).messages.at(-1).sequence
  await api(seller,`${messages}/${id}/read`,{throughSequence:latest})
  await wait(1500)
  assert.equal(buyerFeed.events.length,readBefore[0]);assert(sellerFeed.events.slice(readBefore[1]).some(x=>x.payload.scope==='list'))
  pass('read-watermark update invalidates only reader list; no recipient seen signal')
  const spoofBefore=counts()
  const spoof=await buyerFeed.channel.send({type:'broadcast',event:'messages_changed',payload:{conversationId:id,role:'selling',scope:'history'}})
  assert.notEqual(spoof,'ok','Receive-only publisher must be rejected')
  const otherTopic=await listen(buyer,topic(seller.id),false,'PUBLIC_PROBE')
  if(otherTopic.states.includes('SUBSCRIBED')) await otherTopic.channel.send({type:'broadcast',event:'messages_changed',payload:{conversationId:id,role:'selling',scope:'history'}})
  await wait(1500)
  assert.deepEqual(counts(),spoofBefore);assert.equal(otherTopic.events.length,0)
  await close(otherTopic)
  pass('own private client publish rejected; public same-name channel cannot reach private recipients',{privateSendResult:spoof,publicChannelJoin:otherTopic.states.includes('SUBSCRIBED')})
  const source=fs.readFileSync('supabase/migrations/202610080001_messages_realtime.sql','utf8')
  const functions=[...source.matchAll(/create or replace function marketplace_private\.notify_\w+_realtime\(\) returns trigger[\s\S]*?end; \$\$;/g)].map(x=>x[0])
  assert.equal(functions.length,2)
  restoreSql=functions.join('\n')
  try {
    const injected=functions.map(fn=>fn.replace('perform realtime.send(',`if ${fn.includes('notify_message_realtime()')?'new.conversation_id':'new.id'} = ${q(id)}::uuid then raise exception 'Scoped Phase3B notification failure'; end if;\n    perform realtime.send(`)).join('\n')
    await query('begin;'+injected+'commit;')
    await wait(500);previous=counts()
    const faultText=await text(buyer,id,'notification fault'),faultImage=await image(buyer,id,jpeg)
    assert.equal(faultImage.sequence,faultText.sequence+1)
    await wait(1500);assert.deepEqual(counts(),previous)
    pass('scoped application-trigger notification exception isolated from normal TEXT and IMAGE persistence',{durableSends:2,signals:0})
  } finally {await query('begin;'+restoreSql+'commit;');restoreSql=null}
  previous=counts();await text(buyer,id,'rapid1');await text(seller,id,'rapid2');await image(buyer,id,jpeg);await text(seller,id,'rapid3')
  await delivered(buyerFeed,sellerFeed,outsiderFeed,id,previous,'rapid TEXT/TEXT/IMAGE/TEXT batch uses minimal signals and canonical sequences')
  const all=(await api(buyer,`${messages}/${id}/messages`)).messages
  assert(all.every((m,i)=>m.sequence===i+1))
  const refreshed=await ok(buyer.auth.auth.refreshSession(),'real user token refresh')
  buyer.token=refreshed.session.access_token;buyerFeed.token=buyer.token;await buyerFeed.client.realtime.setAuth()
  previous=counts();await text(seller,id,'refreshed token');await delivered(buyerFeed,sellerFeed,outsiderFeed,id,previous,'real token refresh/setAuth retains authorized delivery')
  await api(seller,`/api/listings/${listing.id}/sold`,{})
  previous=counts();await text(buyer,id,'sold text');await image(seller,id,jpeg);await delivered(buyerFeed,sellerFeed,outsiderFeed,id,previous,'sold listing historical conversation still signals TEXT and IMAGE')
  await api(seller,`/api/listings/${listing.id}`,undefined,'DELETE')
  await wait(500);previous=counts();await text(buyer,id,'deleted listing text');await image(seller,id,jpeg);await delivered(buyerFeed,sellerFeed,outsiderFeed,id,previous,'deleted listing historical conversation still signals TEXT and IMAGE')
  await wait(500)
  const removedCount=buyerFeed.events.length
  await ok(admin.auth.admin.deleteUser(buyer.id),'delete disposable buyer')
  buyer.deleted=true
  await wait(500)
  previous=[buyerFeed.events.length,sellerFeed.events.length]
  await text(seller,id,'surviving participant');await image(seller,id,jpeg);await wait(1500)
  assert.equal(buyerFeed.events.length,removedCount)
  assert(sellerFeed.events.length>previous[1]);assert.equal(outsiderFeed.events.length,0)
  const removedJoin=await listen(buyer,topic(buyer.id),true,'CHANNEL_ERROR');assert.equal(removedJoin.events.length,0);await close(removedJoin)
  pass('deleted Buyer gets no subsequent signal despite cached socket; surviving Seller sends/read/signs and new deleted-user join is denied')
  await close(sellerFeed);await api(seller,'/api/auth/sign-out',{})
  const noSession=await api(seller,`${messages}?role=selling`,undefined,'GET',false,401);assert(noSession.error)
  assert.equal(sellerFeed.client.getChannels().length,0)
  pass('normal API logout plus owned channel teardown leaves zero channels; copied access JWT expiry is not instant global revocation')
  assert.equal(outsiderFeed.events.length,0)
}
async function cleanup() {
  if (restoreSql) {await query('begin;'+restoreSql+'commit;');restoreSql=null}
  for (const holder of sockets) await close(holder)
  if (admin && conversationIds.length) {
    const chat=await query(`select storage_path from public.message_images m join public.messages p on p.id=m.message_id where p.conversation_id in (${conversationIds.map(q)});`)
    chat.rows.forEach(x=>chatPaths.add(x.storage_path))
    await query(`delete from public.conversations where id in (${conversationIds.map(q)});`)
    if(chatPaths.size) await ok(admin.storage.from('chat-images').remove([...chatPaths]),'remove physical chat fixture bytes')
    for (const objectPath of chatPaths) assert((await admin.storage.from('chat-images').info(objectPath)).error,'Physical fixture absent')
    await query(`update marketplace_private.chat_image_cleanup set queued_at=clock_timestamp()-interval '11 minutes' where split_part(storage_path,'/',1) in (${conversationIds.map(q)});`)
    for(const objectPath of chatPaths) assert.equal(await ok(admin.rpc('marketplace_ack_chat_image_cleanup',{p_storage_path:objectPath}),'fixture queue acknowledgment'),true)
  }
  if(admin && listingIds.length) {
    const paths=await query(`select path from public.listing_images where listing_id in (${listingIds.map(q)});`)
    if(paths.rows.length) await ok(admin.storage.from('listing-images').remove(paths.rows.map(x=>x.path)),'remove listing fixture bytes')
    await query(`delete from public.listings where id in (${listingIds.map(q)});`)
  }
  if(admin) for(const user of users) if(!user.deleted) {await ok(admin.auth.admin.deleteUser(user.id),'remove fixture Auth user');user.deleted=true}
  const uid=users.map(x=>q(x.id)).join(',')||'NULL',lid=listingIds.map(q).join(',')||'NULL',cid=conversationIds.map(q).join(',')||'NULL'
  const residue=await query(`begin read only;select (select count(*) from auth.users where id in (${uid})) as users,(select count(*) from public.profiles where id in (${uid})) as profiles,(select count(*) from public.listings where id in (${lid})) as listings,(select count(*) from public.conversations where id in (${cid})) as conversations,(select count(*) from public.messages where conversation_id in (${cid})) as messages,(select count(*) from public.image_message_submissions where conversation_id in (${cid})) as submissions,(select count(*) from marketplace_private.chat_image_cleanup where split_part(storage_path,'/',1) in (${cid})) as queue,(select count(*) from storage.objects where bucket_id='chat-images' and split_part(name,'/',1) in (${cid})) as chat_objects;rollback;`)
  assert(Object.values(residue.rows[0]).every(x=>Number(x)===0));pass('disposable staging fixtures removed; current chat bucket and applied migration retained',residue.rows[0])
  if(server){server.kill();await wait(800)}
  assert(folder.startsWith(root+path.sep));fs.rmSync(folder,{recursive:true,force:true})
  pass('isolated app stopped and run artifacts removed; no credentials/session/JWT/image files retained')
}
async function runHosted() {
  let failed
  try {await main()}catch(error){failed=error;console.error(error.message)}
  finally{try{await cleanup()}catch(error){failed ||= error;console.error('CLEANUP FAILED: '+error.message);if(server)server.kill()}
    fs.writeFileSync(path.join(root,`result-${run}.json`),JSON.stringify({run,results,passed:!failed},null,2))}
  if(failed)process.exitCode=1
}
runHosted()
