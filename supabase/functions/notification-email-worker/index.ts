// eslint-disable-next-line import/extensions -- Deno resolves explicit runtime extensions.
import { runEmailBatch } from './worker.js'

declare const Deno: {
  env: { get: (name: string) => string | undefined }
  serve: (handler: (request: Request) => Promise<Response>) => void
}

const staging = 'https://pcaqxezdfxofysghssyo.supabase.co'
class WorkerDatabaseError extends Error {
  constructor(readonly classification: string) {
    super('Worker database unavailable')
  }
}
const timeout = () =>
  (
    AbortSignal as typeof AbortSignal & { timeout: (ms: number) => AbortSignal }
  ).timeout(10000)
async function equalSecret(a: string, b: string) {
  const hash = async (s: string) =>
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
    )
  const [left, right] = await Promise.all([hash(a), hash(b)])
  // eslint-disable-next-line no-bitwise -- Compare every digest byte without an early exit.
  return left.reduce((diff, byte, i) => diff | (byte ^ right[i]), 0) === 0
}
function validBody(body: Record<string, unknown>) {
  return (
    body &&
    !Array.isArray(body) &&
    !Object.keys(body).some((k) => k !== 'testDeliveryId') &&
    (!body.testDeliveryId ||
      (typeof body.testDeliveryId === 'string' &&
        /^[0-9a-f-]{36}$/i.test(body.testDeliveryId)))
  )
}
function validOrigin(origin: string | undefined): origin is string {
  if (!origin || !/^https?:\/\//.test(origin)) return false
  const url = new URL(origin)
  return (
    url.origin === origin &&
    (url.protocol === 'https:' || origin === 'http://localhost:3000')
  )
}
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })

Deno.serve(async (request) => {
  if (request.method !== 'POST')
    return reply(405, { error: 'Method not allowed.' })
  if (Deno.env.get('SUPABASE_URL') !== staging)
    return reply(503, { error: 'Staging configuration required.' })
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const rpc = async (name: string, body: unknown) => {
    const response = await fetch(`${staging}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: timeout(),
    })
    if (!response.ok) {
      const failure = await response.json().catch(() => null)
      let classification = 'database_unavailable'
      if (response.status === 401) classification = 'database_authentication'
      if (failure?.code === '42501') classification = 'database_worker_claims'
      throw new WorkerDatabaseError(classification)
    }
    return response.json()
  }
  try {
    const token = request.headers
      .get('Authorization')
      ?.match(/^Bearer (.{1,4096})$/)?.[1]
    if (
      !token ||
      !(
        (serviceKey && (await equalSecret(token, serviceKey))) ||
        (await rpc('marketplace_authorize_email_worker', { p_token: token }))
      )
    )
      return reply(401, { error: 'Unauthorized.' })
    const raw = await request.text()
    if (raw.length > 128) return reply(400, { error: 'Invalid request.' })
    const body = raw.trim() ? JSON.parse(raw) : {}
    if (!validBody(body))
      return reply(400, { error: 'No client-selected email content allowed.' })
    const key = Deno.env.get('RESEND_API_KEY')
    const from = Deno.env.get('EMAIL_FROM')
    if (!key || !from)
      return reply(503, { error: 'Email configuration required.' })
    // Explicit deployment configuration only; never infer an origin from caller headers.
    const origin = Deno.env.get('NOTIFICATION_APP_ORIGIN')
    if (!validOrigin(origin))
      return reply(503, { error: 'App origin configuration required.' })
    const result = await runEmailBatch({
      rpc,
      from,
      origin,
      testDeliveryId: body.testDeliveryId || null,
      testRecipient: Deno.env.get('RESEND_TEST_RECIPIENT'),
      send: (envelope: unknown, idempotencyKey: string) =>
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify(envelope),
          signal: timeout(),
        }),
    })
    return reply('blocked' in result ? 503 : 200, result)
  } catch (error) {
    return reply(503, {
      error: 'Email worker temporarily unavailable.',
      classification:
        error instanceof WorkerDatabaseError
          ? error.classification
          : 'worker_unavailable',
    })
  }
})
