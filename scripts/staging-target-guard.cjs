const assert = require('node:assert/strict')
const STAGING_REF = 'pcaqxezdfxofysghssyo'

function assertStagingEnvironment(env) {
  assert.equal(env.APP_ENV, 'staging', 'Staging environment required')
  assert.equal(
    env.NEXT_PUBLIC_SUPABASE_URL,
    `https://${STAGING_REF}.supabase.co`,
    'Exact staging endpoint required'
  )
}

function assertStagingArguments(args) {
  const positions = args.flatMap((value, i) =>
    value === '--project-ref' ? [i] : []
  )
  assert.equal(positions.length, 1, 'Exactly one explicit project ref required')
  assert.equal(
    args[positions[0] + 1],
    STAGING_REF,
    'Only staging is authorized'
  )
  assert(
    !args.some((value) => value.startsWith('--project-ref=')),
    'Use the validated explicit ref'
  )
  assert(!args.includes('--db-url'), 'Connection URL overrides are forbidden')
  return args
}

module.exports = {
  STAGING_REF,
  assertStagingEnvironment,
  assertStagingArguments,
}
