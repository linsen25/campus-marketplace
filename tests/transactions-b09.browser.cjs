// Reuse existing offline UI fixtures, but write ONLY a fresh ignored scratch dir.
const fs = require('node:fs'),
  path = require('node:path')
const root = fs.mkdtempSync(
  path.resolve('tests/artifacts/transactions-b09-browser-')
)
const fixtureModule = { exports: {} }
const fixtureSource = fs
  .readFileSync('tests/message-payload.browser.cjs', 'utf8')
  .replace(
    "const root = path.resolve('tests/artifacts/message-payload-qualification')",
    'const root = ' + JSON.stringify(root)
  )
function localRequire(name) {
  if (name === './message-payload.browser.cjs') return fixtureModule.exports
  return require(name)
}
localRequire.resolve = require.resolve
new Function('require', 'module', 'exports', fixtureSource)(
  localRequire,
  fixtureModule,
  fixtureModule.exports
)
new Function(
  'require',
  fs.readFileSync('tests/dual-payment.browser.cjs', 'utf8')
)(localRequire)
