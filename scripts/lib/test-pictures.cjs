// Node-only adapter for seed/browser tooling. The TypeScript registry owns all paths.
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { execFileSync } = require('node:child_process')
const jpegCache = new Map()
const ts = require('typescript')
const file = path.resolve(__dirname, '../../lib/fixtures/test-pictures.ts')
const registry = new Module(file, module)
registry.filename = file
registry.paths = module.paths
registry._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: file,
  }).outputText,
  file
)
function pictureBytes(key) {
  const source = registry.exports.TEST_PICTURES[key]
  if (!source) throw new Error('Unknown test picture key')
  return fs.readFileSync(path.resolve(__dirname, '../../public', '.' + source))
}
module.exports = {
  ...registry.exports,
  // Existing upload/snapshot tests deliberately require JPEG bytes. Transcode
  // from the canonical WebP in memory, without another physical photo copy.
  readTestPictureJpeg(key) {
    if (!jpegCache.has(key)) {
      const script =
        "require('sharp')(require('node:fs').readFileSync(0)).jpeg({quality:90}).toBuffer().then(b=>process.stdout.write(b)).catch(()=>process.exit(1))"
      jpegCache.set(
        key,
        execFileSync(process.execPath, ['-e', script], {
          input: pictureBytes(key),
          cwd: path.resolve(__dirname, '../..'),
          maxBuffer: 10 * 1024 * 1024,
        })
      )
    }
    return jpegCache.get(key)
  },
  // Offline file:// harnesses cannot resolve root-relative HTTP assets. Serialize
  // the same canonical bytes, not a second photo path/identity registry.
  testPictureDataUrl(key) {
    return 'data:image/webp;base64,' + pictureBytes(key).toString('base64')
  },
}
