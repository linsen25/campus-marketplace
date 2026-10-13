import type { FormalOrder } from '@/types/order'

export function orderPaymentRole(order: FormalOrder, userId: string) {
  if (userId === order.buyerId) return 'buyer'
  if (userId === order.sellerId) return 'seller'
  return null
}

export function stagingPaymentControl(order: FormalOrder, userId: string) {
  return (
    process.env.NEXT_PUBLIC_MESSAGES_ENV === 'staging' &&
    process.env.NEXT_PUBLIC_SUPABASE_URL ===
      'https://pcaqxezdfxofysghssyo.supabase.co' &&
    orderPaymentRole(order, userId) === 'buyer' &&
    order.paymentStatus === 'pending' &&
    order.lifecycle === 'open' &&
    order.moneyStatus === 'finalized' &&
    order.holdsListing &&
    Boolean(order.reservationExpiresAt) &&
    order.totalAmount !== null
  )
}
