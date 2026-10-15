// Real installed renderer + QR decoder + video capture stream, no hosted data.
/* global window, document, Image, Blob, XMLSerializer, QrScanner, navigator */
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const {
  chromium,
} = require('./artifacts/browser-tools/node_modules/playwright-core')
;(async () => {
  const b = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    const p = await b.newPage()
    const root = path.resolve('tests/artifacts/message-payload-qualification')
    await p.route('**/*', (r) => {
      const name = new URL(r.request().url()).pathname.split('/').pop()
      const files = {
        page: path.join(root, 'index.html'),
        'bundle.js': path.join(root, 'bundle.js'),
        'qr-scanner.js': require.resolve('qr-scanner'),
        'qr-scanner-worker.min.js': path.join(
          path.dirname(require.resolve('qr-scanner')),
          'qr-scanner-worker.min.js'
        ),
      }
      if (!files[name]) return r.abort()
      return r.fulfill({
        body: fs.readFileSync(files[name]),
        contentType: name === 'page' ? 'text/html' : 'application/javascript',
      })
    })
    await p.addInitScript(() => {
      window.process = { env: {} }
    })
    await p.goto('http://localhost:3000/__qr-test/page')
    await p.evaluate(() => window.show({}))
    await p
      .getByRole('button', { name: 'Generate QR code', exact: true })
      .click()
    await p.getByRole('img', { name: /Handoff QR/ }).waitFor()
    await p.addScriptTag({
      url: 'http://localhost:3000/__qr-test/qr-scanner.js',
    })
    const result = await p.evaluate(async () => {
      const svg = new XMLSerializer().serializeToString(
          document.querySelector('[aria-label^="Handoff QR"] svg')
        ),
        url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })),
        image = new Image()
      await new Promise((resolve, reject) => {
        image.onload = resolve
        image.onerror = reject
        image.src = url
      })
      URL.revokeObjectURL(url)
      const decoded = await QrScanner.scanImage(image, {
        returnDetailedScanResult: true,
      })
      if (decoded.data !== 'a'.repeat(64))
        throw Error('Rendered QR payload mismatch')
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 640
      const ctx = canvas.getContext('2d'),
        draw = () => {
          ctx.fillStyle = 'white'
          ctx.fillRect(0, 0, 640, 640)
          ctx.drawImage(image, 100, 100, 440, 440)
        }
      draw()
      const stream = canvas.captureStream(10),
        timer = setInterval(draw, 100)
      navigator.mediaDevices.getUserMedia = async () => stream
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      document.body.append(video)
      const camera = new QrScanner(
        video,
        (r) => {
          window.actualDecoded = r.data === 'a'.repeat(64)
        },
        {
          preferredCamera: 'environment',
          returnDetailedScanResult: true,
          onDecodeError: () => {},
        }
      )
      await camera.start()
      await new Promise((resolve, reject) => {
        const interval = setInterval(() => {
          if (window.actualDecoded) {
            clearInterval(interval)
            resolve()
          }
        }, 50)
        setTimeout(() => {
          clearInterval(interval)
          reject(Error('Video decoder timeout'))
        }, 15000)
      })
      await camera.pause(true)
      camera.destroy()
      clearInterval(timer)
      return {
        svgDecoded: true,
        videoDecoded: window.actualDecoded,
        released: stream.getTracks().every((t) => t.readyState === 'ended'),
      }
    })
    assert(result.svgDecoded && result.videoDecoded && result.released)
    console.log(
      'PASS real installed QRCodeSVG -> QR decoder image + live video stream; tracks released; offline only'
    )
  } finally {
    await b.close()
  }
})().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
