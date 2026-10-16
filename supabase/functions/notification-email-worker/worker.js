/* eslint @typescript-eslint/naming-convention: off -- This Deno JavaScript module has no TypeScript parser services. */
import {
  notificationCopy,
  notificationTarget,
} from '../../../lib/notification-presentation.ts' // eslint-disable-line import/extensions -- Deno requires explicit extensions.

const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[
        c
      ])
  )

async function providerFailureReason(response) {
  const payload = await response.json().catch(() => null)
  const message = typeof payload?.message === 'string' ? payload.message : ''
  // Derive only allowlisted classifications; never return/store the message itself.
  if (/only send testing emails/i.test(message))
    return 'test_sender_recipient_restricted'
  if (/domain/i.test(message) && /not verified/i.test(message))
    return 'sender_domain_unverified'
  if (response.status === 401) return 'api_key_invalid'
  if (response.status === 403) return 'provider_forbidden'
  if (response.status === 429) return 'rate_limited'
  if (response.status >= 500) return 'provider_unavailable'
  if (/\bfrom\b/i.test(message) && /invalid/i.test(message))
    return 'sender_invalid'
  if (/\bto\b/i.test(message) && /invalid/i.test(message))
    return 'recipient_invalid'
  return 'provider_request_invalid'
}

export function emailEnvelope(row, from, recipient, origin) {
  const { title, body } = notificationCopy(row.type)
  const target = notificationTarget(row.destination)
  const url = target ? origin + target : null
  return {
    from,
    to: [recipient],
    subject: title,
    text: `Usual & Unusual\n\n${title}\n${body}\n${
      url || ''
    }\n\nSign in to Usual & Unusual to review this transaction.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#202024"><p style="font-weight:bold">Usual &amp; Unusual</p><h1 style="font-size:24px">${escape(
      title
    )}</h1><p style="line-height:1.6">${escape(body)}</p>${
      url
        ? `<p><a style="display:inline-block;background:#196c46;color:white;padding:12px 18px;border-radius:8px;text-decoration:none" href="${escape(
            url
          )}">Open Usual &amp; Unusual</a></p>`
        : ''
    }<hr style="border:0;border-top:1px solid #ddd"><p style="font-size:12px;color:#666">Sign in to review this transaction. This is a transactional notification.</p></div>`,
  }
}

// Dependency-injected core: no provider secret, email or raw response is logged.
export async function runEmailBatch({
  rpc,
  send,
  from,
  testRecipient,
  origin,
  testDeliveryId = null,
}) {
  const testSender = /@resend\.dev(?:>|$)/i.test(from)
  if (testSender && !testRecipient)
    return { blocked: 'test_recipient_required', sent: 0 }
  const rows = await rpc('marketplace_claim_email_deliveries', {
    p_limit: 3,
    p_test_id: testDeliveryId,
  })
  let sent = 0
  let failed = 0
  const failureReasons = []
  for (const row of rows) {
    const finish = (id, error, retry) =>
      rpc('marketplace_finish_email', {
        p_id: row.id,
        p_lease: row.leaseId,
        p_provider_id: id,
        p_error: error,
        p_retry: retry,
      })
    const recipient = row.testOnly ? testRecipient : row.email
    if (!recipient || (testSender && recipient !== testRecipient)) {
      await finish(null, 'sender_restricted', false)
      failed++
      failureReasons.push('test_sender_recipient_restricted')
      // eslint-disable-next-line no-continue -- Reject this recipient before any provider send.
      continue
    }
    const envelope = await rpc('marketplace_prepare_email', {
      p_id: row.id,
      p_lease: row.leaseId,
      p_envelope: row.envelope || emailEnvelope(row, from, recipient, origin),
    })
    // A frozen envelope cannot become deliverable to a new recipient on retry.
    if (
      testSender &&
      (envelope.to.length !== 1 || envelope.to[0] !== testRecipient)
    ) {
      await finish(null, 'sender_restricted', false)
      failed++
      failureReasons.push('frozen_recipient_restricted')
      // eslint-disable-next-line no-continue -- A frozen request cannot be redirected on retry.
      continue
    }
    try {
      const response = await send(envelope, `campus-marketplace/${row.id}`)
      if (response.ok) {
        const payload = await response.json()
        if (
          typeof payload?.id !== 'string' ||
          !/^[a-zA-Z0-9_-]{1,200}$/.test(payload.id)
        )
          throw Error('Unknown provider result')
        await finish(payload.id, null, false)
        sent++
      } else {
        // Do not persist/log raw provider errors (which can contain recipient addresses).
        const retry = response.status === 429 || response.status >= 500
        let error = 'invalid_request'
        if (response.status === 429) error = 'rate_limited'
        if (response.status >= 500) error = 'provider_unavailable'
        if (response.status === 403) error = 'sender_restricted'
        await finish(null, error, retry)
        failed++
        failureReasons.push(await providerFailureReason(response))
      }
    } catch {
      // A timeout/unknown acknowledgement retries the SAME frozen payload and key.
      await finish(null, 'timeout', true)
      failed++
      failureReasons.push('transport_or_acknowledgement')
    }
  }
  return { claimed: rows.length, sent, failed, failureReasons }
}
