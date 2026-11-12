const assert = require('node:assert/strict')
const fs = require('node:fs')

const pageSlide = fs.readFileSync('lib/page-slide.ts', 'utf8')
const panel = fs.readFileSync(
  'components/payments/stripe-flow-panel.tsx',
  'utf8'
)

assert.match(pageSlide, /motionEase: \[0\.22, 0\.61, 0\.36, 1\]/)
assert.match(pageSlide, /motionEase: \[0\.42, 0, 1, 1\]/)
assert.match(pageSlide, /ease: timing\.motionEase/)
assert.doesNotMatch(pageSlide, /ease: timing\.easing/)
assert.match(panel, /import \{ AnimatePresence, m, useReducedMotion \}/)
assert.doesNotMatch(panel, /<motion\./)
assert.match(panel, /initial=\{\{ x: '100%' \}\}/)
assert.match(panel, /exit=\{\{ x: '100%' \}\}/)
assert.match(panel, /onExitComplete=\{onExitComplete\}/)
assert.match(
  fs.readFileSync('components/payments/stripe-flow-panel.module.css', 'utf8'),
  /width: clamp\(420px, 42vw, 760px\)/
)
assert.match(
  fs.readFileSync('components/payments/stripe-flow-panel.module.css', 'utf8'),
  /width: 50vw/
)
assert.match(
  fs.readFileSync('components/payments/stripe-flow-panel.module.css', 'utf8'),
  /width: 100vw/
)

console.log(
  'PASS Stripe animation easing and LazyMotion compatibility regression'
)
