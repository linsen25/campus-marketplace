const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}
const caseId = '11111111-1111-4111-8111-111111111111'
const sourceId = '22222222-2222-4222-8222-222222222222'
const calls = []
let response = null

function load() {
  const code = ts.transpileModule(
    fs.readFileSync(path.resolve('lib/server/operational-cases.ts'), 'utf8'),
    { compilerOptions: { module: 1, target: 9, esModuleInterop: true } }
  ).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(
    (name) => {
      if (name === '@/lib/listing-validation')
        return { ListingApiError: ApiError }
      if (name === '@/lib/server/messages-environment')
        return {
          messageUuid: (value) => {
            if (!/^[0-9a-f-]{36}$/.test(value)) throw new ApiError('uuid', 400)
            return value
          },
        }
      if (name === '@/lib/server/financial-capabilities-service')
        return {
          createTrustedFinancialClient: () => ({
            rpc: async (name, args) => {
              calls.push({ name, args })
              return { data: response, error: null }
            },
          }),
        }
      return require(name)
    },
    module,
    module.exports
  )
  return module.exports
}

async function main() {
  const service = load()
  response = {
    id: caseId,
    source_kind: 'stripe_dispute',
    category: 'provider_dispute',
    risk_level: 'critical',
    priority: 95,
    review_status: 'open',
    response_due_at: '2026-10-29T12:00:00Z',
    hold_projection: 'active',
    release_projection: 'blocked',
    source_status: 'needs_response:attributed',
    source_observed_at: '2026-10-22T12:00:00Z',
    version: 1,
    evidence: [
      {
        kind: 'stripe_dispute',
        referenceId: sourceId,
        observedAt: '2026-10-22T12:00:00Z',
      },
    ],
    audit: [],
    provider_object_ref: 'du_PrivateProviderReference',
  }
  const read = await service.readOperationalCase(caseId)
  assert.equal(read.id, caseId)
  assert.equal(read.reviewStatus, 'open')
  assert.equal(read.holdProjection, 'active')
  assert.equal(read.evidence[0].referenceId, sourceId)
  assert.equal('providerObjectRef' in read, false)
  assert.equal(calls.at(-1).args.p_action, 'read')

  const synced = await service.syncOperationalCase('stripe_dispute', sourceId)
  assert.equal(synced.sourceKind, 'stripe_dispute')
  assert.equal(calls.at(-1).args.p_action, 'sync')
  assert.equal(calls.at(-1).args.p_source_id, sourceId)
  await assert.rejects(
    () => service.syncOperationalCase('fake_admin', sourceId),
    (error) => error.status === 400
  )
  const beforeReview = calls.length
  await assert.rejects(
    () => service.reviewOperationalCase(),
    (error) =>
      error.status === 503 && /authority is not configured/.test(error.message)
  )
  assert.equal(calls.length, beforeReview)

  const source = fs.readFileSync('lib/server/operational-cases.ts', 'utf8')
  assert(!/pages\/api|isAdmin|admin_role|service_role/.test(source))
  console.log(
    'PASS B25-B server-only case projection, trusted sync and disabled review authority'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
