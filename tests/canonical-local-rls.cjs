/* Local-only canonical database qualification: real GoTrue JWTs exercise
 * verified participant reads and the negative paths. Secrets are supplied by
 * the caller and are never printed or persisted. */
const assert = require('node:assert/strict')
const { createHmac, randomUUID } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { createClient } = require('@supabase/supabase-js')

for (const name of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_JWT_SECRET']) {
  assert.ok(process.env[name], `${name} is required`)
}

const url = process.env.SUPABASE_URL
const anon = process.env.SUPABASE_ANON_KEY
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const suffix = `${Date.now()}${Math.floor(Math.random() * 1e6)}`
const password = `LocalOnly-${suffix}!aA1`

async function createUser(label, emailConfirm) {
  const username = `c${label}${suffix}`.slice(0, 20)
  const { data, error } = await service.auth.admin.createUser({
    email: `canonical-${label}-${suffix}@example.test`,
    password,
    email_confirm: emailConfirm,
    user_metadata: { username },
  })
  assert.ifError(error)
  assert.ok(data.user?.id)
  return { ...data.user, username }
}

async function signIn(email) {
  const client = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  assert.ifError(error)
  assert.ok(data.session?.access_token)
  return client
}

function localAuthenticatedToken(user) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    aud: 'authenticated',
    role: 'authenticated',
    sub: user.id,
    email: user.email,
    iat: now,
    exp: now + 300,
  })}`
  return `${unsigned}.${createHmac('sha256', process.env.SUPABASE_JWT_SECRET).update(unsigned).digest('base64url')}`
}

async function cleanup(ids) {
  for (const id of ids.reverse()) {
    await service.auth.admin.deleteUser(id)
  }
}

function seedLocalFixture(sql) {
  execFileSync('docker', [
    'exec', process.env.LOCAL_DOCKER_DB_CONTAINER || 'supabase_db_pwa',
    'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-c', sql,
  ], { stdio: 'pipe' })
}

void (async () => {
  const seller = await createUser('seller', true)
  const buyer = await createUser('buyer', true)
  const outsider = await createUser('outsider', true)
  const unverified = await createUser('unverified', false)
  const ids = [seller.id, buyer.id, outsider.id, unverified.id]
  try {
    const buyerClient = await signIn(buyer.email)
    const sellerClient = await signIn(seller.email)
    const outsiderClient = await signIn(outsider.email)

    const conversationId = randomUUID()
    const listingId = randomUUID()
    const clientMessageId = randomUUID()
    // PostgreSQL only seeds a schema-valid local fixture with application
    // triggers disabled. Every assertion below is made via signed GoTrue user
    // JWTs through PostgREST, so the RLS result is real.
    seedLocalFixture(`
      begin;
      set local session_replication_role = replica;
      insert into public.listings(
        id,seller_id,title,description,price_cents,currency,category,subcategory,
        condition,pickup_area,status,published_at,expected_image_count,preferred_fulfillment,
        preferred_payment_mode,listing_channel
      ) values (
        '${listingId}','${seller.id}','Canonical local fixture',
        'Isolated local RLS qualification fixture.',100,'CAD','Other','Other',
        'good','Local test','available',clock_timestamp(),1,'ON_CAMPUS','external','resale'
      );
      insert into public.conversations(
        id,listing_origin_id,listing_id,buyer_id,seller_id,listing_title_snapshot,
        listing_price_cents_snapshot,listing_currency_snapshot,listing_category_snapshot,
        listing_channel_snapshot
      ) values (
        '${conversationId}','${listingId}','${listingId}','${buyer.id}','${seller.id}',
        'Canonical local fixture',100,'CAD','Other','resale'
      );
      insert into public.messages(
        conversation_id,sender_id,client_message_id,type,content,sequence,origin
      ) values (
        '${conversationId}','${seller.id}','${clientMessageId}','TEXT',
        'Canonical local RLS fixture.',1,'user'
      );
      commit;
    `)

    const { data: buyerRows, error: buyerError } = await buyerClient
      .from('messages').select('id').eq('conversation_id', conversationId)
    assert.ifError(buyerError)
    assert.equal(buyerRows.length, 1, 'verified buyer must read participant message')
    const { data: sellerRows, error: sellerError } = await sellerClient
      .from('messages').select('id').eq('conversation_id', conversationId)
    assert.ifError(sellerError)
    assert.equal(sellerRows.length, 1, 'verified seller must read participant message')
    const { data: outsiderRows, error: outsiderError } = await outsiderClient
      .from('messages').select('id').eq('conversation_id', conversationId)
    assert.ifError(outsiderError)
    assert.equal(outsiderRows.length, 0, 'nonparticipant must not read private messages')

    const unverifiedClient = createClient(url, anon, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${localAuthenticatedToken(unverified)}` } },
    })
    const { data: unverifiedRows, error: unverifiedError } = await unverifiedClient
      .from('messages').select('id').eq('conversation_id', conversationId)
    assert.ifError(unverifiedError)
    assert.equal(unverifiedRows.length, 0, 'unverified user must not read private messages')

    process.stdout.write('canonical-local-rls: PASS\n')
  } finally {
    await cleanup(ids)
  }
})().catch((error) => {
  process.stderr.write(`canonical-local-rls: FAIL: ${error.message}\n`)
  process.exitCode = 1
})
