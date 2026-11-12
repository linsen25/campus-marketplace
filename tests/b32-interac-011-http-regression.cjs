// Real B32 HTTP regression for deployed Migration 011. The script uses only
// normal Seller/Buyer sessions and application APIs; it never writes tables.
const fs = require('node:fs')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const {
  request,
} = require('./artifacts/browser-tools/node_modules/playwright-core')

const base = process.env.B32_BROWSER_BASE || 'http://localhost:3050'
const credentials = JSON.parse(
  fs.readFileSync('tests/artifacts/b32/credentials.json', 'utf8')
)
const completed = [
  '4b4de7fb-efe2-41c4-b092-8da111085043',
  '1596f92f-1a59-4baf-bf50-160031686a71',
]
const missingReceipt = 'a6106031-127b-46af-8781-6bafe1389b04'
const direct = '45b97937-159c-4490-b6ca-e4fe0764f994'
const headers = { Origin: base, 'X-Marketplace-Request': '1' }

async function login(role) {
  const client = await request.newContext()
  const response = await client.post(`${base}/api/auth/sign-in`, {
    headers,
    data: credentials.users[role],
  })
  assert.equal(response.status(), 200, `${role} login`)
  return client
}

async function readInterac(client, id) {
  const response = await client.get(
    `${base}/api/order-domain/${id}/interac-payment`
  )
  const body = await response.json()
  return { http: response.status(), body }
}

async function readOrder(client, id) {
  const response = await client.get(`${base}/api/orders/${id}`)
  const body = await response.json()
  return {
    http: response.status(),
    lifecycle: body.order?.lifecycle || null,
    paymentStatus: body.order?.paymentStatus || null,
    paymentPaidAt: body.order?.paymentPaidAt || null,
  }
}

async function exchange(client, id) {
  const response = await client.post(
    `${base}/api/order-domain/${id}/confirm-exchange`,
    { headers, data: { clientActionId: randomUUID() } }
  )
  return { http: response.status(), body: await response.json() }
}

