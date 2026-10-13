import type { PreviewOrder, PreviewRole } from './order-interaction-preview'
import { previewNextStep } from './order-interaction-preview'

export function formatOrderCountdown(
  expiresAt: number,
  now: number,
  hours: boolean
) {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000))
  const part = (value: number) => String(value).padStart(2, '0')
  return hours
    ? `${part(Math.floor(seconds / 3600))}:${part(
        Math.floor(seconds / 60) % 60
      )}:${part(seconds % 60)}`
    : `${part(Math.floor(seconds / 60))}:${part(seconds % 60)}`
}
/** Shared objective order, role-specific purpose. No business transitions or payment assertions. */
export function getOrderPreviewPresentation(
  order: PreviewOrder,
  role: PreviewRole
) {
  let title = previewNextStep(order, role)
  let description = ''
  if (order.status === 'reserved') {
    if (title !== 'Shipping cost pending')
      title = role === 'buyer' ? 'Complete payment' : 'Buyer payment pending'
    description =
      role === 'buyer'
        ? 'Complete payment before the reservation expires.'
        : 'The listing is reserved for this buyer. Do not hand over the item until payment is confirmed.'
  }
  if (
    order.status === 'paid' &&
    order.snapshot.draft.fulfillment !== 'shipping'
  ) {
    if (role === 'seller')
      title = order.handoffCode ? 'Enter Handoff Code' : 'Prepare for handoff'
    description =
      role === 'buyer'
        ? 'Payment confirmed. Inspect the item before sharing your Handoff Code.'
        : 'Buyer has paid. Verify the Handoff Code before completing handoff.'
  }
  if (order.status === 'protection')
    description =
      role === 'buyer'
        ? 'You have 24 hours after handoff to report a problem with the item.'
        : 'The buyer has 24 hours to report an issue. Your payout becomes eligible after the protection window ends if no issue is reported.'
  if (order.status === 'completed')
    description =
      role === 'buyer'
        ? 'The transaction is finished. Your purchase record remains available.'
        : 'The transaction is finished. Payout eligible �� Preview. No real payout has occurred.'
  if (order.status === 'cancelled') {
    title = role === 'buyer' ? 'Purchase cancelled' : 'Sale cancelled'
    description =
      'Reservation ended. Listing available again in this preview. No payment completed; no refund required.'
  }
  if (order.issue) {
    title = 'Order on hold'
    description =
      role === 'buyer'
        ? 'Your issue is recorded in this local preview.'
        : 'An issue is reported. Payout remains on hold �� Preview.'
  }
  return {
    title,
    description,
    countdownLabel:
      role === 'buyer' ? 'Reserved for you' : 'Buyer payment pending',
    protectionSuffix:
      role === 'buyer' ? 'remaining' : 'until protection window ends',
  }
}
