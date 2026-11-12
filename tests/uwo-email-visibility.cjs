const assert = require('node:assert/strict')
const fs = require('node:fs')

const verification = fs.readFileSync(
  'components/home/uwo-email-verification.tsx',
  'utf8'
)
const profile = fs.readFileSync('components/home/profile-overview.tsx', 'utf8')

assert.match(verification, /isWesternEmail\(accountEmail\)/)
assert.match(verification, /if \(!supported\) return null/)
assert.match(profile, /isWesternEmail\(account\.email\)/)
assert.match(profile, /<UwoEmailVerification accountEmail=\{account\.email\}/)

const supported = (email) => /^[^\s@]+@uwo\.ca$/i.test(email.trim())
for (const email of ['ordinary@example.com', 'b32-seller-20261107@example.invalid'])
  assert.equal(supported(email), false)
for (const email of ['student@uwo.ca', 'staff@UWO.CA'])
  assert.equal(supported(email), true)

console.log('PASS UWO email visibility guard and supported-domain regression cases')