void (async () => {
  const buyer = await login('buyer')
  const seller = await login('seller')
  const anonymous = await request.newContext()
  const output = {
    project: 'giqdwyiupslpfhstbtqf',
    completed: {},
    missingReceipt: {},
    anonymous: {},
    direct: {},
  }
  try {
    for (const id of completed) {
      const before = {
        buyer: await readInterac(buyer, id),
        seller: await readInterac(seller, id),
      }
      for (const state of Object.values(before)) {
        assert.equal(state.http, 200)
        assert.equal(state.body.status, 'receipt_confirmed')
        assert.ok(state.body.buyerReportedAt)
        assert.ok(state.body.sellerReceivedAt)
      }
      assert.equal(
        before.buyer.body.buyerReportedAt,
        before.seller.body.buyerReportedAt
      )
      assert.equal(
        before.buyer.body.sellerReceivedAt,
        before.seller.body.sellerReceivedAt
      )

      const repeatReport = await buyer.post(
        `${base}/api/order-domain/${id}/report-interac-payment`,
        { headers, data: { reference: 'must-not-rewrite-terminal-history' } }
      )
      const repeatReceipt = await seller.post(
        `${base}/api/order-domain/${id}/confirm-interac-receipt`,
        { headers, data: {} }
      )
      assert.equal(repeatReport.status(), 403)
      assert.equal(repeatReceipt.status(), 403)

      const duplicateExchange = {
        buyer: await exchange(buyer, id),
        seller: await exchange(seller, id),
      }
      assert.equal(duplicateExchange.buyer.http, 200)
      assert.equal(duplicateExchange.seller.http, 200)
      assert.equal(duplicateExchange.buyer.body.status, 'confirmed')
      assert.equal(duplicateExchange.seller.body.status, 'confirmed')

      const after = {
        buyer: await readInterac(buyer, id),
        seller: await readInterac(seller, id),
        order: await readOrder(buyer, id),
      }
      assert.equal(
        after.buyer.body.buyerReportedAt,
        before.buyer.body.buyerReportedAt
      )
      assert.equal(
        after.buyer.body.sellerReceivedAt,
        before.buyer.body.sellerReceivedAt
      )
      assert.equal(
        after.seller.body.buyerReportedAt,
        before.seller.body.buyerReportedAt
      )
      assert.equal(
        after.seller.body.sellerReceivedAt,
        before.seller.body.sellerReceivedAt
      )
      assert.equal(after.order.lifecycle, 'completed')
      assert.equal(after.order.paymentStatus, 'pending')
      assert.equal(after.order.paymentPaidAt, null)
      output.completed[id] = {
        participantHistoryHttp: {
          buyer: before.buyer.http,
          seller: before.seller.http,
        },
        status: before.buyer.body.status,
        buyerReportedAt: before.buyer.body.buyerReportedAt,
        sellerReceivedAt: before.buyer.body.sellerReceivedAt,
        repeatReportHttp: repeatReport.status(),
        repeatReceiptHttp: repeatReceipt.status(),
        duplicateExchangeHttp: {
          buyer: duplicateExchange.buyer.http,
          seller: duplicateExchange.seller.http,
        },
        timestampsUnchanged: true,
        order: after.order,
      }
    }

    const negativeBefore = {
      buyer: await readInterac(buyer, missingReceipt),
      seller: await readInterac(seller, missingReceipt),
    }
    assert.equal(negativeBefore.buyer.http, 200)
    assert.equal(negativeBefore.seller.http, 200)
    assert.equal(negativeBefore.buyer.body.status, 'payment_reported')
    assert.equal(negativeBefore.buyer.body.sellerReceivedAt, null)
    const denied = {
      buyer: await exchange(buyer, missingReceipt),
      seller: await exchange(seller, missingReceipt),
    }
    for (const response of Object.values(denied)) {
      assert.equal(response.http, 409)
      assert.match(response.body.error, /must report payment.*confirm receipt/i)
    }
    const negativeAfter = await readOrder(buyer, missingReceipt)
    assert.equal(negativeAfter.lifecycle, 'open')
    assert.equal(negativeAfter.paymentStatus, 'pending')
    assert.equal(negativeAfter.paymentPaidAt, null)
    output.missingReceipt = {
      orderId: missingReceipt,
      participantHistoryHttp: {
        buyer: negativeBefore.buyer.http,
        seller: negativeBefore.seller.http,
      },
      status: negativeBefore.buyer.body.status,
      sellerReceivedAt: negativeBefore.buyer.body.sellerReceivedAt,
      exchangeHttp: { buyer: denied.buyer.http, seller: denied.seller.http },
      order: negativeAfter,
    }

    const anonymousRead = await readInterac(anonymous, completed[0])
    assert.equal(anonymousRead.http, 401)
    output.anonymous = { historyHttp: anonymousRead.http }

    const directRepeat = {
      buyer: await exchange(buyer, direct),
      seller: await exchange(seller, direct),
    }
    assert.equal(directRepeat.buyer.http, 200)
    assert.equal(directRepeat.seller.http, 200)
    assert.equal(directRepeat.buyer.body.status, 'confirmed')
    assert.equal(directRepeat.seller.body.status, 'confirmed')
    output.direct = {
      orderId: direct,
      duplicateExchangeHttp: {
        buyer: directRepeat.buyer.http,
        seller: directRepeat.seller.http,
      },
      status: directRepeat.buyer.body.status,
    }
  } finally {
    await buyer.dispose()
    await seller.dispose()
    await anonymous.dispose()
  }
  fs.writeFileSync(
    'tests/artifacts/b32/browser-transaction-e2e/interac-011-http-regression.json',
    JSON.stringify(output, null, 2)
  )
  console.log(JSON.stringify(output, null, 2))
})().catch((error) => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})
