declare const Deno: { env: { get: (name: string) => string | undefined }; serve: (handler: (request: Request) => Promise<Response>) => void }
export {}

const templateId = '1b4897b7-8cdc-4552-a833-46e2eb35ea1b'
const uwo = /^[^\s@]+@uwo\.ca$/i
const reply = (status: number) => new Response(status === 200 ? '{}' : '{"error":"Email delivery unavailable."}', { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
async function equal(a: string, b: string) {
  const hash = (value: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  const [left, right] = await Promise.all([hash(a), hash(b)])
  const x = new Uint8Array(left); const y = new Uint8Array(right)
  return x.length === y.length && x.reduce((diff, byte, index) => diff | (byte ^ y[index]), 0) === 0
}
Deno.serve(async (request) => {
  if (request.method !== 'POST') return reply(405)
  const expected = Deno.env.get('UWO_VERIFICATION_EMAIL_WEBHOOK_SECRET') || ''
  const apiKey = Deno.env.get('RESEND_API_KEY') || ''
  const from = Deno.env.get('AUTH_EMAIL_FROM') || ''
  const token = request.headers.get('Authorization')?.match(/^Bearer (.{32,4096})$/)?.[1] || ''
  if (!expected || !apiKey || !from || !(await equal(token, expected))) return reply(401)
  try {
    const body = await request.json()
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !['to', 'purpose', 'code'].includes(key)) || body.purpose !== 'uwo-email-verification' || typeof body.to !== 'string' || !uwo.test(body.to) || typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) return reply(400)
    const allowed = Deno.env.get('RESEND_TEST_RECIPIENT') || ''
    if (/@resend\.dev(?:>|$)/i.test(from) && body.to !== allowed) return reply(503)
    const result = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [body.to], template: { id: templateId, variables: { OTP_CODE: body.code, EXPIRY_TEXT: '10 minutes' } } }) })
    return reply(result.ok ? 200 : 503)
  } catch { return reply(400) }
})
