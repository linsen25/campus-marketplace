import { ListingApiError } from '@/lib/listing-validation'
import { createTrustedFinancialClient } from '@/lib/server/financial-capabilities-service'
import { shopBillingReversalReviewConfiguration } from '@/lib/server/shop-billing-environment'

const unavailable = () =>
  new ListingApiError('Shop Billing reversal review is unavailable.', 503)
const terminal = () => Object.assign(unavailable(), { billingTerminal: true })

/**
 * Evidence-only Phase 4B-4C bridge. It cannot modify a Provider Term,
 * Membership, trial, grace, or entitlement.
 */
export async function registerShopBillingReversalReview(input: {
  reversalStateId: string
}) {
  shopBillingReversalReviewConfiguration()
  const { error } = await createTrustedFinancialClient().rpc(
    'marketplace_shop_billing_register_reversal_review',
    { p_reversal_state_id: input.reversalStateId }
  )
  if (!error) return
  if (['23514', '23505', '40001'].includes(error.code || '')) throw terminal()
  throw unavailable()
}
