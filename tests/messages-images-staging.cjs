/* global fetch */
// Opt-in hosted STAGING ONLY. Real GoTrue sessions, Storage bytes, RPC/RLS and independent PG sessions.
// Keys/passwords stay in memory; SQL temp files never contain credentials. No frontend integration.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const { createClient } = require('@supabase/supabase-js')
const sharp = require('sharp')
const ts = require('typescript')
const ref = 'pcaqxezdfxofysghssyo'
const url = `https://${ref}.supabase.co`
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-phase2b-'))
const artifact = 'tests/artifacts/messages-phase2b'
fs.mkdirSync(artifact, { recursive: true })
const run = crypto.randomUUID().slice(0, 8)
const ids = [],
  listings = [],
  conversations = [],
  storagePaths = new Set(),
  listingPaths = []
const results = []
let queryIndex = 0,
  admin,
  fixturesCreated = false
const originalFetch = global.fetch
global.fetch = (input, options) => {
  const target = new URL(
    typeof input === 'string' ? input : input.url || String(input)
  )
  assert.equal(target.origin, url, 'Staging HTTP target must stay pinned')
  return originalFetch(input, options)
}
function cli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'cmd.exe',
      ['/d', '/c', 'npx.cmd', '--no-install', 'supabase', ...args],
      { windowsHide: true }
    )
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.stderr.on('data', () => {})
    child.on('error', () =>
      reject(new Error('Staging CLI launch failed; output suppressed'))
    )
    child.on('close', (code) => {
      if (code)
        return reject(new Error('Staging CLI failed; response suppressed'))
      try {
        resolve(JSON.parse(output.slice(output.indexOf('{'))))
      } catch {
        reject(new Error('Invalid staging CLI response; output suppressed'))
      }
    })
  })
}
function query(sql) {
  const filename = path.join(temp, `query-${queryIndex++}.sql`)
  fs.writeFileSync(filename, sql)
  return cli([
    'db',
    'query',
    '--linked',
    '--project-ref',
    ref,
    '--file',
    filename,
  ])
}
const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'"
function pass(test, detail = {}) {
  results.push({ test, result: 'PASS', ...detail })
  console.log(JSON.stringify(results[results.length - 1]))
}
async function ok(promise, label) {
  const response = await promise
  if (response.error)
    throw new Error(
      `${label}: rejected (${
        response.error.code ||
        response.error.statusCode ||
        response.error.status ||
        'provider'
      })`
    )
  return response.data
}
async function denied(promise, label) {
  const response = await promise
  assert(response.error, label + ': must reject')
  return response.error.code || response.error.statusCode
}
const config = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
}
const digest = (buffer) =>
  crypto.createHash('sha256').update(buffer).digest('hex')
