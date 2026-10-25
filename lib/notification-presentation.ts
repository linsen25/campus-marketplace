const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function notificationTarget(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const d = value as Record<string, unknown>
  const id = (key: string) =>
    typeof d[key] === 'string' && uuid.test(d[key] as string)
  if (
    d.section === 'orders' &&
    id('orderId') &&
    ['purchases', 'sales'].includes(String(d.destination))
  )
    return `/home?section=orders&destination=${d.destination}&order=${d.orderId}`
  if (
    d.section === 'messages' &&
    id('conversationId') &&
    ['buying', 'selling'].includes(String(d.destination))
  )
    return `/home?section=messages&destination=${d.destination}&conversation=${d.conversationId}`
  if (d.section === 'listing' && id('listingId'))
    return `/listings/${d.listingId}`
  if (d.section === 'shop' && d.destination === 'my-shop')
    return '/home?section=my-shop'
  if (d.section === 'settings' && d.panel === 'payments-payouts')
    return '/home?section=settings&focus=payments-payouts'
  return null
}

const copy: Record<string, [string, string]> = {
  external_exchange_buyer_confirmed: [
    'Buyer confirmed the exchange',
    'The Buyer reports a direct exchange. Confirm only if you received payment and handed over the item. No UU payment protection.',
  ],
  external_exchange_seller_confirmed: [
    'Seller confirmed the exchange',
    'The Seller reports a direct exchange. Confirm only if you paid directly and received the item. No UU payment protection.',
  ],
  external_exchange_completed: [
    'External exchange completed',
    'Both participants confirmed the direct exchange. UU did not process or protect the payment.',
  ],
  external_exchange_disputed: [
    'External exchange disputed',
    'The Listing remains held. UU cannot verify, reverse, refund or financially adjudicate external payments.',
  ],
  external_exchange_cancelled: [
    'External exchange cancelled',
    'The Order was cancelled before either participant confirmed an exchange. No UU refund or payout applies.',
  ],
  notification_test: [
    'Staging email test',
    'This is a controlled Campus Marketplace notification delivery test. No marketplace transaction was changed.',
  ],
  incoming_offer: [
    'New offer received',
    'Review the offer and its proposed terms in Messages.',
  ],
  incoming_counter_offer: [
    'Counter offer received',
    'Review the revised proposal in Messages.',
  ],
  offer_accepted: [
    'Offer accepted',
    'An Order has been created. Review its frozen Agreement.',
  ],
  offer_declined: [
    'Offer declined',
    'The other participant declined your offer.',
  ],
  offer_closed: [
    'Offer no longer available',
    'This offer is no longer available.',
  ],
  offer_withdrawn: [
    'Offer withdrawn',
    'The other participant withdrew their offer.',
  ],
  agreement_confirmation_required: [
    'Agreement needs your confirmation',
    'Review and confirm the frozen Order terms. Both participants must confirm before the Order can continue.',
  ],
  agreement_other_confirmed: [
    'The other party confirmed',
    'Your Agreement confirmation is still needed before the Order can continue.',
  ],
  agreement_complete: [
    'Agreement confirmed',
    'Both participants confirmed the Agreement. Open the Order for the next step.',
  ],
  payment_required: [
    'Payment is ready',
    'The Buyer can now continue to payment.',
  ],
  payment_paid: [
    'Payment confirmed',
    'The current payment authority has confirmed payment. Open the Order for the next step.',
  ],
  payment_failed: [
    'Payment unsuccessful',
    'Open the Order to review the payment result and available actions.',
  ],
  seller_delivery_started: [
    'Delivery started',
    'The Seller has started delivery. Open the Order for details.',
  ],
  handoff_ready: [
    'Handoff is ready',
    'Open the Order to follow the handoff instructions.',
  ],
  handoff_confirmed: [
    'Handoff confirmed',
    'Handoff has been verified. Open the Order for its current status.',
  ],
  protection_started: [
    'Marketplace Protection started',
    'Open the Order to review the Protection window and available support.',
  ],
  protection_case_opened: [
    'Transaction on hold',
    'A Case affects this transaction. Open the Order to review its authoritative status.',
  ],
  order_completed: [
    'Order completed',
    'The Order has completed. You can review its details.',
  ],
  order_cancelled: [
    'Order cancelled',
    'Open the Order to review the cancellation and settlement information.',
  ],
  cancellation_requested: [
    'Cancellation requested',
    'Open the Order to review the cancellation request and any required response.',
  ],
  courier_shipped: ['Order shipped', 'Open the Order for shipment details.'],
  courier_delivered: [
    'Delivery update',
    'The shipment is marked delivered. Open the Order for the next step.',
  ],
  buyer_confirm_received: [
    'Receipt confirmed',
    'The Buyer confirmed receipt. Open the Order for its current status.',
  ],
  meetup_proposed: [
    'Meeting change proposed',
    'Review the proposed meeting change in the Order.',
  ],
  meetup_confirmed: [
    'Meeting confirmed',
    'Your meeting details have been confirmed.',
  ],
  meetup_declined: [
    'Meeting change declined',
    'The proposed meeting change was declined.',
  ],
  meetup_24h: [
    'Meeting reminder',
    'Your meeting is approaching. Review the agreed details.',
  ],
  meetup_1h: [
    'Meeting reminder',
    'Your meeting is coming up soon. Review the agreed details.',
  ],
  reservation_expired: [
    'Order expired',
    'The Order expired. Open its details for the outcome.',
  ],
  order_no_show_expired: [
    'Meeting Order expired',
    'Open the Order to review its outcome.',
  ],
  delivery_claim_1h: [
    'Checkout reminder',
    'Open the Order to review the checkout deadline.',
  ],
  delivery_payment_10m: [
    'Payment deadline approaching',
    'Open the Order to review the payment deadline.',
  ],
  payout_needs_attention: [
    'Payout needs attention',
    'Review your payout information in the app.',
  ],
  payout_paid: ['Payout confirmed', 'Open the Order for payout details.'],
  price_drop: [
    'Saved Listing price dropped',
    'A Listing in your Favorites has a lower asking price.',
  ],
  new_message: [
    'New message',
    'You have a new message. Open the conversation to read it.',
  ],
  shop_trial_activated: [
    'Shop trial activated',
    'Your Shop trial benefits are now available. This does not start automatic renewal.',
  ],
  shop_membership_access_started: [
    'Shop membership active',
    'Your current Shop membership access is now available. This notice does not confirm a future renewal.',
  ],
  shop_membership_access_upgraded: [
    'Shop membership upgraded',
    'Your upgraded Shop benefits are now available. This notice does not confirm a future renewal.',
  ],
  shop_suspended: [
    'Shop temporarily suspended',
    'Your Shop is temporarily suspended because membership access ended. Your UU account remains active.',
  ],
  shop_reopened: [
    'Shop reopened',
    'Your Shop membership access is active again and your Shop can operate.',
  ],
  order_refund_succeeded: [
    'Refund confirmed',
    'Stripe confirmed the authorized refund for this Order.',
  ],
  order_refund_failed: [
    'Refund unsuccessful',
    'Stripe did not complete the authorized refund. Open the Order to review its current status.',
  ],
  order_refund_unresolved: [
    'Refund status needs review',
    'The refund result could not be confirmed. Open the Order to review its current status.',
  ],
  seller_transfer_succeeded: [
    'Seller transfer confirmed',
    'Funds were transferred to your Stripe Connected Account. This does not confirm a bank payout.',
  ],
  seller_transfer_failed: [
    'Seller transfer unsuccessful',
    'Stripe did not complete the transfer to your Connected Account. Open the Order to review its status.',
  ],
  seller_transfer_unresolved: [
    'Seller transfer status needs review',
    'The transfer result could not be confirmed. Open the Order to review its current status.',
  ],
  seller_transfer_reversed: [
    'Seller transfer reversed',
    'Stripe reports that the transfer to your Connected Account was reversed. This does not change bank payout facts.',
  ],
  seller_transfer_partially_reversed: [
    'Seller transfer partly reversed',
    'Stripe reports that part of the transfer to your Connected Account was reversed. This does not change bank payout facts.',
  ],
  connected_bank_payout_paid: [
    'Bank payout marked paid',
    'Stripe reports this Connected Account bank payout as paid.',
  ],
  connected_bank_payout_failed: [
    'Bank payout failed',
    'Stripe reports that this Connected Account bank payout failed. Review Payments & Payouts.',
  ],
  connected_bank_payout_canceled: [
    'Bank payout canceled',
    'Stripe reports that this Connected Account bank payout was canceled.',
  ],
}

export function notificationCopy(type: string) {
  const [title, body] = copy[type] || [
    'Transaction update',
    'Open the app to review this update.',
  ]
  return { title, body }
}
