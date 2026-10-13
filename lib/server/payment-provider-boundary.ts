// Contracts only. No provider selected, no real charges/refunds/payout execution.
export type FrozenOrderEconomics = {
  orderId: string
  currency: 'CAD'
  itemCents: number
  deliveryCents: number
  buyerServiceFeeCents: number
  buyerTotalCents: number
  sellerGrossCents: number
  sellerPlatformFeeCents: 0
}
export type ProviderAttempt = {
  attemptId: string
  providerReference: string
  providerIdempotencyKey: string
}
export interface PaymentProviderBoundary {
  createSession: (
    economics: FrozenOrderEconomics,
    attemptId: string,
    idempotencyKey: string
  ) => Promise<ProviderAttempt>
  verifyWebhook: (
    rawBody: Uint8Array,
    headers: Record<string, string>
  ) => Promise<{ eventId: string; providerReference: string; status: string }>
  reconcile: (
    attempt: ProviderAttempt
  ) => Promise<'Failed' | 'Paid' | 'Processing'>
  requestRefund: (
    attempt: ProviderAttempt,
    authorizedRefundId: string
  ) => Promise<{ providerReference: string }>
  executePayout: (
    completedOrderId: string,
    authorizedPayoutId: string
  ) => Promise<{ providerReference: string }>
  reconcilePayout: (providerReference: string) => Promise<string>
}