const signatureModule = { exports: {} }
new Function(
  'exports',
  ts.transpileModule(fs.readFileSync('lib/listing-images.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
)(signatureModule.exports)
const signature = signatureModule.exports.hasImageSignature
const descriptor = (buffer, mime, name = 'test-image') => ({
  original_name: name,
  mime_type: mime,
  size_bytes: buffer.length,
  sha256: digest(buffer),
})
async function prepare(
  client,
  conversation,
  descriptors,
  nonce = crypto.randomUUID()
) {
  return ok(
    client.rpc('marketplace_prepare_image_message', {
      p_conversation_id: conversation,
      p_client_message_id: nonce,
      p_images: descriptors,
    }),
    'prepare'
  )
}
async function authorizedUpload(
  client,
  submissionId,
  imageId,
  bytes,
  proposedPath
) {
  const actor = await ok(client.auth.getUser(), 'verify session')
  const submission = await ok(
    client
      .from('image_message_submissions')
      .select('*')
      .eq('id', submissionId)
      .maybeSingle(),
    'submission RLS'
  )
  assert(
    submission &&
      submission.sender_id === actor.user.id &&
      submission.state === 'pending',
    'sender reservation required'
  )
  assert(
    Date.parse(submission.expires_at) > Date.now(),
    'unexpired reservation required'
  )
  const conversation = await ok(
    client
      .from('conversations')
      .select('id')
      .eq('id', submission.conversation_id)
      .maybeSingle(),
    'conversation RLS'
  )
  assert(conversation, 'participant required')
  const item = submission.manifest.find((image) => image.id === imageId)
  assert(
    item && (!proposedPath || proposedPath === item.storage_path),
    'exact reserved slot/path required'
  )
  assert(
    bytes.length > 0 &&
      bytes.length <= 3145728 &&
      bytes.length === item.size_bytes,
    'bounded exact bytes required'
  )
  assert(
    signature(bytes, item.mime_type) && digest(bytes) === item.sha256,
    'verified signature/hash required'
  )
  storagePaths.add(item.storage_path)
  const uploaded = await admin.storage
    .from('chat-images')
    .upload(item.storage_path, bytes, {
      contentType: item.mime_type,
      upsert: false,
      cacheControl: '0',
    })
  if (uploaded.error)
    assert(
      uploaded.error.statusCode === '409' ||
        uploaded.error.statusCode === 409 ||
        uploaded.error.statusCode === '400',
      'only duplicate upload may reconcile'
    )
  const info = await ok(
    admin.storage.from('chat-images').info(item.storage_path),
    'Storage info'
  )
  assert.equal(info.id, uploaded.data?.id || info.id)
  const stored = Buffer.from(
    await (
      await ok(
        admin.storage.from('chat-images').download(item.storage_path),
        'private byte verification'
      )
    ).arrayBuffer()
  )
  assert.equal(stored.length, item.size_bytes)
  assert(signature(stored, item.mime_type))
  assert.equal(digest(stored), item.sha256)
  await ok(
    admin.rpc('marketplace_record_verified_chat_image', {
      p_submission_id: submission.id,
      p_image_id: imageId,
      p_actor_id: actor.user.id,
      p_object_id: info.id,
      p_sha256: digest(stored),
    }),
    'trusted receipt'
  )
  return info.id
}
async function finalize(client, submission) {
  return ok(
    client.rpc('marketplace_finalize_image_message', {
      p_submission_id: submission.id,
    }),
    'finalize'
  )
}
async function imageSend(client, conversation, images) {
  const submission = await prepare(
    client,
    conversation,
    images.map((item) => descriptor(item.bytes, item.mime))
  )
  for (let i = 0; i < images.length; i++)
    await authorizedUpload(
      client,
      submission.id,
      submission.manifest[i].id,
      images[i].bytes
    )
  return { submission, message: await finalize(client, submission) }
}
async function text(
  client,
  conversation,
  content,
  nonce = crypto.randomUUID()
) {
  return ok(
    client.rpc('marketplace_send_text', {
      p_conversation_id: conversation,
      p_client_message_id: nonce,
      p_content: content,
    }),
    'TEXT'
  )
}
async function signedRead(client, messageId) {
  await ok(client.auth.getUser(), 'read session')
  const images = await ok(
    client
      .from('message_images')
      .select('*')
      .eq('message_id', messageId)
      .order('position'),
    'image RLS'
  )
  assert(images.length > 0, 'authorized image metadata required before signing')
  const signed = await ok(
    admin.storage.from('chat-images').createSignedUrls(
      images.map((item) => item.storage_path),
      300
    ),
    'batch signing'
  )
  assert.equal(signed.length, images.length)
  for (let n = 0; n < signed.length; n++) {
    assert(!signed[n].error && signed[n].signedUrl, 'all signed paths required')
    const token = new URL(signed[n].signedUrl).searchParams.get('token')
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'))
    assert(claims.exp - claims.iat <= 305 && claims.exp - claims.iat >= 295)
    const response = await fetch(signed[n].signedUrl)
    assert.equal(response.status, 200)
    assert.equal(
      digest(Buffer.from(await response.arrayBuffer())),
      images[n].sha256
    )
  }
  return images
}
async function concurrent(label, firstClientId, firstSql, secondSql, same) {
  const application = `phase2b_${run}_${label}`
  const auth = `set local role authenticated; select set_config('request.jwt.claim.sub','${firstClientId}',true); select set_config('request.jwt.claims','{"sub":"${firstClientId}","role":"authenticated"}',true);`
  const first = query(
    `begin; ${auth} select set_config('application_name','${application}',true); create temp table result as ${firstSql}; select pg_sleep(12); select id,sequence,pg_backend_pid() as pid from result; commit;`
  )
  first.catch(() => {})
  try {
    let observed = false
    for (let attempt = 0; attempt < 8 && !observed; attempt++) {
      const locks = await query(
        `select count(*) as held from pg_stat_activity a join pg_locks l on l.pid=a.pid where a.application_name='${application}' and l.relation='public.messages'::regclass and l.mode='RowExclusiveLock' and l.granted;`
      )
      observed = Number(locks.rows[0].held) > 0
    }
    assert(observed, 'first session lock must actually be observed')
    const second = query(
      `begin; ${auth} create temp table start as select clock_timestamp() as at; create temp table result as ${secondSql}; select id,sequence,pg_backend_pid() as pid,extract(epoch from clock_timestamp()-(select at from start)) as waited from result; commit;`
    )
    const [a, b] = await Promise.all([first, second])
    assert.notEqual(a.rows[0].pid, b.rows[0].pid)
    assert(Number(b.rows[0].waited) > 1)
    if (same) {
      assert.equal(a.rows[0].id, b.rows[0].id)
      assert.equal(a.rows[0].sequence, b.rows[0].sequence)
    } else
      assert.equal(Number(b.rows[0].sequence), Number(a.rows[0].sequence) + 1)
    pass(label, {
      independentSessions: true,
      firstSequence: a.rows[0].sequence,
      secondSequence: b.rows[0].sequence,
      secondWaitSeconds: Number(b.rows[0].waited),
    })
  } finally {
    await first
  }
}

async function main() {
  const projects = await cli(['projects', 'list'])
  const linked = projects.projects.filter((item) => item.linked)
  assert.equal(linked.length, 1)
  assert.equal(linked[0].name, 'western-marketplace-staging')
  assert.equal(linked[0].ref, ref)
  pass('staging target pinned', { project: linked[0].name, ref })
  const keys = await cli(['projects', 'api-keys', '--project-ref', ref])
  const publicKey = keys.keys.find((item) => item.name === 'anon').api_key
  const privateKey = keys.keys.find(
    (item) => item.name === 'service_role'
  ).api_key
  assert.equal(
    JSON.parse(Buffer.from(privateKey.split('.')[1], 'base64url')).ref,
    ref
  )
  admin = createClient(url, privateKey, config)
  const buckets = await ok(admin.storage.listBuckets(), 'buckets')
  const bucket = buckets.find((item) => item.id === 'chat-images')
  assert.equal(bucket.public, false)
  assert.equal(bucket.file_size_limit, 3145728)
  assert.deepEqual(bucket.allowed_mime_types, [
    'image/jpeg',
    'image/png',
    'image/webp',
  ])
  assert.equal(
    buckets.find((item) => item.id === 'listing-images').public,
    true
  )
  pass('private bucket and unchanged listing bucket')
  if (process.argv.includes('--cleanup-isolation')) {
    const namespace = crypto.randomUUID()
    const paths = [1, 2].map(
      () => `${namespace}/${crypto.randomUUID()}/${crypto.randomUUID()}`
    )
    const bytes = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#663399' },
    })
      .png()
      .toBuffer()
    try {
      for (const objectPath of paths)
        await ok(
          admin.storage.from('chat-images').upload(objectPath, bytes, {
            contentType: 'image/png',
            upsert: false,
          }),
          'administrative cleanup fixture upload'
        )
      await query(
        `insert into marketplace_private.chat_image_cleanup(storage_path) values('${paths[0]}');`
      )
      assert.equal(
        await ok(
          admin.rpc('marketplace_ack_chat_image_cleanup', {
            p_storage_path: paths[0],
          }),
          'existing object ack'
        ),
        false
      )
      const removed = await ok(
        admin.storage.from('chat-images').remove([paths[0]]),
        'scoped orphan remove'
      )
      assert.deepEqual(
        removed.map((item) => item.name),
        [paths[0]]
      )
      assert(
        (await admin.storage.from('chat-images').download(paths[0])).error,
        'removed orphan download must fail'
      )
      const untouched = await ok(
        admin.storage.from('chat-images').download(paths[1]),
        'unrelated object stays readable'
      )
      assert.equal(
        digest(Buffer.from(await untouched.arrayBuffer())),
        digest(bytes)
      )
      assert.equal(
        await ok(
          admin.rpc('marketplace_ack_chat_image_cleanup', {
            p_storage_path: paths[0],
          }),
          'young queue ack'
        ),
        false
      )
      await query(
        `update marketplace_private.chat_image_cleanup set queued_at=clock_timestamp()-interval '11 minutes' where storage_path='${paths[0]}';`
      )
      assert.equal(
        await ok(
          admin.rpc('marketplace_ack_chat_image_cleanup', {
            p_storage_path: paths[0],
          }),
          'eligible queue ack'
        ),
        true
      )
      pass(
        'physical orphan remove returns exact path; unrelated private object untouched; guarded ack',
        { fixtureClockSimulated: true }
      )
    } finally {
      await ok(
        admin.storage.from('chat-images').remove(paths),
        'cleanup isolated Storage fixtures'
      )
      await query(
        `update marketplace_private.chat_image_cleanup set queued_at=clock_timestamp()-interval '11 minutes' where storage_path='${paths[0]}';`
      )
      await ok(
        admin.rpc('marketplace_ack_chat_image_cleanup', {
          p_storage_path: paths[0],
        }),
        'isolated cleanup ack'
      )
      for (const objectPath of paths)
        assert((await admin.storage.from('chat-images').info(objectPath)).error)
      pass('isolated cleanup fixture paths removed')
    }
    return
  }
  const clients = []
  for (const role of ['Seller', 'Buyer', 'Outsider']) {
    const email = `phase2b-${run}-${role.toLowerCase()}@uwo.ca`
    const password = crypto.randomBytes(24).toString('hex') + 'Aa!9'
    const user = await ok(
      admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { username: `P2B_${role[0]}_${run}` },
      }),
      'fixture identity'
    )
    fixturesCreated = true
    ids.push(user.user.id)
    const client = createClient(url, publicKey, config)
    const session = await ok(
      client.auth.signInWithPassword({ email, password }),
      'real GoTrue password session'
    )
    assert.equal(session.user.id, user.user.id)
    clients.push(client)
  }
  const [seller, buyer, outsider] = clients
  pass('three real authenticated Western fixture sessions')
  const jpeg = await sharp({
    create: { width: 8, height: 8, channels: 3, background: '#663399' },
  })
    .jpeg()
    .toBuffer()
  const png = await sharp({
    create: { width: 8, height: 8, channels: 3, background: '#339966' },
  })
    .png()
    .toBuffer()
  const webp = await sharp({
    create: { width: 8, height: 8, channels: 3, background: '#996633' },
  })
    .webp()
    .toBuffer()
  const formats = [
    { bytes: jpeg, mime: 'image/jpeg' },
    { bytes: png, mime: 'image/png' },
    { bytes: webp, mime: 'image/webp' },
    { bytes: jpeg, mime: 'image/jpeg' },
  ]
  for (let n = 0; n < 2; n++) {
    const lid = crypto.randomUUID(),
      iid = crypto.randomUUID()
    listings.push(lid)
    const objectPath = `${ids[0]}/${lid}/${iid}`
    listingPaths.push(objectPath)
    // Listing publication fixture metadata only. No listing-images bytes are uploaded.
    await query(`begin; select set_config('request.jwt.claim.sub','${ids[0]}',true); select set_config('request.jwt.claims','{"sub":"${ids[0]}","role":"authenticated"}',true);
      insert into public.listings(id,seller_id,title,price_cents,currency,category,subcategory,pickup_area,expected_image_count) values('${lid}','${ids[0]}','Phase2B disposable ${n}',4500,'CAD','Home & Dorm','Furniture','Staging fixture',1);
      insert into public.listing_images(id,listing_id,owner_id,slot) values('${iid}','${lid}','${ids[0]}',1);
      insert into storage.objects(bucket_id,name,metadata) values('listing-images','${objectPath}','{"mimetype":"image/jpeg","size":100}');
      update public.listing_images set ready=true where id='${iid}'; select public.marketplace_finalize_listing('${lid}'); commit;`)
    const c = await ok(
      buyer.rpc('marketplace_find_or_create_conversation', {
        p_listing_id: lid,
      }),
      'Phase1 conversation flow'
    )
    conversations.push(c.id)
  }
  const conversation = conversations[0]
  const d = descriptor(jpeg, 'image/jpeg')
  if (process.argv.includes('--activity-race')) {
    await text(buyer, conversation, 'TEXT start')
    const first = await imageSend(buyer, conversation, [formats[0]])
    const state = await ok(
      buyer.from('conversations').select('*').eq('id', conversation).single(),
      'IMAGE activity'
    )
    assert.equal(state.last_message_sequence, 2)
    assert.equal(state.last_message_at, first.message.created_at)
    assert.equal(state.buyer_last_read_sequence, 2)
    const preview = (message) =>
      message.type === 'IMAGE'
        ? message.image_count === 1
          ? 'Photo'
          : `${message.image_count} photos`
        : message.content
    assert.equal(preview(first.message), 'Photo')
    await text(seller, conversation, 'TEXT middle')
    const four = await imageSend(buyer, conversation, formats)
    assert.equal(preview(four.message), '4 photos')
    const last = await ok(
      buyer.from('conversations').select('*').eq('id', conversation).single(),
      'four-image activity'
    )
    assert.equal(last.last_message_sequence, 4)
    assert.equal(last.last_message_at, four.message.created_at)
    assert.equal(last.buyer_last_read_sequence, 4)
    const history = await ok(
      seller
        .from('messages')
        .select('id,type,image_count,sequence')
        .eq('conversation_id', conversation)
        .order('sequence'),
      'mixed preview data'
    )
    assert.deepEqual(
      history.map((item) => item.sequence),
      [1, 2, 3, 4]
    )
    assert.equal(preview(history[3]), '4 photos')
    await denied(
      buyer.rpc('marketplace_abandon_image_message', {
        p_submission_id: first.submission.id,
      }),
      'sent cancel forbidden'
    )
    const empty = await prepare(buyer, conversation, [d])
    await ok(
      buyer.rpc('marketplace_abandon_image_message', {
        p_submission_id: empty.id,
      }),
      'cancel before upload'
    )
    await denied(
      buyer.rpc('marketplace_finalize_image_message', {
        p_submission_id: empty.id,
      }),
      'cancelled empty finalize'
    )
    pass(
      'Photo/N photos projection, IMAGE activity/time/sender watermark, cancel before upload and sent cancel denial'
    )
    const race = await prepare(buyer, conversation, [d])
    await authorizedUpload(buyer, race.id, race.manifest[0].id, jpeg)
    const application = `phase2b_cancel_${run}`
    const firstCancel = query(
      `begin; set local role authenticated; select set_config('request.jwt.claim.sub','${ids[1]}',true); select set_config('request.jwt.claims','{"sub":"${ids[1]}","role":"authenticated"}',true); select set_config('application_name','${application}',true); create temp table result as select * from public.marketplace_abandon_image_message('${race.id}'); select pg_sleep(8); select id,state,pg_backend_pid() as pid from result; commit;`
    )
    firstCancel.catch(() => {})
    try {
      let held = false
      for (let attempt = 0; attempt < 5 && !held; attempt++) {
        const observed = await query(
          `select count(*) as held from pg_stat_activity a join pg_locks l on l.pid=a.pid where a.application_name='${application}' and l.relation='public.image_message_submissions'::regclass and l.mode='RowExclusiveLock' and l.granted;`
        )
        held = Number(observed.rows[0].held) > 0
      }
      assert(held)
      const start = Date.now()
      await denied(
        buyer.rpc('marketplace_finalize_image_message', {
          p_submission_id: race.id,
        }),
        'concurrent cancelled finalize'
      )
      const waited = (Date.now() - start) / 1000
      assert(waited > 1)
      assert.equal((await firstCancel).rows[0].state, 'abandoned')
      assert.equal(
        (
          await ok(
            buyer.from('messages').select('id').eq('id', race.id),
            'no cancelled race message'
          )
        ).length,
        0
      )
      pass('real cancellation/finalize race chooses abandoned only', {
        secondWaitSeconds: waited,
      })
    } finally {
      await firstCancel
    }
    return
  }
  await denied(
    outsider.rpc('marketplace_prepare_image_message', {
      p_conversation_id: conversation,
      p_client_message_id: crypto.randomUUID(),
      p_images: [d],
    }),
    'outsider prepare'
  )
  await denied(
    buyer.rpc('marketplace_prepare_image_message', {
      p_conversation_id: crypto.randomUUID(),
      p_client_message_id: crypto.randomUUID(),
      p_images: [d],
    }),
    'wrong conversation'
  )
  for (const images of [
    [],
    [d, d, d, d, d],
    [{ ...d, storage_path: 'arbitrary' }],
    [{ ...d, position: 1 }],
    [{ ...d, size_bytes: 3145729 }],
    [{ ...d, mime_type: 'image/gif' }],
  ])
    await denied(
      buyer.rpc('marketplace_prepare_image_message', {
        p_conversation_id: conversation,
        p_client_message_id: crypto.randomUUID(),
        p_images: images,
      }),
      'invalid manifest'
    )
  const nonce = crypto.randomUUID()
  const one = await prepare(buyer, conversation, [d], nonce)
  const same = await prepare(buyer, conversation, [d], nonce)
  assert.equal(same.id, one.id)
  assert.equal(same.expires_at, one.expires_at)
  assert.equal(
    one.manifest[0].storage_path,
    `${conversation}/${one.id}/${one.manifest[0].id}`
  )
  await denied(
    buyer.rpc('marketplace_prepare_image_message', {
      p_conversation_id: conversation,
      p_client_message_id: nonce,
      p_images: [{ ...d, sha256: '0'.repeat(64) }],
    }),
    'nonce payload conflict'
  )
  const sellerPending = await prepare(seller, conversation, [d])
  await ok(
    seller.rpc('marketplace_abandon_image_message', {
      p_submission_id: sellerPending.id,
    }),
    'seller abandon'
  )
  assert.equal(
    (
      await ok(
        seller.from('image_message_submissions').select('id').eq('id', one.id),
        'recipient pending RLS'
      )
    ).length,
    0
  )
  await denied(
    buyer.rpc('marketplace_send_text', {
      p_conversation_id: conversation,
      p_client_message_id: nonce,
      p_content: 'nonce collision',
    }),
    'cross-type nonce'
  )
  pass(
    'prepare limits, canonical paths, both participants, outsider/namespace rejection, exact/conflicting retry'
  )
  for (const client of [buyer, seller, outsider]) {
    await denied(
      client.storage
        .from('chat-images')
        .upload(one.manifest[0].storage_path, jpeg, {
          contentType: 'image/jpeg',
        }),
      'direct client upload'
    )
    await denied(
      client.storage
        .from('chat-images')
        .createSignedUploadUrl(one.manifest[0].storage_path, { upsert: true }),
      'signed upload token bypass'
    )
    await denied(
      client.rpc('marketplace_record_verified_chat_image', {
        p_submission_id: one.id,
        p_image_id: one.manifest[0].id,
        p_actor_id: ids[1],
        p_object_id: crypto.randomUUID(),
        p_sha256: d.sha256,
      }),
      'client forged receipt'
    )
  }
  await assert.rejects(
    authorizedUpload(outsider, one.id, one.manifest[0].id, jpeg)
  )
  await assert.rejects(
    authorizedUpload(seller, one.id, one.manifest[0].id, jpeg)
  )
  await assert.rejects(
    authorizedUpload(buyer, one.id, one.manifest[0].id, jpeg, 'arbitrary/path')
  )
  await assert.rejects(
    authorizedUpload(
      buyer,
      one.id,
      one.manifest[0].id,
      Buffer.from('bad bytes')
    )
  )
  await denied(
    buyer.rpc('marketplace_finalize_image_message', {
      p_submission_id: one.id,
    }),
    'missing object/receipt'
  )
  await text(buyer, conversation, '  TEXT before image\nline  ')
  const objectId = await authorizedUpload(
    buyer,
    one.id,
    one.manifest[0].id,
    jpeg
  )
  await authorizedUpload(buyer, one.id, one.manifest[0].id, jpeg)
  await denied(
    admin.rpc('marketplace_record_verified_chat_image', {
      p_submission_id: one.id,
      p_image_id: one.manifest[0].id,
      p_actor_id: ids[0],
      p_object_id: objectId,
      p_sha256: d.sha256,
    }),
    'wrong receipt actor'
  )
  await denied(
    admin.rpc('marketplace_record_verified_chat_image', {
      p_submission_id: one.id,
      p_image_id: one.manifest[0].id,
      p_actor_id: ids[1],
      p_object_id: objectId,
      p_sha256: '0'.repeat(64),
    }),
    'wrong receipt hash'
  )
  await denied(
    admin.rpc('marketplace_record_verified_chat_image', {
      p_submission_id: one.id,
      p_image_id: crypto.randomUUID(),
      p_actor_id: ids[1],
      p_object_id: objectId,
      p_sha256: d.sha256,
    }),
    'wrong receipt slot'
  )
  const firstImage = await finalize(buyer, one)
  assert.equal(firstImage.type, 'IMAGE')
  assert.equal(firstImage.content, null)
  assert.equal(firstImage.sequence, 2)
  assert.equal(firstImage.image_count, 1)
  assert.equal(firstImage.sender_id, ids[1])
  assert.equal(firstImage.conversation_id, conversation)
  assert.deepEqual(await finalize(buyer, one), firstImage)
  await text(seller, conversation, 'TEXT between images')
  assert.deepEqual(await finalize(buyer, one), firstImage)
  const current = await ok(
    buyer.from('conversations').select('*').eq('id', conversation).single(),
    'canonical activity'
  )
  assert.equal(current.buyer_last_read_sequence, 2)
  assert.equal(current.seller_last_read_sequence, 3)
  pass(
    'real private JPEG, receipt integrity, one-image finalize and exact/lost-response retry'
  )
  const four = await imageSend(buyer, conversation, formats)
  assert.equal(four.message.sequence, 4)
  assert.equal(four.message.image_count, 4)
  const images = await signedRead(buyer, four.message.id)
  assert.deepEqual(
    images.map((item) => item.position),
    [1, 2, 3, 4]
  )
  await signedRead(seller, four.message.id)
  await assert.rejects(signedRead(outsider, four.message.id))
  const outsiderRows = await ok(
    outsider
      .from('message_images')
      .select('id')
      .eq('message_id', four.message.id),
    'outsider image RLS'
  )
  assert.equal(outsiderRows.length, 0)
  for (const client of [buyer, seller, outsider]) {
    await denied(
      client.storage.from('chat-images').download(images[0].storage_path),
      'direct private read'
    )
    await denied(
      client.storage
        .from('chat-images')
        .createSignedUrl(images[0].storage_path, 300),
      'direct signing'
    )
    await denied(
      client.storage
        .from('chat-images')
        .update(images[0].storage_path, jpeg, { contentType: 'image/jpeg' }),
      'sent overwrite'
    )
  }
  const publicResponse = await fetch(
    `${url}/storage/v1/object/public/chat-images/${images[0].storage_path}`
  )
  assert(publicResponse.status !== 200)
  const rows = await ok(
    buyer
      .from('messages')
      .select('id,type,sequence,content')
      .eq('conversation_id', conversation)
      .order('sequence'),
    'mixed history'
  )
  assert.deepEqual(
    rows.map((item) => item.type),
    ['TEXT', 'IMAGE', 'TEXT', 'IMAGE']
  )
  assert.deepEqual(
    rows.map((item) => item.sequence),
    [1, 2, 3, 4]
  )
  assert.equal(rows[0].content, 'TEXT before image\nline')
  pass(
    'four images as one, ordered mixed history, batch five-minute private reads, outsider/public denial'
  )

  for (const missing of [0, 1, 3]) {
    const partial = await prepare(
      buyer,
      conversation,
      formats.map((item) => descriptor(item.bytes, item.mime))
    )
    for (let n = 0; n < 4; n++)
      if (n !== missing)
        await authorizedUpload(
          buyer,
          partial.id,
          partial.manifest[n].id,
          formats[n].bytes
        )
    await denied(
      buyer.rpc('marketplace_finalize_image_message', {
        p_submission_id: partial.id,
      }),
      'incomplete finalize'
    )
    assert.equal(
      (
        await ok(
          buyer.from('messages').select('id').eq('id', partial.id),
          'no partial history'
        )
      ).length,
      0
    )
    await ok(
      buyer.rpc('marketplace_abandon_image_message', {
        p_submission_id: partial.id,
      }),
      'partial cancellation'
    )
    await ok(
      buyer.rpc('marketplace_abandon_image_message', {
        p_submission_id: partial.id,
      }),
      'cancel retry'
    )
  }
  const bad = await prepare(buyer, conversation, [d])
  const badPath = bad.manifest[0].storage_path
  storagePaths.add(badPath)
  const wrongMime = await ok(
    admin.storage
      .from('chat-images')
      .upload(badPath, jpeg, { contentType: 'image/png', upsert: false }),
    'administrative metadata mismatch fixture'
  )
  await denied(
    admin.rpc('marketplace_record_verified_chat_image', {
      p_submission_id: bad.id,
      p_image_id: bad.manifest[0].id,
      p_actor_id: ids[1],
      p_object_id: wrongMime.id,
      p_sha256: d.sha256,
    }),
    'MIME receipt mismatch'
  )
  await denied(
    buyer.rpc('marketplace_finalize_image_message', {
      p_submission_id: bad.id,
    }),
    'unverified mismatch finalize'
  )
  await ok(
    buyer.rpc('marketplace_abandon_image_message', { p_submission_id: bad.id }),
    'bad manifest abandon'
  )
  const rawPath = `${conversation}/${crypto.randomUUID()}/${crypto.randomUUID()}`
  storagePaths.add(rawPath)
  await denied(
    admin.storage
      .from('chat-images')
      .upload(rawPath, Buffer.from('GIF89a'), { contentType: 'image/gif' }),
    'bucket MIME restriction'
  )
  await denied(
    admin.storage
      .from('chat-images')
      .upload(rawPath, Buffer.alloc(3145729), { contentType: 'image/png' }),
    'bucket size restriction'
  )
  pass(
    'missing first/middle/last, MIME/hash/actor/slot receipt mismatches, no partial history, real bucket MIME/size limits'
  )

  await denied(
    outsider.rpc('marketplace_finalize_image_message', {
      p_submission_id: one.id,
    }),
    'outsider finalize'
  )
  await denied(
    outsider.rpc('marketplace_abandon_image_message', {
      p_submission_id: one.id,
    }),
    'outsider abandon'
  )
  assert.equal(
    await ok(
      admin.rpc('marketplace_ack_chat_image_cleanup', {
        p_storage_path: images[0].storage_path,
      }),
      'live reference cleanup'
    ),
    false
  )
  const wrongSize = await prepare(buyer, conversation, [d])
  const wrongSizePath = wrongSize.manifest[0].storage_path
  storagePaths.add(wrongSizePath)
  const sizeObject = await ok(
    admin.storage
      .from('chat-images')
      .upload(wrongSizePath, Buffer.concat([jpeg, Buffer.from([0])]), {
        contentType: 'image/jpeg',
        upsert: false,
      }),
    'administrative size mismatch fixture'
  )
  await denied(
    admin.rpc('marketplace_record_verified_chat_image', {
      p_submission_id: wrongSize.id,
      p_image_id: wrongSize.manifest[0].id,
      p_actor_id: ids[1],
      p_object_id: sizeObject.id,
      p_sha256: d.sha256,
    }),
    'stored size receipt mismatch'
  )
  await ok(
    buyer.rpc('marketplace_abandon_image_message', {
      p_submission_id: wrongSize.id,
    }),
    'size mismatch abandon'
  )
  const boundBytes = Buffer.concat([jpeg, Buffer.alloc(3145728 - jpeg.length)])
  const exactBound = await prepare(buyer, conversation, [
    descriptor(boundBytes, 'image/jpeg'),
  ])
  await authorizedUpload(
    buyer,
    exactBound.id,
    exactBound.manifest[0].id,
    boundBytes
  )
  await ok(
    buyer.rpc('marketplace_abandon_image_message', {
      p_submission_id: exactBound.id,
    }),
    'exact-size fixture abandon'
  )
  pass(
    'exact 3 MiB accepted, stored size mismatch rejected, outsider finalize/cancel denied'
  )

  const integrity = await prepare(buyer, conversation, [d])
  await authorizedUpload(buyer, integrity.id, integrity.manifest[0].id, jpeg)
  await query(`begin;
    select set_config('request.jwt.claim.sub','${ids[1]}',true);
    select set_config('request.jwt.claims','{"sub":"${ids[1]}","role":"authenticated"}',true);
    do $$ declare rejected boolean := false; begin
      begin
        insert into public.messages(id,conversation_id,sender_id,client_message_id,type,content,image_count)
        values('${integrity.id}','${conversation}','${ids[1]}','${integrity.client_message_id}','IMAGE',null,1);
        set constraints all immediate;
      exception when check_violation then
        if sqlerrm not like 'Sent IMAGE needs exactly%' then raise; end if;
        rejected := true;
      end;
      if not rejected then raise exception 'Incomplete IMAGE parent committed'; end if;
    end; $$;
    do $$ begin
      begin update public.message_images set original_name='edited' where id='${images[0].id}';
        raise exception 'Image mutation unexpectedly permitted';
      exception when check_violation then
        if sqlerrm <> 'Sent image records are immutable.' then raise; end if;
      end;
      begin delete from public.message_images where id='${images[0].id}';
        raise exception 'Image deletion unexpectedly permitted';
      exception when check_violation then
        if sqlerrm <> 'Sent image records are immutable.' then raise; end if;
      end;
    end; $$;
    select 'PASS' as deferred_and_immutable_guards; rollback;`)
  await ok(
    buyer.rpc('marketplace_abandon_image_message', {
      p_submission_id: integrity.id,
    }),
    'integrity fixture abandon'
  )
  pass(
    'actual deferred incomplete-parent rejection and privileged sent-child immutability'
  )

  const expired = await prepare(buyer, conversation, [d])
  await authorizedUpload(buyer, expired.id, expired.manifest[0].id, jpeg)
  // Fixture-clock simulation ONLY, scoped to one disposable row in one transaction.
  // Guard is re-enabled before any real authenticated/operator expiry assertions.
  await query(`begin; alter table public.image_message_submissions disable trigger image_submission_guard;
    update public.image_message_submissions set expires_at=clock_timestamp()-interval '1 minute' where id='${expired.id}';
    alter table public.image_message_submissions enable trigger image_submission_guard; commit;`)
  await denied(
    buyer.rpc('marketplace_finalize_image_message', {
      p_submission_id: expired.id,
    }),
    'expired complete upload cannot finalize'
  )
  assert.equal(
    await ok(
      admin.rpc('marketplace_expire_image_submissions', { p_limit: 1 }),
      'bounded expiry'
    ),
    1
  )
  assert.equal(
    await ok(
      admin.rpc('marketplace_expire_image_submissions', { p_limit: 1 }),
      'repeat expiry'
    ),
    0
  )
  assert.equal(
    (
      await ok(
        buyer.from('messages').select('id').eq('id', expired.id),
        'expired history'
      )
    ).length,
    0
  )
  pass(
    'complete upload expiry rejection, bounded operator expiry and idempotent queueing',
    { fixtureClockSimulated: true }
  )

  const pending = []
  for (let n = 0; n < 4; n++) {
    const s = await prepare(buyer, conversation, [d])
    await authorizedUpload(buyer, s.id, s.manifest[0].id, jpeg)
    pending.push(s)
  }
  const finishSql = (s) =>
    `select * from public.marketplace_finalize_image_message('${s.id}')`
  await concurrent(
    'same IMAGE finalize',
    ids[1],
    finishSql(pending[0]),
    finishSql(pending[0]),
    true
  )
  await concurrent(
    'different IMAGE finalize',
    ids[1],
    finishSql(pending[1]),
    finishSql(pending[2]),
    false
  )
  await concurrent(
    'TEXT plus IMAGE',
    ids[1],
    `select * from public.marketplace_send_text('${conversation}','${crypto.randomUUID()}','Concurrent TEXT')`,
    finishSql(pending[3]),
    false
  )
  const sequenceRows = await ok(
    buyer
      .from('messages')
      .select('sequence')
      .eq('conversation_id', conversation)
      .order('sequence'),
    'final sequence consistency'
  )
  assert.deepEqual(
    sequenceRows.map((item) => item.sequence),
    sequenceRows.map((_, n) => n + 1)
  )

  for (const client of [buyer, seller, outsider]) {
    await denied(
      client.from('message_images').insert({
        id: crypto.randomUUID(),
        message_id: four.message.id,
        position: 1,
        storage_path: 'bad',
        original_name: 'bad',
        mime_type: 'image/jpeg',
        size_bytes: 1,
        sha256: '0'.repeat(64),
      }),
      'direct image INSERT'
    )
    await denied(
      client
        .from('image_message_submissions')
        .update({ state: 'abandoned' })
        .eq('id', one.id),
      'direct reservation UPDATE'
    )
    await denied(
      client.from('message_images').delete().eq('message_id', four.message.id),
      'direct child DELETE'
    )
    await denied(
      client.rpc('marketplace_expire_image_submissions', { p_limit: 1 }),
      'operator-only expiry'
    )
    await denied(
      client.rpc('marketplace_ack_chat_image_cleanup', {
        p_storage_path: images[0].storage_path,
      }),
      'operator-only cleanup'
    )
  }
  pass('direct-write and operator RPC privilege denial')
  await ok(
    seller.from('listings').update({ status: 'sold' }).eq('id', listings[0]),
    'sold listing'
  )
  await signedRead(buyer, four.message.id)
  await imageSend(seller, conversation, [formats[2]])
  await denied(
    outsider.rpc('marketplace_find_or_create_conversation', {
      p_listing_id: listings[0],
    }),
    'sold unrelated entry'
  )
  await ok(
    seller.from('listings').delete().eq('id', listings[0]),
    'listing deletion'
  )
  await signedRead(buyer, four.message.id)
  await imageSend(buyer, conversation, [formats[1]])
  const preserved = await ok(
    buyer.from('conversations').select('*').eq('id', conversation).single(),
    'historical context'
  )
  assert.equal(preserved.listing_id, null)
  assert.equal(preserved.listing_origin_id, listings[0])
  assert.equal(preserved.listing_title_snapshot, 'Phase2B disposable 0')
  pass('sold/deleted listing history, signed reads and additional IMAGE sends')

  // Explicit administrative boundary test: seller deletion remains blocked by owned listing FK.
  try {
    await query(`delete from auth.users where id='${ids[0]}';`)
    assert.fail('seller deletion must be blocked while another listing remains')
  } catch (error) {
    assert(!error.message.includes('must be blocked'))
  }
  await ok(admin.auth.admin.deleteUser(ids[1]), 'buyer deletion fixture')
  await signedRead(seller, four.message.id)
  assert.equal(
    (
      await ok(
        seller
          .from('conversations')
          .select('buyer_id')
          .eq('id', conversation)
          .single(),
        'surviving seller'
      )
    ).buyer_id,
    null
  )
  pass(
    'buyer deletion preserves images; owned-listing seller deletion restriction preserved'
  )
}

