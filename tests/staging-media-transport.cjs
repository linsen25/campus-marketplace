// Fixture-only transport: isolate immutable private uploads from native fetch's
// shared keep-alive pool. No retry, success fabrication or Storage reconciliation.
// Intermittent staging private-media TLS failures remain observed; the responsible
// upstream/network endpoint is unidentified. This is isolation/diagnostics only,
// not a TLS fix, and does not change production/application Storage behavior.
const https = require('node:https')
const { createHash } = require('node:crypto')
function createStagingMediaFetch(
  fallback,
  request = https.request,
  onFailure = () => {}
) {
  return async (input, options = {}) => {
    const url = new URL(
      typeof input === 'string' ? input : input.url || String(input)
    )
    if (
      url.hostname !== 'pcaqxezdfxofysghssyo.supabase.co' ||
      !url.pathname.startsWith('/storage/v1/object/order-snapshot-media/') ||
      options.method !== 'POST' ||
      !Buffer.isBuffer(options.body)
    )
      return fallback(input, options)
    const headers = new Headers(options.headers)
    headers.set('content-length', String(options.body.length))
    const diagnostic = {
      path: url.pathname,
      bytes: options.body.length,
      sha256: createHash('sha256').update(options.body).digest('hex'),
      connectionReuse: false,
    }
    return new Promise((resolve, reject) => {
      const req = request(
        url,
        {
          method: 'POST',
          agent: false,
          headers: Object.fromEntries(headers),
          signal: options.signal,
        },
        (res) => {
          const chunks = []
          res.on('data', (chunk) => chunks.push(chunk))
          res.on('error', reject)
          res.on('aborted', () =>
            reject(Error('Private upload response aborted'))
          )
          res.on('end', () => {
            if (res.statusCode >= 400)
              onFailure({
                ...diagnostic,
                status: res.statusCode,
                errorClass: 'HTTP',
              })
            resolve(
              new Response(Buffer.concat(chunks), {
                status: res.statusCode,
                headers: res.headers,
              })
            )
          })
        }
      )
      req.on('error', (error) => {
        onFailure({
          ...diagnostic,
          errorClass: error.name,
          code: error.code,
          message: error.message.replace(
            /https?:\/\/\S+|eyJ[A-Za-z0-9_.-]+/g,
            '[redacted]'
          ),
        })
        reject(error)
      })
      req.end(options.body)
    })
  }
}
module.exports = { createStagingMediaFetch }
