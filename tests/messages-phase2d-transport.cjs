// Explicit test-only Node preload. Never imported by application code.
const fs = require('node:fs')
const assert = require('node:assert/strict')
const path = require('node:path')
const ref = 'pcaqxezdfxofysghssyo'
assert.equal(process.env.APP_ENV, 'staging')
assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, `https://${ref}.supabase.co`)
const control = path.resolve(process.env.PHASE2D_TRANSPORT_FILE)
assert(
  control.startsWith(
    path.resolve('tests/artifacts/messages-phase2d') + path.sep
  )
)
const original = global.fetch
// Only counts/categories and a fixed disposable namespace are recorded; no keys/URLs/bodies.
global.fetch = async (input, options) => {
  const target = new URL(
    typeof input === 'string' ? input : input.url || String(input)
  )
  if (target.origin !== `https://${ref}.supabase.co`)
    return original(input, options)
  let plan = {}
  try {
    plan = JSON.parse(fs.readFileSync(control, 'utf8'))
  } catch {
    return original(input, options)
  }
  const method = options?.method || input.method || 'GET'
  let category = 'other'
  if (target.pathname === '/rest/v1/messages') category = 'messageQueries'
  else if (target.pathname === '/rest/v1/message_images')
    category = 'imageMetadataQueries'
  else if (target.pathname === '/storage/v1/object/sign/chat-images')
    category = 'signBatches'
  else if (target.pathname.startsWith('/auth/v1/')) category = 'auth'
  else if (target.pathname.startsWith('/rest/v1/rpc/')) category = 'rpc'
  else if (target.pathname.startsWith('/storage/v1/')) category = 'storage'
  else if (target.pathname.startsWith('/rest/v1/')) category = 'otherDb'
  plan.counts ||= {}
  plan.counts[category] = (plan.counts[category] || 0) + 1
  let fail = false
  if (
    method === 'DELETE' &&
    target.pathname === '/storage/v1/object/chat-images' &&
    plan.cleanupFailures > 0
  ) {
    const prefixes = JSON.parse(options.body).prefixes
    if (
      prefixes.length &&
      prefixes.every(
        (item) => typeof item === 'string' && item.startsWith(plan.namespace)
      )
    ) {
      plan.cleanupFailures--
      plan.cleanupFailureHits = (plan.cleanupFailureHits || 0) + 1
      fail = true
    }
  }
  fs.writeFileSync(control, JSON.stringify(plan))
  if (fail)
    return new Response(
      JSON.stringify({
        statusCode: '503',
        error: 'Injected staging cleanup failure',
        message: 'Retry operator cleanup',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )
  return original(input, options)
}