async function cleanup() {
  if (!fixturesCreated) return
  // Metadata cascades first; physical objects are removed only through supported Storage API.
  if (listings.length)
    await query(
      `delete from public.conversations where listing_origin_id in (${listings
        .map(quote)
        .join(',')}); delete from public.listings where id in (${listings
        .map(quote)
        .join(',')});`
    )
  for (const bucket of ['chat-images', 'listing-images']) {
    const paths = bucket === 'chat-images' ? [...storagePaths] : listingPaths
    for (let start = 0; start < paths.length; start += 50) {
      const batch = paths.slice(start, start + 50)
      await ok(
        admin.storage.from(bucket).remove(batch),
        'physical fixture cleanup'
      )
      for (const objectPath of batch) {
        const exists = await admin.storage.from(bucket).info(objectPath)
        assert(exists.error, 'fixture object must be physically absent')
      }
    }
  }
  const paths = await query(
    `select storage_path from marketplace_private.chat_image_cleanup where split_part(storage_path,'/',1) in (${
      conversations.map(quote).join(',') || 'null'
    });`
  )
  if (paths.rows.length) {
    const sample = paths.rows[0].storage_path
    assert.equal(
      await ok(
        admin.rpc('marketplace_ack_chat_image_cleanup', {
          p_storage_path: sample,
        }),
        'young queue guard'
      ),
      false
    )
    // Explicit admin fixture-clock simulation, scoped to this run, not a production policy change.
    await query(
      `update marketplace_private.chat_image_cleanup set queued_at=clock_timestamp()-interval '11 minutes' where split_part(storage_path,'/',1) in (${conversations
        .map(quote)
        .join(',')});`
    )
    for (const item of paths.rows)
      assert.equal(
        await ok(
          admin.rpc('marketplace_ack_chat_image_cleanup', {
            p_storage_path: item.storage_path,
          }),
          'cleanup acknowledgment'
        ),
        true
      )
    assert.equal(
      await ok(
        admin.rpc('marketplace_ack_chat_image_cleanup', {
          p_storage_path: sample,
        }),
        'repeat cleanup acknowledgment'
      ),
      true
    )
  }
  for (const id of ids) {
    const user = await admin.auth.admin.getUserById(id)
    if (user.data?.user)
      await ok(admin.auth.admin.deleteUser(id), 'fixture user cleanup')
  }
  const left = await query(`select
    (select count(*) from auth.users where id in (${ids
      .map(quote)
      .join(',')})) as users,
    (select count(*) from public.listings where id in (${
      listings.map(quote).join(',') || 'null'
    })) as listings,
    (select count(*) from public.conversations where id in (${
      conversations.map(quote).join(',') || 'null'
    })) as conversations,
    (select count(*) from public.messages where sender_id in (${ids
      .map(quote)
      .join(',')})) as messages,
    (select count(*) from public.image_message_submissions where sender_id in (${ids
      .map(quote)
      .join(',')})) as submissions,
    (select count(*) from public.message_images where split_part(storage_path,'/',1) in (${
      conversations.map(quote).join(',') || 'null'
    })) as images,
    (select count(*) from storage.objects where bucket_id='chat-images' and split_part(name,'/',1) in (${
      conversations.map(quote).join(',') || 'null'
    })) as objects,
    (select count(*) from marketplace_private.chat_image_cleanup where split_part(storage_path,'/',1) in (${
      conversations.map(quote).join(',') || 'null'
    })) as cleanup_queue;`)
  for (const value of Object.values(left.rows[0]))
    assert.equal(Number(value), 0)
  pass(
    'administrative cascade, Storage API removal, guarded queue acknowledgment and zero fixtures',
    left.rows[0]
  )
}
async function runSuite() {
  let failure
  try {
    await main()
  } catch (error) {
    failure = error
    console.error('FAIL:', error.message)
  }
  try {
    await cleanup()
  } catch (error) {
    console.error('CLEANUP FAILED:', error.message)
    failure = failure || error
  }
  fs.writeFileSync(
    `${artifact}/results-${run}.json`,
    JSON.stringify({ results, passed: !failure }, null, 2)
  )
  fs.rmSync(temp, { recursive: true, force: true })
  global.fetch = originalFetch
  if (failure) process.exitCode = 1
}
runSuite()
