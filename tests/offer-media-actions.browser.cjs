// Actual Offer surfaces and shared media/actions; all data/callbacks are offline fixtures.
/* global window, document, getComputedStyle, innerWidth */
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const source = fs.readFileSync(
  path.join(__dirname, 'messages-offer-correction.browser.cjs'),
  'utf8'
)
new Function(
  'require',
  source.slice(0, source.indexOf('async function run()'))
)(require)
let entry = fs.readFileSync(path.join(root, 'entry.tsx'), 'utf8')
entry = entry.replace(
  'photoUrls:[],live:',
  `photoUrls:Array.from({length:v.count||1},(_,i)=>'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="'+['purple','blue','green'][i]+'"/></svg>')),live:`
)
entry = entry.replace(
  "window.actions.push('accept')",
  "window.actions.push('accept');if(window.controlAccept)await new Promise((resolve,reject)=>{window.resolveAccept=resolve;window.rejectAccept=reject})"
)
entry += `\nimport {DynamicAction} from '@/components/ui/dynamic-action';window.showDefault=()=>flushSync(()=>root.render(<DynamicAction variant="green" onClick={()=>{}}>Continue</DynamicAction>));`
fs.writeFileSync(path.join(root, 'entry.tsx'), entry)
async function run() {
  await build(require('./browser-fixture-mocks.cjs')(root))
  for (const n of ['entry.tsx', 'api.ts']) fs.unlinkSync(path.join(root, n))
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const b = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  let cases = 0
  try {
    for (const width of [390, 430, 1280, 1536]) {
      const p = await b.newPage({
          viewport: { width, height: 900 },
          reducedMotion: 'reduce',
        }),
        errors = []
      p.on('pageerror', (e) => errors.push(e.message))
      await p.route(/^https?:/, (r) => r.abort())
      await p.addInitScript(() => (window.process = { env: {} }))
      await p.goto(
        'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      const action = async (dialog, name, arrow) => {
        const button = dialog.getByRole('button', { name, exact: true })
        assert.equal(
          await button
            .locator('.shining-button__arrow, [class*="sendLabel"] svg')
            .count(),
          arrow ? 1 : 0
        )
        const r = await button.boundingBox()
        assert(r.x >= 0 && r.x + r.width <= width)
        return button
      }
      for (const state of ['own', 'recipient', 'historical'])
        for (const count of [1, 3]) {
          const v = {
            viewer: state === 'own' ? 'seller' : 'buyer',
            sender: 'seller',
            status: state === 'historical' ? 'Replaced' : 'Active',
            count,
          }
          await p.evaluate((v) => window.showCase(v), v)
          const trigger = p.locator('[data-offer-id] > div button').first()
          await trigger.click()
          const d = p.getByRole('dialog')
          await d.waitFor()
          const media = d
            .locator('[class*="offer_ui_module_css_media"]')
            .first()
          await media
            .locator('img')
            .first()
            .evaluate((i) => i.decode())
          const box = await media.boundingBox()
          assert.equal(box.height, width < 768 ? 180 : 270)
          assert.equal(
            await media
              .locator('img')
              .last()
              .evaluate((i) => getComputedStyle(i).objectFit),
            'cover'
          )
          const image = await media.locator('img').last().boundingBox()
          assert(
            Math.abs(image.width - box.width) < 1 &&
              Math.abs(image.height - box.height) < 1
          )
          const exit = await action(
            d,
            state === 'recipient' ? 'Cancel' : 'Close',
            false
          )
          if (state === 'own') {
            const next = await action(d, 'Revise Offer', true)
            const a = await exit.boundingBox(),
              z = await next.boundingBox()
            assert.equal(a.width, z.width)
            assert.equal(a.height, z.height)
          }
          if (state === 'recipient') {
            await action(d, 'Deny', false)
            await action(d, 'Confirm', true)
          }
          if (state === 'historical') {
            for (const name of ['Revise Offer', 'Confirm', 'Deny'])
              assert.equal(
                await d.getByRole('button', { name, exact: true }).count(),
                0
              )
          }
          if (count === 1) {
            assert.equal(
              await media.getByRole('button', { name: 'Next slide' }).count(),
              0
            )
            assert.equal(
              await media.locator('[data-slot="image-slider"]').count(),
              0
            )
          } else {
            await media
              .getByRole('group', { name: '1 of 3', exact: true })
              .waitFor()
            await media.getByRole('button', { name: 'Next slide' }).click()
            await media
              .getByRole('group', { name: '2 of 3', exact: true })
              .waitFor()
            await media.getByRole('button', { name: 'Previous slide' }).click()
            await media
              .getByRole('group', { name: '1 of 3', exact: true })
              .waitFor()
            if (width < 1024) {
              const i = media.locator('img').last()
              await i.dispatchEvent('pointerdown', {
                pointerType: 'touch',
                clientX: 180,
                clientY: 100,
              })
              await i.dispatchEvent('pointerup', {
                pointerType: 'touch',
                clientX: 100,
                clientY: 100,
              })
              await media
                .getByRole('group', { name: '2 of 3', exact: true })
                .waitFor()
              await media.locator('img').last().dispatchEvent('click')
            }
          }
          await exit.click()
          await d.waitFor({ state: 'detached' })
          assert.deepEqual(await p.evaluate(() => window.actions), [])
          await trigger.click()
          await d.waitFor()
          if (count > 1)
            await media
              .getByRole('group', { name: '1 of 3', exact: true })
              .waitFor()
          await p.keyboard.press('Escape')
          await d.waitFor({ state: 'detached' })
          cases++
        }
      for (const name of ['Deny', 'Confirm']) {
        await p.evaluate(() =>
          window.showCase({ viewer: 'buyer', sender: 'seller', count: 1 })
        )
        await p.locator('[data-offer-id] > div button').first().click()
        const d = p.getByRole('dialog'),
          button = d.getByRole('button', { name, exact: true })
        await button.evaluate((e) => {
          e.click()
          e.click()
        })
        await d.waitFor({ state: 'detached' })
        assert.deepEqual(await p.evaluate(() => window.actions), [
          name === 'Deny' ? 'deny' : 'accept',
        ])
      }
      await p.evaluate(() => {
        window.controlAccept = true
        window.showCase({
          viewer: 'buyer',
          sender: 'seller',
          count: 1,
          probe: 'accept-retry',
        })
      })
      await p.locator('[data-offer-id] > div button').first().click()
      const confirmDialog = p.getByRole('dialog')
      const confirmButton = confirmDialog.getByRole('button', {
        name: 'Confirm',
        exact: true,
      })
      await confirmButton.click()
      assert.equal(await confirmButton.getAttribute('data-state'), 'loading')
      await confirmButton.evaluate((e) => e.click())
      assert.deepEqual(await p.evaluate(() => window.actions), ['accept'])
      await p.evaluate(() =>
        window.rejectAccept(Error('Controlled accept failure'))
      )
      await p.waitForFunction(() =>
        document.querySelector('[data-state="error"]')
      )
      await p.waitForFunction(
        () =>
          document.querySelector('[data-state="idle"][aria-busy]') === null &&
          document.querySelector('[data-state="error"]') === null
      )
      assert.equal(await confirmButton.isEnabled(), true)
      await confirmButton.click()
      assert.equal(await confirmButton.getAttribute('data-state'), 'loading')
      await p.evaluate(() => window.resolveAccept())
      await confirmDialog.waitFor({ state: 'detached' })
      assert.deepEqual(await p.evaluate(() => window.actions), [
        'accept',
        'accept',
      ])
      await p.evaluate(() => {
        window.controlAccept = false
      })
      await p.evaluate(() =>
        window.showCase({ viewer: 'seller', sender: 'seller', count: 1 })
      )
      await p.locator('[data-offer-id] > div button').first().click()
      await p
        .getByRole('button', { name: 'Revise Offer', exact: true })
        .evaluate((e) => {
          e.click()
          e.click()
        })
      await p.getByRole('dialog').waitFor({ state: 'detached' })
      assert.deepEqual(await p.evaluate(() => window.actions), ['revise'])
      await p.evaluate(() =>
        window.showCase({
          kind: 'editor',
          viewer: 'seller',
          sender: 'seller',
          count: 3,
        })
      )
      const editor = p.getByRole('dialog', {
        name: 'Revise Offer',
        exact: true,
      })
      await editor.waitFor()
      const cancel = await action(editor, 'Cancel', false),
        reviewButton = await action(editor, 'Review Offer', true)
      const a = await cancel.boundingBox(),
        z = await reviewButton.boundingBox()
      assert.equal(a.width, z.width)
      assert.equal(a.height, z.height)
      if (width >= 768) {
        const media = editor
          .locator('[class*="offer_ui_module_css_media"]')
          .first()
        const r = await media.boundingBox()
        assert.equal(r.height, 270)
        await media.getByRole('button', { name: 'Next slide' }).click()
        await media
          .getByRole('group', { name: '2 of 3', exact: true })
          .waitFor()
      }
      const price = editor.getByLabel('Offer price (CA$)', { exact: true })
      await price.fill('')
      await reviewButton.click()
      await p.waitForTimeout(300)
      assert.equal(
        await p.getByRole('dialog', { name: 'Review your Offer' }).count(),
        0
      )
      await price.fill('70.00')
      await price.press('Enter')
      const review = p.getByRole('dialog', { name: 'Review your Offer' })
      await review.waitFor()
      assert.equal(await review.locator('img').count(), 0)
      const back = await action(review, 'Go Back', false),
        send = review.getByRole('button', {
          name: 'Send Revised Offer',
          exact: true,
        })
      assert.equal(await send.locator('[class*="sendLabel"] svg').count(), 1)
      const sb = await send.boundingBox(),
        bb = await back.boundingBox()
      assert.equal(sb.width, bb.width)
      assert.equal(sb.height, bb.height)
      const label = await send.locator('[class*="sendLabel"]').boundingBox()
      assert(
        label.x >= sb.x && label.x + label.width <= sb.x + sb.width,
        'Send label and arrow fit'
      )
      await back.click()
      await review.waitFor({ state: 'detached' })
      assert.equal(await price.inputValue(), '70.00')
      await reviewButton.click()
      await review.waitFor()
      await send.click()
      await send.evaluate((e) => e.click())
      assert.equal(await p.evaluate(() => window.sends), 1)
      await p.evaluate(() =>
        window.rejectSend(Error('Controlled send failure'))
      )
      await review.getByRole('alert').waitFor()
      await p.waitForFunction(() =>
        document.querySelector('[data-state="error"]')
      )
      await p.waitForFunction(() =>
        document.querySelector('[data-state="idle"]')
      )
      await send.click()
      assert.equal(await p.evaluate(() => window.sends), 2)
      await p.evaluate(() => window.resolveSend())
      await p.waitForFunction(() =>
        document.querySelector('[data-state="success"]')
      )
      await p.waitForFunction(() => window.closedCount === 1)
      assert.equal(await p.evaluate(() => window.sends), 2)
      await p.evaluate(() => window.showDefault())
      assert.equal(await p.locator('.shining-button__arrow').count(), 1)
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      )
      assert.deepEqual(errors, [])
      console.log(
        'PASS ' +
          width +
          ': media single/multi/history/reset/swipe; own/recipient arrows; equal action sizes; native validation; Review no image; Send failure/retry/success/dedup; default shared arrows unchanged.'
      )
      await p.close()
    }
  } finally {
    await b.close()
  }
  console.log('PASS ' + cases + ' Offer media/state combinations')
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
