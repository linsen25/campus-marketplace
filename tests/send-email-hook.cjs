const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

const hook = fs.readFileSync('supabase/functions/send-email/index.ts', 'utf8')
const uwo = fs.readFileSync('supabase/functions/uwo-email/index.ts', 'utf8')
assert.match(hook, /new Webhook\(hookSecret\)\.verify/)
assert.match(hook, /action === 'signup'/)
assert.match(hook, /action === 'recovery'/)
assert.match(hook, /MISSING_ACTION/)
assert.match(hook, /TOKEN_NOT_STRING/)
assert.match(hook, /TOKEN_NON_NUMERIC/)
assert.match(hook, /TOKEN_LENGTH_UNSUPPORTED/)
assert.match(hook, /UNSUPPORTED_ACTION/)
assert.match(hook, /SIGNATURE_INVALID/)
assert.match(hook, /PROVIDER_UNAVAILABLE/)
assert.match(hook, /event\.user\?\.email/)
assert.match(hook, /event\.email_data\?\.email_action_type/)
assert.match(hook, /input\.length < 6 \|\| input\.length > 10/)
assert.match(hook, /Idempotency-Key/)
assert.match(hook, /console\.info\(code\)/)
assert.doesNotMatch(hook, /console\.(log|error)/)
assert.match(uwo, /UWO_VERIFICATION_EMAIL_WEBHOOK_SECRET/)
assert.match(uwo, /uwo-email-verification/)
assert.match(uwo, /OTP_CODE: body.code/)

// Exercise the actual TypeScript helper without invoking Deno.serve, Webhooks,
// Resend, or any network path.
const helperSource = hook
  .replace(/^\/\/ @ts-ignore[^\n]*\nimport[^\n]*\n/m, '')
  .concat('\nglobalThis.__signupToken = signupToken\n')
const compiled = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
}).outputText
const context = { Deno: { env: { get: () => '' }, serve: () => {} }, console: { info: () => {} } }
context.globalThis = context
vm.runInNewContext(compiled, context)
const assertToken = (input, expected) =>
  assert.equal(JSON.stringify(context.__signupToken(input)), JSON.stringify(expected))
assertToken('123456', { token: '123456' })
assertToken('12345678', { token: '12345678' })
assertToken('1234567890', { token: '1234567890' })
assertToken('12345', { code: 'TOKEN_LENGTH_UNSUPPORTED' })
assertToken('12345678901', { code: 'TOKEN_LENGTH_UNSUPPORTED' })
assertToken('12345a', { code: 'TOKEN_NON_NUMERIC' })
assertToken(123456, { code: 'TOKEN_NOT_STRING' })
console.log('PASS Send Email Hook and separate UWO delivery fail-closed source contracts')
