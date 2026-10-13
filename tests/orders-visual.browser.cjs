// Real staging Listing/Messages context; every application data write is blocked.
// Transactions, synthetic addresses and fulfillment events exist only in browser memory.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
const base = 'http://localhost:3112',
  staging = 'https://pcaqxezdfxofysghssyo.supabase.co'
const artifacts = path.resolve('tests/artifacts/orders-interaction')
;(async () => {
  fs.mkdirSync(artifacts, { recursive: true })
  const credentials = JSON.parse(
    fs.readFileSync('tests/artifacts/staging-demo/credentials.json')
  )
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
  })
  try {
    for (const width of (process.env.ORDER_TEST_WIDTHS || '1280,1536,390,430')
      .split(',')
      .map(Number)) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        serviceWorkers: 'block',
      })
      const writes = [],
        errors = []
      const apiStatuses = []
      const localMessages = []
      await context.route('**/*', async (route) => {
        const request = route.request(),
          url = new URL(request.url())
        if (![base, staging].includes(url.origin)) return route.abort()
        if (
          request.method() === 'POST' &&
          url.origin === base &&
          url.pathname === '/api/messages/realtime-session'
        )
          return route.continue()
        if (
          request.method() === 'POST' &&
          url.origin === base &&
          /^\/api\/messages\/conversations\/[^/]+\/read$/.test(url.pathname)
        )
          return route.fulfill({
            json: {
              conversation_id: url.pathname.split('/')[4],
              last_read_sequence: request.postDataJSON().throughSequence,
              unread_count: 0,
            },
          })
        if (
          process.env.ORDER_TEST_CLEANUP === '1' &&
          url.origin === base &&
          /\/api\/messages\/conversations\/[^/]+\/messages$/.test(url.pathname)
        ) {
          if (request.method() === 'POST') {
            const data = request.postDataJSON()
            const message = {
              id: data.clientMessageId,
              clientMessageId: data.clientMessageId,
              conversationId: url.pathname.split('/')[4],
              senderId: credentials['seller-a'].id,
              type: 'TEXT',
              content: data.content,
              createdAt: new Date().toISOString(),
              sequence: 10000 + localMessages.length,
            }
            localMessages.push(message)
            return route.fulfill({ json: message })
          }
          const response = await route.fetch()
          const data = await response.json()
          return route.fulfill({
            response,
            json: { ...data, messages: [...data.messages, ...localMessages] },
          })
        }
        if (!['GET', 'HEAD'].includes(request.method())) {
          writes.push(url.pathname)
          return route.abort()
        }
        return route.continue()
      })
      // Existing staging demo identity only; no signup, emails or application data mutation.
      const signed = await context.request.post(base + '/api/auth/sign-in', {
        headers: { Origin: base, 'X-Marketplace-Request': '1' },
        data: {
          email: credentials['seller-a'].email,
          password: credentials['seller-a'].password,
        },
      })
      assert.equal(signed.status(), 200)
      const page = await context.newPage()
      page.on('response', (response) => {
        const url = new URL(response.url())
        if (url.origin === base && url.pathname.startsWith('/api/'))
          apiStatuses.push({ path: url.pathname, status: response.status() })
      })
      page.on('pageerror', (error) => errors.push(error.message))
      const screenshot = async (name) => {
        await page.waitForTimeout(220)
        await page.screenshot({
          path: path.join(artifacts, `${width}-${name}.png`),
        })
      }
      const bounds = async (locator) => {
        const box = await locator.boundingBox()
        assert(box && box.x >= -1 && box.x + box.width <= width + 1)
        if (await locator.evaluate((element) => element.tagName === 'DIALOG'))
          assert(box.y >= 0 && box.y + box.height <= 901)
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        )
      }
      const button = (parent, name) =>
        parent.getByRole('button', { name, exact: true })
      const region = (name) => page.getByRole('region', { name, exact: true })
      const dialog = (name) => page.getByRole('dialog', { name, exact: true })
      const openChat = async () => {
        // Reset independent scenarios outside the existing desktop route-animation document.
        // Preserve the authenticated browser context; no new sign-in or fixture mutation.
        await page.goto('about:blank')
        apiStatuses.length = 0
        await page.goto(base + '/home?section=messages&destination=selling')
        try {
          await page
            .locator('[data-conversation-id]')
            .first()
            .waitFor({ timeout: 60000 })
        } catch (error) {
          await screenshot('failure')
          console.log(
            JSON.stringify({
              width,
              apiStatuses: apiStatuses.slice(-10),
              runtimeErrors: errors.length,
            })
          )
          throw error
        }
        if (width < 1024)
          await page.locator('[data-conversation-id]').first().click()
        await region('Chat panel').waitFor({ timeout: 60000 })
      }
      const editor = dialog('Order Request editor')
      const openEditor = async () => {
        await button(region('Chat panel'), 'Add to conversation').click()
        await button(region('Chat panel'), 'Send Order Request').click()
        await editor.waitFor()
      }
      const defaultSchedule = async () => {
        const key = await page.evaluate(() => {
          const d = new Date()
          d.setDate(d.getDate() + 3)
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
            2,
            '0'
          )}-${String(d.getDate()).padStart(2, '0')}`
        })
        await editor.getByRole('button', { name: /^Date / }).click()
        const calendar = dialog('Schedule calendar')
        if (!(await calendar.locator(`[data-day="${key}"] button`).count()))
          await calendar.getByRole('button', { name: /next month/i }).click()
        await calendar.locator(`[data-day="${key}"] button`).click()
        await setTime('17:45')
      }
      const fill = async (method, price = '80') => {
        await button(
          editor,
          { pickup: 'Pickup', meet: 'Meet in person', shipping: 'Shipping' }[
            method
          ]
        ).click()
        await editor.getByLabel('Agreed price (CAD)').fill(price)
        if (method === 'shipping') {
          await editor
            .getByRole('button', { name: 'Flat rate', exact: true })
            .click()
          await editor.getByLabel('Shipping fee (CAD)').fill('10')
          await editor
            .getByLabel('Shipping method', { exact: true })
            .fill('Canada Post')
        } else
          await editor
            .getByLabel(
              method === 'meet' ? 'Meeting location' : 'Pickup location'
            )
            .fill(method === 'meet' ? 'Weldon entrance' : 'UCC')
        if (
          method !== 'shipping' &&
          !process.env.ORDER_TEST_SCHEDULE &&
          !process.env.ORDER_TEST_CLEANUP
        )
          await defaultSchedule()
        await editor
          .getByLabel('Optional note')
          .fill('Synthetic transaction preview')
      }
      const timeTrigger = () => editor.getByRole('button', { name: /^Time / })
      const wheelPopup = () => dialog('Choose time')
      const wheelSelect = async (name, value) => {
        const group = wheelPopup().getByRole('group', { name, exact: true })
        await group.locator('[data-rwp]').focus()
        if (name === 'AM / PM')
          await page.keyboard.press(value === 'PM' ? 'End' : 'Home')
        else await page.keyboard.type(String(value), { delay: 30 })
        try {
          await page.waitForFunction(
            ({ name, value }) => {
              const node = document.querySelector(
                '[role="dialog"][aria-label="Choose time"]'
              )
              return (
                node
                  ?.querySelector(`[aria-label="${name}"]`)
                  ?.getAttribute('data-wheel-value') === String(value)
              )
            },
            { name, value: name === 'Minute' ? Number(value) : value }
          )
          await page.waitForTimeout(100)
        } catch (error) {
          console.log('Wheel diagnostic', {
            name,
            target: value,
            actual: await group.getAttribute('data-wheel-value'),
            focused: await group
              .locator('[data-rwp]')
              .evaluate((node) => node === document.activeElement),
          })
          await screenshot('wheel-selection-failure')
          throw error
        }
      }
      const setTime = async (canonical) => {
        const [hour, minute] = canonical.split(':').map(Number)
        await timeTrigger().click()
        await wheelSelect('Hour', hour % 12 || 12)
        await wheelSelect('Minute', String(minute).padStart(2, '0'))
        await wheelSelect('AM / PM', hour >= 12 ? 'PM' : 'AM')
        await button(wheelPopup(), 'Done').click()
        await wheelPopup().waitFor({ state: 'hidden' })
        assert.equal(
          await timeTrigger().getAttribute('data-time-value'),
          canonical
        )
      }
      const confirm = async () => {
        await button(editor, 'Send Request').click()
        const c = dialog('Confirm Order Request')
        await c.waitFor()
        await button(c, 'Confirm & Send').click()
        const replacement = dialog('Replace current Order Request?')
        if (await replacement.count())
          await button(replacement, 'Replace & Send').click()
        await editor.waitFor({ state: 'hidden' })
      }
      const accept = async () => {
        const card = page
          .locator('[data-order-preview][data-request-status="active"]')
          .last()
        assert.equal(await card.locator('img').count(), 0)
        const controls = region('Preview Controls')
        const sent = () =>
          card.evaluate((element) => element.parentElement.dataset.sent)
        const requests = await page.locator('[data-order-preview]').count()
        await button(controls, 'Seller view').click()
        assert.equal(await sent(), 'true')
        await screenshot('request-seller-alignment')
        const sellerAlignment = await page
          .locator('[data-message-id]')
          .evaluateAll((rows) => rows.map((row) => row.dataset.sent))
        await button(card, 'Expand Order Request preview').click()
        assert.equal(
          await button(dialog('Order Request preview'), 'Accept').count(),
          0
        )
        await button(dialog('Order Request preview'), 'Close').click()
        await button(controls, 'Buyer view').click()
        assert.equal(await sent(), 'false')
        await screenshot('request-buyer-alignment')
        const buyerAlignment = await page
          .locator('[data-message-id]')
          .evaluateAll((rows) => rows.map((row) => row.dataset.sent))
        assert.deepEqual(
          buyerAlignment,
          sellerAlignment.map((sent) => (sent === 'true' ? 'false' : 'true'))
        )
        await button(controls, 'Seller view').click()
        assert.equal(await sent(), 'true')
        assert.equal(
          await page.locator('[data-order-preview]').count(),
          requests
        )
        await button(controls, 'Buyer view').click()
        await button(card, 'Expand Order Request preview').click()
        const previousUrl = page.url()
        await button(dialog('Order Request preview'), 'Accept').click()
        await region('Order Detail preview').waitFor()
        assert.equal(
          await region('Order Detail preview').getAttribute(
            'data-origin-workspace'
          ),
          'sales'
        )
        assert.equal(
          await region('Order Detail preview').getAttribute('data-order-role'),
          'seller'
        )
        await button(region('Order Detail preview'), 'Buyer view').click()
        assert.equal(
          await region('Order Detail preview').getAttribute(
            'data-origin-workspace'
          ),
          'sales'
        )
        assert.equal(
          page.url(),
          previousUrl,
          'Local acceptance must not navigate through an API-triggering route'
        )
      }
      const detail = region('Order Detail preview')
      const tab = async (name) => {
        await detail.getByRole('tab', { name, exact: true }).click()
        await region(
          {
            Overview: 'Order overview',
            Fulfillment: 'Order fulfillment',
            Payment: 'Order payment',
          }[name]
        ).waitFor()
      }
      const role = async (name) => {
        await button(detail, name + ' view').click()
      }
      const noSellerCancel = async () => {
        await role('Seller')
        assert.equal(
          await detail
            .getByRole('button', {
              name: /Release Reservation|Cancel Order|Refund|Cancel payment/,
            })
            .count(),
          0
        )
      }
      const pay = async (method) => {
        await role('Buyer')
        await tab('Payment')
        await region('Order payment')
          .getByText(method === 'shipping' ? 'CA$93.60' : 'CA$83.20', {
            exact: true,
          })
          .waitFor()
        assert.equal(
          await detail.getByLabel(/card number|expiry|CVC|bank/i).count(),
          0
        )
        await screenshot(`${method}-payment-summary`)
        await button(detail, 'Simulate payment success').click()
        await page.locator('[data-order-status="paid"]').waitFor()
        assert.equal(await detail.getByText(/remaining/).count(), 0)
        assert.equal(await button(detail, 'Cancel Order').count(), 0)
        await noSellerCancel()
        await role('Buyer')
      }
      if (process.env.ORDER_TEST_QUALIFY === '1') {
        const selectWorkspace = async (group, child) => {
          const nav = page.locator(
            width < 1024
              ? '[data-smooth-dropdown]'
              : '[data-slot="sidebar-body"]'
          )
          if (width < 1024) {
            const toggle = nav.getByRole('button', {
              name: 'Open Home navigation',
              exact: true,
            })
            if ((await toggle.getAttribute('aria-expanded')) === 'false')
              await toggle.click()
            const parent = nav.getByRole('button', { name: group, exact: true })
            if ((await parent.getAttribute('aria-expanded')) !== 'true')
              await parent.click()
          } else {
            await nav.hover()
            await nav.getByRole('link', { name: group, exact: true }).click()
          }
          await nav.getByRole('button', { name: child, exact: true }).click()
          await page.mouse.move(width - 10, 500)
          await page.waitForTimeout(400)
          const headings =
            width < 1024
              ? page.locator('[data-home-mobile-header] h1')
              : page.locator('[data-home-main]')
          if (width < 1024) assert.equal(await headings.innerText(), child)
          else
            assert.equal(
              await headings
                .getByRole('heading', { name: child, exact: true })
                .count(),
              1
            )
          if (width >= 1024)
            assert.equal(
              await headings
                .getByRole('heading', { name: group, exact: true })
                .count(),
              0
            )
        }
        await openChat()
        for (const [group, child] of [
          ['Messages', 'Buying'],
          ['Messages', 'Selling'],
          ['Orders', 'Purchases'],
          ['Orders', 'Sales'],
        ])
          await selectWorkspace(group, child)
        assert.equal(await region('Orders').getByRole('tab').count(), 0)
        await selectWorkspace('Messages', 'Selling')
        if (width < 1024)
          await page.locator('[data-conversation-id]').first().click()
        await openEditor()
        await fill('pickup')
        await confirm()
        const history = region('Chat messages'),
          request = history.locator('[data-order-preview]').last()
        await button(request, 'Cancel Request').click()
        const withdrawal = dialog('Cancel Order Request?')
        await withdrawal.waitFor()
        await button(withdrawal, 'Keep Request').click()
        assert.equal(
          await request.getAttribute('data-request-status'),
          'active'
        )
        await button(request, 'Cancel Request').click()
        await withdrawal
          .getByLabel('Reason', { exact: true })
          .selectOption('Sent by mistake')
        await button(withdrawal, 'Cancel Request').click()
        assert.equal(
          await request.getAttribute('data-request-status'),
          'cancelled'
        )
        await button(region('Preview Controls'), 'Buyer view').click()
        assert.equal(await button(request, 'Cancel Request').count(), 0)
        await button(request, 'Expand Order Request preview').click()
        assert.equal(
          await button(dialog('Order Request preview'), 'Accept').count(),
          0
        )
        await dialog('Order Request preview')
          .getByText('This Order Request was cancelled by the seller.')
          .waitFor()
        await button(dialog('Order Request preview'), 'Close').click()
        await button(region('Preview Controls'), 'Seller view').click()
        await openEditor()
        await fill('pickup')
        await confirm()
        assert.equal(await history.locator('[data-order-preview]').count(), 2)
        assert.equal(
          await request.getAttribute('data-request-status'),
          'active'
        )
        await accept()
        await detail
          .getByRole('heading', { name: 'Complete payment', exact: true })
          .waitFor()
        assert(
          /^\d{2}:\d{2} remaining$/.test(
            await detail
              .locator('[data-order-countdown="reservation"]')
              .textContent()
          )
        )
        await button(detail, 'Cancel Order').click()
        await button(dialog('Cancel this Order?'), 'Keep Order').click()
        assert.equal(await detail.getAttribute('data-order-status'), 'reserved')
        await role('Seller')
        await detail
          .getByRole('heading', { name: 'Buyer payment pending', exact: true })
          .waitFor()
        assert.equal(await button(detail, 'Cancel Order').count(), 1)
        assert.equal(await button(detail, 'Continue to Payment').count(), 0)
        await screenshot('qualified-reserved-seller')
        await button(detail, 'Cancel Order').click()
        const cancelOrder = dialog('Cancel this Order?')
        await cancelOrder
          .getByLabel('Reason', { exact: true })
          .selectOption('Item is no longer available')
        await button(cancelOrder, 'Cancel Order').click()
        await detail
          .getByRole('heading', { name: 'Sale cancelled', exact: true })
          .waitFor()
        assert.equal(await detail.locator('[data-order-countdown]').count(), 0)
        await button(detail, 'Back to Sales').click()
        await selectWorkspace('Messages', 'Selling')
        if (width < 1024)
          await page.locator('[data-conversation-id]').first().click()
        assert.equal(await history.locator('[data-timeline-event]').count(), 2)
        await openEditor()
        await fill('pickup')
        await confirm()
        await accept()
        await pay('pickup')
        assert.equal(await button(detail, 'Cancel Order').count(), 0)
        await tab('Fulfillment')
        await button(detail, 'Confirm item is acceptable').click()
        await button(
          dialog('Confirm item is acceptable?'),
          'Reveal Handoff Code'
        ).click()
        const code = await detail.locator('[data-handoff-code]').textContent()
        await role('Seller')
        await tab('Fulfillment')
        const form = detail.getByRole('form', {
          name: 'Preview handoff verification',
          exact: true,
        })
        await form.getByLabel('Enter Handoff Code').fill(code)
        await button(form, 'Verify Handoff Code').click()
        await page.locator('[data-order-status="protection"]').waitFor()
        await detail
          .getByRole('heading', { name: 'Payout pending', exact: true })
          .waitFor()
        assert(
          /^\d{2}:\d{2}:\d{2} until protection window ends$/.test(
            await detail
              .locator('[data-order-countdown="protection"]')
              .textContent()
          )
        )
        await role('Buyer')
        await detail
          .getByRole('heading', { name: 'Marketplace Protection', exact: true })
          .waitFor()
        await screenshot('qualified-protection-buyer')
        await bounds(detail)
        const developer = detail.getByRole('region', {
          name: 'DEV / PREVIEW Controls - Local only',
          exact: true,
        })
        const developerBox = await developer.boundingBox(),
          progressBox = await region('Order Progress').boundingBox()
        assert(developerBox.y > progressBox.y)
        await button(detail, 'Advance protection window').click()
        await detail
          .getByRole('heading', { name: 'Purchase completed', exact: true })
          .waitFor()
        await role('Seller')
        await detail
          .getByRole('heading', { name: 'Sale completed', exact: true })
          .waitFor()
        await button(detail, 'Back to Sales').click()
        const orders = region('Orders'),
          card = orders.locator('[data-order-list-card]')
        assert.equal(await card.count(), 2)
        if (width < 1024) {
          const c = await card.first().boundingBox(),
            b = await button(card.first(), 'View Order').boundingBox()
          assert(b.width > c.width - 40 && b.height >= 44)
        }
        await screenshot('qualified-sales-list')
        await selectWorkspace('Orders', 'Purchases')
        await orders.getByText('No purchases yet.', { exact: true }).waitFor()
        await selectWorkspace('Orders', 'Sales')
        assert.equal(await card.count(), 2)
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        )
        assert.deepEqual(errors, [])
        assert.deepEqual(writes, [])
        console.log(
          `PASS ${width}: single workspace heading/mobile navigation; request cancellation/new snapshot; role-specific reservation/protection/completion; countdowns; both-role unpaid cancellation/payment boundary; shared progress; mobile CTA; no overflow/runtime errors/data writes`
        )
        await context.close()
        continue
      }
      if (process.env.ORDER_TEST_CLEANUP === '1') {
        await openChat()
        await openEditor()
        await fill('pickup')
        assert.equal(await button(editor, 'To be arranged').count(), 0)
        assert(await button(editor, 'Send Request').isDisabled())
        const dates = await page.evaluate(() => {
          const key = (offset) => {
            const d = new Date()
            d.setDate(d.getDate() + offset)
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
              2,
              '0'
            )}-${String(d.getDate()).padStart(2, '0')}`
          }
          return [key(3), key(5)]
        })
        const chooseDate = async (key) => {
          await editor.getByRole('button', { name: /^Date / }).click()
          const calendar = dialog('Schedule calendar')
          for (
            let i = 0;
            i < 2 &&
            !(await calendar.locator(`[data-day="${key}"] button`).count());
            i++
          )
            await calendar.getByRole('button', { name: /next month/i }).click()
          await calendar.locator(`[data-day="${key}"] button`).click()
        }
        await editor
          .getByLabel('Pickup location', { exact: true })
          .fill('On campus')
        await chooseDate(dates[0])
        await setTime('17:45')
        await timeTrigger().click()
        assert.equal(
          await wheelPopup()
            .getByRole('group', { name: 'Hour', exact: true })
            .getAttribute('data-wheel-value'),
          '5'
        )
        assert.equal(
          await wheelPopup()
            .getByRole('group', { name: 'Minute', exact: true })
            .getAttribute('data-wheel-value'),
          '45'
        )
        assert.equal(
          await wheelPopup()
            .getByRole('group', { name: 'AM / PM', exact: true })
            .getAttribute('data-wheel-value'),
          'PM'
        )
        await button(wheelPopup(), 'Cancel').click()
        await button(editor, 'Meet in person').click()
        await editor
          .getByLabel('Meeting location', { exact: true })
          .fill('Library')
        await chooseDate(dates[1])
        await setTime('15:15')
        await button(editor, 'Pickup').click()
        assert.equal(
          await timeTrigger().getAttribute('data-time-value'),
          '17:45'
        )
        assert.equal(
          await editor
            .getByLabel('Pickup location', { exact: true })
            .inputValue(),
          'On campus'
        )
        await editor.locator('textarea').fill('Keep the agreed time')
        await button(editor, 'Send Request').click()
        await dialog('Confirm Order Request')
          .getByText(/5:45 PM/)
          .waitFor()
        await button(dialog('Confirm Order Request'), 'Confirm & Send').click()
        const history = region('Chat messages')
        const first = history.locator('[data-order-preview]').first()
        await first.getByText(/5:45 PM/).waitFor()
        await button(first, 'Expand Order Request preview').click()
        const expanded = dialog('Order Request preview')
        await expanded.getByText(/5:45 PM/).waitFor()
        const media = expanded.locator('img').first(),
          box = await media.boundingBox()
        await media.evaluate((img) => img.decode())
        assert(
          box && box.width > 350,
          'Desktop reused listing media must use its column'
        )
        assert.equal(await button(expanded, 'Accept').count(), 0)
        await screenshot('cleanup-expanded-request')
        await button(expanded, 'Close').click()
        const input = page.getByRole('textbox', {
          name: 'Message',
          exact: true,
        })
        await input.fill('Local test message between requests')
        await input.press('Enter')
        await history
          .getByText('Local test message between requests', { exact: true })
          .waitFor()
        await openEditor()
        await fill('meet', '75')
        await editor.getByLabel('Meeting location', { exact: true }).fill('UCC')
        await chooseDate(dates[1])
        await setTime('15:00')
        await button(editor, 'Send Request').click()
        await button(dialog('Confirm Order Request'), 'Confirm & Send').click()
        const replacement = dialog('Replace current Order Request?')
        await replacement.waitFor()
        assert.equal(await history.locator('[data-order-preview]').count(), 1)
        assert.equal(await first.getAttribute('data-request-status'), 'active')
        await replacement.getByText('CA$75', { exact: true }).waitFor()
        await replacement.getByText('UCC', { exact: true }).waitFor()
        await replacement.getByText(/3:00 PM/).waitFor()
        await screenshot('replacement-confirmation')
        await button(replacement, 'Cancel').click()
        await editor.waitFor()
        assert.equal(await first.getAttribute('data-request-status'), 'active')
        assert.equal(await history.locator('[data-order-preview]').count(), 1)
        assert.equal(
          await editor.getByLabel('Agreed price (CAD)').inputValue(),
          '75'
        )
        assert.equal(
          await editor
            .getByLabel('Meeting location', { exact: true })
            .inputValue(),
          'UCC'
        )
        assert.equal(
          await timeTrigger().getAttribute('data-time-value'),
          '15:00'
        )
        await button(editor, 'Send Request').click()
        await button(dialog('Confirm Order Request'), 'Confirm & Send').click()
        await replacement.waitFor()
        // Two synchronous clicks exercise the action ref before React unmounts the dialog.
        await button(replacement, 'Replace & Send').evaluate((button) => {
          button.click()
          button.click()
        })
        await editor.waitFor({ state: 'hidden' })

        const requests = history.locator('[data-order-preview]')
        assert.equal(await requests.count(), 2)
        assert.equal(
          await requests.first().getAttribute('data-request-status'),
          'superseded'
        )
        assert.equal(
          await requests.first().getByText('Replaced', { exact: true }).count(),
          1
        )
        assert.equal(
          await requests
            .first()
            .getByText(/This request was replaced by a newer Order Request/)
            .count(),
          1
        )
        const positions = await history
          .locator('[data-timeline-id]')
          .evaluateAll((rows) =>
            rows.map((r) => ({ id: r.dataset.timelineId, text: r.textContent }))
          )
        const r1 = positions.findIndex((r) => r.id.startsWith('request:')),
          mid = positions.findIndex((r) =>
            r.text.includes('Local test message between requests')
          ),
          r2 = positions.findLastIndex((r) => r.id.startsWith('request:'))
        assert(r1 < mid && mid < r2)
        await button(region('Preview Controls'), 'Buyer view').click()
        assert.equal(
          await requests.last().locator('..').getAttribute('data-sent'),
          'false'
        )
        await button(requests.first(), 'Expand Order Request preview').click()
        assert.equal(await button(expanded, 'Accept').count(), 0)
        await button(expanded, 'Close').click()
        await button(requests.last(), 'Expand Order Request preview').click()
        assert.equal(await button(expanded, 'Accept').count(), 1)
        await expanded.getByText(/3:00 PM/).waitFor()
        await button(expanded, 'Close').click()
        await button(region('Preview Controls'), 'Seller view').click()
        assert.equal(
          await requests.last().locator('..').getAttribute('data-sent'),
          'true'
        )
        await screenshot('cleanup-chronological-history')
        assert.deepEqual(errors, [])
        assert.deepEqual(writes, [])
        console.log(
          'PASS 1280: required independent Pickup/Meet schedules; wheel 17:45 commit/reopen; confirmation/snapshot/perspective persistence; normal send/replacement confirmation/Cancel draft preservation/double-click one send; chronological request-text-request; Replaced/no Accept; Active Buyer Accept; desktop media; no real data writes/runtime errors'
        )
        await context.close()
        continue
      }
      if (process.env.ORDER_TEST_SCHEDULE === '1') {
        await openChat()
        await openEditor()
        await fill('pickup')
        const day = await page.evaluate(() => {
          const now = new Date(),
            chosen = new Date(now),
            meeting = new Date(now),
            past = new Date(now),
            beyond = new Date(now)
          chosen.setDate(chosen.getDate() + 3)
          chosen.setHours(15, 0, 0, 0)
          meeting.setDate(meeting.getDate() + 5)
          meeting.setHours(17, 30, 0, 0)
          past.setDate(past.getDate() - 1)
          beyond.setDate(beyond.getDate() + 31)
          const key = (d) =>
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
              2,
              '0'
            )}-${String(d.getDate()).padStart(2, '0')}`
          const format = (d) =>
            new Intl.DateTimeFormat('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            }).format(d)
          return {
            now: now.getTime(),
            chosen: chosen.getTime(),
            chosenKey: key(chosen),
            meetingKey: key(meeting),
            pastKey: key(past),
            beyondKey: key(beyond),
            todayKey: key(now),
            chosenLabel: format(chosen),
            meetingLabel: format(meeting),
          }
        })
        const calendar = dialog('Schedule calendar')
        const choose = async (key) => {
          await editor.getByRole('button', { name: /^Date / }).click()
          for (
            let i = 0;
            i < 2 &&
            !(await calendar.locator(`[data-day="${key}"] button`).count());
            i++
          ) {
            await calendar.getByRole('button', { name: /next month/i }).click()
            await page.waitForTimeout(250)
          }
          await calendar.locator(`[data-day="${key}"] button`).click()
          await calendar.waitFor({ state: 'hidden' })
        }
        assert.equal(await timeTrigger().count(), 1)
        assert(await button(editor, 'Send Request').isDisabled())
        await editor.getByRole('button', { name: /^Date / }).click()
        if (
          await calendar.locator(`[data-day="${day.pastKey}"] button`).count()
        )
          assert(
            await calendar
              .locator(`[data-day="${day.pastKey}"] button`)
              .isDisabled()
          )
        const disabledCount = await calendar
          .locator('[data-disabled="true"] button:disabled')
          .count()
        assert(disabledCount > 0)
        await calendar.getByRole('button', { name: /next month/i }).click()
        await page.waitForTimeout(250)
        assert(
          await calendar
            .locator(`[data-day="${day.beyondKey}"] button`)
            .isDisabled()
        )
        await calendar.getByRole('button', { name: /previous month/i }).click()
        await page.waitForTimeout(250)
        await bounds(calendar)
        await screenshot('schedule-calendar')
        await page.keyboard.press('Escape')
        await calendar.waitFor({ state: 'hidden' })
        assert(await editor.isVisible())
        await choose(day.chosenKey)
        await editor.getByRole('button', { name: /^Date / }).click()
        assert.equal(
          await calendar
            .locator(`[data-day="${day.chosenKey}"]`)
            .getAttribute('data-selected'),
          'true'
        )
        await page.keyboard.press('ArrowRight')
        assert(
          await calendar.evaluate((node) =>
            node.contains(document.activeElement)
          )
        )
        await editor
          .getByRole('heading', { name: 'Order Request', exact: true })
          .click()
        await calendar.waitFor({ state: 'hidden' })
        if (process.env.ORDER_TEST_WHEEL === '1') {
          assert.equal(await timeTrigger().getAttribute('data-time-value'), '')
          await timeTrigger().click()
          assert.equal(await wheelPopup().locator('[data-rwp]').count(), 3)
          await bounds(wheelPopup())
          await screenshot('time-wheel-empty')
          await button(wheelPopup(), 'Cancel').click()
          assert.equal(await timeTrigger().getAttribute('data-time-value'), '')
          await timeTrigger().click()
          await button(wheelPopup(), 'Done').click()
          assert.match(
            await timeTrigger().getAttribute('data-time-value'),
            /^\d{2}:(00|15|30|45)$/
          )
          for (const canonical of ['00:00', '12:00', '15:15', '09:30'])
            await setTime(canonical)
          await setTime('15:15')
          await timeTrigger().click()
          assert.equal(
            await wheelPopup()
              .getByRole('group', { name: 'Hour', exact: true })
              .getAttribute('data-wheel-value'),
            '3'
          )
          assert.equal(
            await wheelPopup()
              .getByRole('group', { name: 'Minute', exact: true })
              .getAttribute('data-wheel-value'),
            '15'
          )
          assert.equal(
            await wheelPopup()
              .getByRole('group', { name: 'AM / PM', exact: true })
              .getAttribute('data-wheel-value'),
            'PM'
          )
          const values = await wheelPopup()
            .getByRole('group', { name: 'Minute', exact: true })
            .locator('[data-rwp-highlight-item]')
            .allTextContents()
          assert.deepEqual([...new Set(values)].sort(), [
            '00',
            '15',
            '30',
            '45',
          ])
          await wheelSelect('Hour', 5)
          await wheelSelect('Minute', '45')
          await button(wheelPopup(), 'Cancel').click()
          assert.equal(
            await timeTrigger().getAttribute('data-time-value'),
            '15:15'
          )
          await setTime('17:45')
          await timeTrigger().click()
          const hourWheel = wheelPopup()
            .getByRole('group', { name: 'Hour', exact: true })
            .locator('[data-rwp]')
          await hourWheel.hover()
          await page.mouse.wheel(0, 120)
          await page.waitForFunction(
            () =>
              document.querySelector(
                '[aria-label="Choose time"] [aria-label="Hour"]'
              ).dataset.wheelValue === '6'
          )
          await page.waitForTimeout(100)
          await hourWheel.focus()
          await page.keyboard.press('ArrowUp')
          await page.waitForFunction(
            () =>
              document.querySelector(
                '[aria-label="Choose time"] [aria-label="Hour"]'
              ).dataset.wheelValue === '5'
          )
          await page.keyboard.press('ArrowRight')
          assert(
            await wheelPopup()
              .getByRole('group', { name: 'Minute', exact: true })
              .locator('[data-rwp]')
              .evaluate((node) => node === document.activeElement)
          )
          const minuteWheel = wheelPopup()
            .getByRole('group', { name: 'Minute', exact: true })
            .locator('[data-rwp]')
          const box = await minuteWheel.boundingBox()
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
          await page.mouse.down()
          await page.mouse.move(
            box.x + box.width / 2,
            box.y + box.height / 2 - 32,
            { steps: 8 }
          )
          await page.waitForTimeout(300)
          await page.mouse.move(
            box.x + box.width / 2,
            box.y + box.height / 2 - 32 + 0.1
          )
          await page.mouse.up()
          await page.waitForTimeout(600)
          assert.notEqual(
            await wheelPopup()
              .getByRole('group', { name: 'Minute', exact: true })
              .getAttribute('data-wheel-value'),
            '45'
          )
          await screenshot('time-wheel-controls')
          await page.keyboard.press('Escape')
          await wheelPopup().waitFor({ state: 'hidden' })
          assert.equal(
            await timeTrigger().getAttribute('data-time-value'),
            '17:45'
          )
          await timeTrigger().click()
          await editor
            .getByRole('heading', { name: 'Order Request', exact: true })
            .click()
          await wheelPopup().waitFor({ state: 'hidden' })
          assert.equal(
            await timeTrigger().getAttribute('data-time-value'),
            '17:45'
          )
          // A date change preserves the existing time even when it becomes invalid.
          await setTime('00:00')
          await choose(day.todayKey)
          assert.equal(
            await timeTrigger().getAttribute('data-time-value'),
            '00:00'
          )
          assert(await button(editor, 'Send Request').isDisabled())
          await timeTrigger().click()
          await button(wheelPopup(), 'Done').click()
          await wheelPopup().getByRole('alert').waitFor()
          assert.equal(
            await timeTrigger().getAttribute('data-time-value'),
            '00:00'
          )
          await button(wheelPopup(), 'Cancel').click()
          await choose(day.chosenKey)
          console.log(
            'PASS wheel empty/Cancel/Done; conversions; reopen; 15-minute-only; scroll/drag/arrow keys; Escape/outside; invalid date preserves time and blocks Done'
          )
        }
        await setTime('15:00')
        assert(!(await button(editor, 'Send Request').isDisabled()))
        await timeTrigger().click()
        await page.keyboard.press('Escape')
        assert.equal(await page.locator('[data-rwp]').count(), 0)
        assert.equal(await timeTrigger().count(), 1)
        assert.equal(
          await timeTrigger().getAttribute('data-time-value'),
          '15:00'
        )
        await editor
          .getByRole('button', { name: `Date ${day.chosenLabel}` })
          .waitFor()
        await button(editor, 'Meet in person').click()
        await choose(day.meetingKey)
        await setTime('17:30')
        await button(editor, 'Pickup').click()
        assert.equal(
          await timeTrigger().getAttribute('data-time-value'),
          '15:00'
        )
        await editor
          .getByRole('button', { name: `Date ${day.chosenLabel}` })
          .waitFor()
        await button(editor, 'Meet in person').click()
        assert.equal(
          await timeTrigger().getAttribute('data-time-value'),
          '17:30'
        )
        await editor
          .getByRole('button', { name: `Date ${day.meetingLabel}` })
          .waitFor()
        await button(editor, 'Pickup').click()
        await button(editor, 'Send Request').click()
        const confirmation = dialog('Confirm Order Request')
        const summary = `${day.chosenLabel} \u00b7 3:00 PM`
        await confirmation.getByText(summary, { exact: true }).waitFor()
        // Freeze only this page's local clock to prove confirmation rechecks current time.
        await page.clock.install({ time: new Date(day.now) })
        await page.clock.setSystemTime(new Date(day.chosen - 30 * 60 * 1000))
        await button(confirmation, 'Confirm & Send').click()
        await confirmation
          .getByText('Choose a time at least 1 hour from now.', { exact: true })
          .waitFor()
        assert.equal(await page.locator('[data-order-preview]').count(), 0)
        await page.clock.setSystemTime(new Date(day.now))
        await button(confirmation, 'Go Back').click()
        await confirm()
        await openEditor()
        await fill('meet')
        await choose(day.meetingKey)
        await setTime('17:30')
        await button(editor, 'Cancel').click()
        const card = page.locator('[data-order-preview]').last()
        await button(region('Preview Controls'), 'Buyer view').click()
        await button(card, 'Expand Order Request preview').click()
        await dialog('Order Request preview')
          .getByText(summary, { exact: true })
          .waitFor()
        await button(dialog('Order Request preview'), 'Close').click()
        await page.clock.setSystemTime(new Date(day.chosen + 1))
        await page.clock.runFor(1100)
        await card
          .getByText(
            'Scheduled time passed. This request can no longer be accepted.',
            { exact: true }
          )
          .waitFor()
        for (const perspective of ['Buyer view', 'Seller view']) {
          await button(region('Preview Controls'), perspective).click()
          await button(card, 'Expand Order Request preview').click()
          assert.equal(
            await button(dialog('Order Request preview'), 'Accept').count(),
            0
          )
          await button(dialog('Order Request preview'), 'Close').click()
        }
        // Buyer can still accept with less than one hour remaining: only > now is required.
        await page.clock.setSystemTime(new Date(day.chosen - 30 * 60 * 1000))
        await page.clock.runFor(1100)
        await accept()
        await tab('Overview')
        await region('Order overview')
          .getByText(summary, { exact: true })
          .waitFor()
        await page.clock.setSystemTime(new Date(day.now))
        console.log(
          `PASS ${width}px: DayPicker disabled dates/Escape; 15-min validation; required schedules; Pickup/Meet isolation; Confirm revalidation; immutable snapshots; expired Buyer/Seller no Accept; future <1h Buyer Accept`
        )
      }
      if (process.env.ORDER_TEST_SHIPPING_STATES === '1') {
        for (const cost of ['Included', 'Flat rate', 'To be arranged']) {
          await openChat()
          await openEditor()
          await fill('shipping')
          assert.equal(await timeTrigger().count(), 0)
          assert.equal(await page.locator('[data-rwp]').count(), 0)
          await editor.getByLabel('Shipping method', { exact: true }).fill('')
          await button(editor, 'To be arranged').click()
          assert.equal(await editor.getByLabel('Shipping fee (CAD)').count(), 0)
          await button(editor, 'Included').click()
          assert.equal(await editor.getByLabel('Shipping fee (CAD)').count(), 0)
          await button(editor, 'Flat rate').click()
          assert.equal(
            await editor.getByLabel('Shipping fee (CAD)').inputValue(),
            '10'
          )
          await editor.getByLabel('Shipping fee (CAD)').fill('')
          assert(await button(editor, 'Send Request').isDisabled())
          await editor.getByLabel('Shipping fee (CAD)').fill('-1')
          assert(await button(editor, 'Send Request').isDisabled())
          await editor.getByLabel('Shipping fee (CAD)').fill('0')
          assert(!(await button(editor, 'Send Request').isDisabled()))
          await editor.getByLabel('Shipping fee (CAD)').fill('10')
          await button(editor, cost).click()
          assert(!(await button(editor, 'Send Request').isDisabled()))
          assert.equal(
            await editor.getByLabel(/Recipient|Postal code/).count(),
            0
          )
          await button(editor, 'Send Request').click()
          const c = dialog('Confirm Order Request')
          const label = cost === 'Flat rate' ? 'CA$10' : cost
          await c.getByText(label, { exact: true }).waitFor()
          assert.equal(
            await c.getByText('Shipping method', { exact: true }).count(),
            0
          )
          await button(c, 'Confirm & Send').click()
          const expected = {
            Included: 'CA$80 · Shipping included',
            'Flat rate': 'CA$80 + CA$10 shipping',
            'To be arranged': 'CA$80 · Shipping TBD',
          }[cost]
          await page
            .locator('[data-order-preview]')
            .getByText(expected, { exact: true })
            .waitFor()
          assert.equal(
            await page.locator('[data-order-preview] img').count(),
            0
          )
          await accept()
          await tab('Payment')
          const payment = region('Order payment')
          if (cost === 'To be arranged') {
            await payment
              .getByRole('heading', { name: 'Shipping cost pending' })
              .waitFor()
            assert.equal(
              await payment.getByText('Total', { exact: true }).count(),
              0
            )
            assert.equal(
              await button(payment, 'Simulate payment success').count(),
              0
            )
            assert.equal(await button(detail, 'Continue to Payment').count(), 0)
          } else {
            await payment
              .getByText(cost === 'Flat rate' ? 'CA$93.60' : 'CA$83.20', {
                exact: true,
              })
              .waitFor()
          }
          await screenshot(`shipping-cost-${cost.replaceAll(' ', '-')}`)
        }
        console.log(
          `PASS ${width}px: Included/Flat rate/To be arranged; optional method; draft preservation; immutable summaries/cards; pending payment withheld`
        )
      }
      const flows =
        width >= 1024
          ? ['pickup', 'meet', 'shipping', 'release', 'issue']
          : ['pickup']
      for (const flow of flows.filter(
        (value) =>
          !process.env.ORDER_TEST_FLOW || value === process.env.ORDER_TEST_FLOW
      )) {
        const method = ['release', 'issue'].includes(flow) ? 'pickup' : flow
        await openChat()
        await openEditor()
        if (flow === 'pickup') {
          for (const invalid of ['', '0', '-1', '1.234']) {
            await editor.getByLabel('Agreed price (CAD)').fill(invalid)
            assert(await button(editor, 'Send Request').isDisabled())
          }
          await editor.getByLabel('Agreed price (CAD)').fill('80')
          await editor.getByLabel('Pickup location').fill(' ')
          assert(await button(editor, 'Send Request').isDisabled())
          await editor.getByLabel('Pickup location').fill('UCC preserved')
          await defaultSchedule()
          await button(editor, 'Meet in person').click()
          await editor.getByLabel('Meeting location').fill('Weldon preserved')
          await button(editor, 'Shipping').click()
          assert(!(await button(editor, 'Send Request').isDisabled()))
          assert.equal(await editor.getByLabel('Shipping fee (CAD)').count(), 0)
          await button(editor, 'Flat rate').click()
          await editor
            .getByLabel('Shipping method', { exact: true })
            .fill('Canada Post preserved')
          await editor.getByLabel('Shipping fee (CAD)').fill('-1')
          assert(await button(editor, 'Send Request').isDisabled())
          await editor.getByLabel('Shipping fee (CAD)').fill('0')
          assert(!(await button(editor, 'Send Request').isDisabled()))
          await button(editor, 'Pickup').click()
          assert.equal(
            await editor.getByLabel('Pickup location').inputValue(),
            'UCC preserved'
          )
          assert.equal(
            await timeTrigger().getAttribute('data-time-value'),
            '17:45'
          )
          await button(editor, 'Meet in person').click()
          assert.equal(
            await editor.getByLabel('Meeting location').inputValue(),
            'Weldon preserved'
          )
          await button(editor, 'Shipping').click()
          assert.equal(
            await editor
              .getByLabel('Shipping method', { exact: true })
              .inputValue(),
            'Canada Post preserved'
          )
          await fill('pickup', '90')
          await confirm()
          await openEditor()
        }
        await fill(method)
        await bounds(editor)
        const footer = await button(editor, 'Send Request').boundingBox()
        assert(footer.y + footer.height <= 901)
        await screenshot(`${flow}-editor`)
        await button(editor, 'Send Request').click()
        const confirmation = dialog('Confirm Order Request')
        await confirmation.waitFor()
        await bounds(confirmation)
        assert.equal(
          await confirmation
            .getByText('Shipping method', { exact: true })
            .count(),
          method === 'shipping' ? 1 : 0
        )
        assert.equal(
          await confirmation
            .getByText('Pickup location', { exact: true })
            .count(),
          method === 'pickup' ? 1 : 0
        )
        await screenshot(`${flow}-confirmation`)
        await button(confirmation, 'Go Back').click()
        assert.equal(
          await editor.getByLabel('Agreed price (CAD)').inputValue(),
          '80'
        )
        await confirm()
        if (flow === 'pickup') {
          const old = page
            .locator('[data-order-preview][data-request-status="superseded"]')
            .first()
          await old.waitFor()
          await button(old, 'Expand Order Request preview').click()
          assert.equal(
            await button(dialog('Order Request preview'), 'Accept').count(),
            0
          )
          assert.equal(
            await dialog('Order Request preview')
              .getByRole('button', { name: /Edit/ })
              .count(),
            0
          )
          await button(dialog('Order Request preview'), 'Close').click()
          await button(region('Preview Controls'), 'Buyer view').click()
          await button(old, 'Expand Order Request preview').click()
          assert.equal(
            await button(dialog('Order Request preview'), 'Accept').count(),
            0
          )
          await button(dialog('Order Request preview'), 'Close').click()
        }
        await screenshot(`${flow}-requests`)
        await accept()
        await page.locator('[data-order-status="reserved"]').waitFor()
        await bounds(detail)
        assert.equal(
          await region('Order Progress').locator('li').count(),
          method === 'shipping' ? 6 : 5
        )
        await region('Next Step')
          .getByText(/Reserved for you/)
          .waitFor()
        await screenshot(`${flow}-reserved`)
        await noSellerCancel()
        if (flow === 'release') {
          await role('Buyer')
          await button(detail, 'Release Reservation').click()
          const release = dialog('Release reservation?')
          await release.getByLabel('Reason').selectOption('Other')
          await release.getByLabel('Details').fill('Synthetic change of plan')
          await bounds(release)
          await screenshot('release-dialog')
          await button(release, 'Go Back').click()
          await button(detail, 'Release Reservation').click()
          await button(
            dialog('Release reservation?'),
            'Release Reservation'
          ).click()
          await page.locator('[data-order-status="cancelled"]').waitFor()
          await screenshot('cancelled')
          await noSellerCancel()
          continue
        }
        if (method === 'shipping') {
          await tab('Fulfillment')
          assert.equal(await detail.getByRole('textbox').count(), 0)
          await detail
            .getByText('Available after buyer payment', { exact: true })
            .waitFor()
          await role('Buyer')
          await button(detail, 'Add shipping address').click()
          const form = detail.getByRole('form', {
            name: 'Preview shipping address',
            exact: true,
          })
          for (const [field, value] of Object.entries({
            'Recipient name': 'Synthetic Recipient',
            Address: '123 Example Street',
            City: 'London',
            Province: 'ON',
            'Postal code': 'N6A 1A1',
          }))
            await form.getByLabel(field, { exact: true }).fill(value)
          await screenshot('shipping-address')
          await button(form, 'Save & Continue').click()
          await region('Order payment').waitFor()
          await role('Seller')
          await tab('Fulfillment')
          await detail
            .getByText('Available after buyer payment', { exact: true })
            .waitFor()
          assert.equal(
            await detail
              .getByText('Synthetic Recipient', { exact: false })
              .count(),
            0
          )
        }
        await pay(method)
        if (flow === 'issue') {
          await button(detail, 'Report an issue').click()
          const report = dialog('Report an issue')
          await report
            .getByLabel('Reason')
            .selectOption('Item has an undisclosed problem')
          await screenshot('issue-dialog')
          await button(report, 'Report issue · Preview only').click()
          await tab('Payment')
          await detail.getByText('On hold', { exact: true }).waitFor()
          await screenshot('issue-hold')
          await noSellerCancel()
          await button(detail, 'Report an issue').click()
          await dialog('Report an issue')
            .getByLabel('Reason')
            .selectOption('Buyer refused the handoff')
          await button(
            dialog('Report an issue'),
            'Report issue · Preview only'
          ).click()
          continue
        }
        if (method === 'shipping') {
          await role('Seller')
          await button(detail, 'Add shipment details').click()
          await detail
            .getByText('Synthetic Recipient', { exact: false })
            .waitFor()
          const form = detail.getByRole('form', {
            name: 'Preview shipment details',
            exact: true,
          })
          await form.getByLabel('Carrier', { exact: true }).fill('Canada Post')
          await form.getByLabel('Tracking number').fill('SYNTHETIC-TRACKING')
          await screenshot('shipping-ready')
          await button(form, 'Confirm Shipped').click()
          await page.locator('[data-order-status="shipped"]').waitFor()
          await role('Buyer')
          await tab('Fulfillment')
          await detail
            .getByText('SYNTHETIC-TRACKING', { exact: true })
            .waitFor()
          await screenshot('shipping-shipped')
          await button(detail, 'Simulate package delivered').click()
          await page.locator('[data-order-status="delivered"]').waitFor()
          assert.equal(
            await page.locator('[data-order-status="completed"]').count(),
            0
          )
          await button(detail, 'Confirm received').click()
          const receive = dialog('Confirm you received the item?')
          await bounds(receive)
          await screenshot('shipping-receive-dialog')
          await button(receive, 'Confirm Received').click()
        } else {
          await button(detail, 'Confirm item is acceptable').click()
          const inspect = dialog('Confirm item is acceptable?')
          await bounds(inspect)
          await screenshot(`${method}-inspect-dialog`)
          await button(inspect, 'Reveal Handoff Code').click()
          const code = await detail.locator('[data-handoff-code]').textContent()
          assert(/^\d{6}$/.test(code))
          assert.equal(
            await page.locator('[data-order-status="paid"]').count(),
            1
          )
          await screenshot(`${method}-code`)
          await role('Seller')
          assert.equal(await detail.locator('[data-handoff-code]').count(), 0)
          const form = detail.getByRole('form', {
            name: 'Preview handoff verification',
            exact: true,
          })
          await form.getByLabel('Enter Handoff Code').fill('000000')
          await button(form, 'Verify Handoff Code').click()
          await form.getByRole('alert').waitFor()
          await screenshot(`${method}-wrong-code`)
          await form.getByLabel('Enter Handoff Code').fill(code)
          await button(form, 'Verify Handoff Code').click()
        }
        await page.locator('[data-order-status="protection"]').waitFor()
        assert.equal(
          await page.locator('[data-order-status="completed"]').count(),
          0
        )
        await screenshot(`${method}-protection`)
        await bounds(detail)
        await role('Buyer')
        assert.equal(
          await detail.getAttribute('data-origin-workspace'),
          'sales'
        )
        await button(detail, 'Back to Sales').click()
        const orders = region('Orders')
        await orders.locator('[data-order-list-card]').waitFor()
        assert.equal(await orders.locator('[data-order-list-card]').count(), 1)
        if (width >= 1024) {
          assert.equal(await orders.getByRole('tab').count(), 0)
          assert.equal(
            await orders
              .getByRole('heading', { name: 'Sales', exact: true })
              .count(),
            1
          )
          await page.getByRole('link', { name: 'Orders', exact: true }).hover()
          const orderNav = page
          await orderNav
            .getByRole('button', { name: 'Purchases', exact: true })
            .click()
          await orders.getByText('No purchases yet.', { exact: true }).waitFor()
          assert.equal(
            await orderNav
              .getByRole('button', { name: 'Purchases', exact: true })
              .getAttribute('aria-current'),
            'page'
          )
          assert.equal(
            await orders.locator('[data-order-list-card]').count(),
            0
          )
          await orderNav
            .getByRole('button', { name: 'Sales', exact: true })
            .click()
          await orders.locator('[data-order-list-card]').waitFor()
          await page.mouse.move(width - 100, 300)
          await page.waitForTimeout(300)
        } else {
          await orders
            .getByRole('tab', { name: 'Purchases', exact: true })
            .click()
          await orders.getByText('No purchases yet.', { exact: true }).waitFor()
          await orders.getByRole('tab', { name: 'Sales', exact: true }).click()
          await orders.locator('[data-order-list-card]').waitFor()
        }
        assert.equal(await orders.locator('[data-order-list-card]').count(), 1)
        await screenshot(`${method}-orders`)
        await button(orders, 'View Order').click()
        await detail.waitFor()
        assert.equal(await detail.getAttribute('data-order-role'), 'seller')
        assert.equal(await detail.getAttribute('data-preview-role'), 'seller')
        assert.equal(
          await detail.getAttribute('data-origin-workspace'),
          'sales'
        )
        await tab('Overview')
        await detail.getByText('CA$80', { exact: true }).waitFor()
        if (flow === 'pickup' && width >= 1024) {
          await page
            .getByRole('link', { name: 'Messages', exact: true })
            .click()
          await page
            .getByRole('link', { name: 'Messages', exact: true })
            .locator('..')
            .getByRole('button', { name: 'Selling', exact: true })
            .click()
          await region('Chat panel').waitFor()
          // Leave the existing hover-expanded navigation rail before clicking left-side controls.
          await page.mouse.move(width - 100, 300)
          await page.waitForTimeout(300)
          const accepted = page.locator(
            '[data-order-preview][data-request-status="accepted"]'
          )
          for (const perspective of ['Buyer view', 'Seller view']) {
            await button(region('Preview Controls'), perspective).click()
            await button(accepted, 'Expand Order Request preview').click()
            assert.equal(
              await button(dialog('Order Request preview'), 'Accept').count(),
              0
            )
            await button(dialog('Order Request preview'), 'Close').click()
          }
          await openEditor()
          await fill('pickup', '120')
          await confirm()
          assert.equal(
            await page
              .locator('[data-order-preview][data-request-status="accepted"]')
              .count(),
            1
          )
          assert.equal(
            await page
              .locator('[data-order-preview][data-request-status="superseded"]')
              .count(),
            1
          )
          await page.getByRole('link', { name: 'Orders', exact: true }).click()
          await page.getByRole('button', { name: 'Sales', exact: true }).click()
          await page.mouse.move(width - 100, 300)
          await page.waitForTimeout(300)
          await region('Orders').locator('[data-order-list-card]').waitFor()
          assert.equal(
            await region('Orders').locator('[data-order-list-card]').count(),
            1
          )
          await button(region('Orders'), 'View Order').click()
          await detail.waitFor()
          await tab('Overview')
          await detail.getByText('CA$80', { exact: true }).waitFor()
          assert.equal(
            await detail.getByText('CA$120', { exact: true }).count(),
            0
          )
        }
        if (width >= 1024) {
          await button(detail, 'Advance protection window').click()
          await page.locator('[data-order-status="completed"]').waitFor()
          await screenshot(`${method}-completed`)
        }
      }
      // Existing Attachment remains accessible and full reload clears every preview Order.
      await openChat()
      await button(region('Chat panel'), 'Add to conversation').click()
      await button(region('Chat panel'), 'Attachment').click()
      await region('Chat panel').locator('[data-attachment-panel]').waitFor()
      await page.goto(base + '/home?section=orders')
      await region('Orders')
        .getByText('No purchases yet.', { exact: true })
        .waitFor()
      assert.deepEqual(writes, [], 'No Order or application data mutations')
      assert.deepEqual(errors, [], 'No runtime errors')
      console.log(
        `PASS ${width}px: ${flows
          .filter(
            (value) =>
              !process.env.ORDER_TEST_FLOW ||
              value === process.env.ORDER_TEST_FLOW
          )
          .join(
            '/'
          )} local flows; validation, immutable requests, perspectives, protection, no data writes; refresh clears previews`
      )
      await context.close()
    }
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error.stack)
  process.exitCode = 1
})
