export type FinancialCapabilities = {
  paymentMethod: {
    status: 'needs_attention' | 'set' | 'unset'
    brand: string | null
    last4: string | null
  }
  payoutAccount: {
    status: 'needs_attention' | 'ready' | 'unset'
    institution: string | null
    last4: string | null
  }
}
