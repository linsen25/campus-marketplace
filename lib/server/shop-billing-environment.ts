import { ListingApiError } from '@/lib/listing-validation'
import { stripeConfiguration } from '@/lib/server/stripe-environment'

export type ShopBillingPlan = 'plus' | 'pro'

function shopBillingBaseConfiguration() {
  if (typeof window !== 'undefined')
    throw new Error('Server-only Shop Billing service.')
  const stripe = stripeConfiguration()
  const plusPriceId = process.env.STRIPE_SHOP_PLUS_PRICE_ID || ''
  const proPriceId = process.env.STRIPE_SHOP_PRO_PRICE_ID || ''
  if (
    !/^price_[A-Za-z0-9]+$/.test(plusPriceId) ||
    !/^price_[A-Za-z0-9]+$/.test(proPriceId) ||
    plusPriceId === proPriceId
  )
    throw new ListingApiError('Shop Billing checkout is unavailable.', 503)
  return {
    ...stripe,
    prices: { plus: plusPriceId, pro: proPriceId } as Record<
      ShopBillingPlan,
      string
    >,
  }
}

/** Separate from marketplace-payment flags; closed unless explicitly enabled. */
export function shopBillingCheckoutConfiguration() {
  if (process.env.SHOP_BILLING_CHECKOUT_ENABLED !== 'true')
    throw new ListingApiError('Shop Billing checkout is unavailable.', 503)
  return shopBillingBaseConfiguration()
}

export function shopBillingWebhookConfiguration() {
  if (process.env.SHOP_BILLING_WEBHOOK_ENABLED !== 'true')
    throw new ListingApiError('Shop Billing webhook is unavailable.', 503)
  const base = shopBillingBaseConfiguration()
  const webhookSecret = process.env.STRIPE_SHOP_BILLING_WEBHOOK_SECRET || ''
  if (!/^whsec_[A-Za-z0-9]+$/.test(webhookSecret))
    throw new ListingApiError('Shop Billing webhook is unavailable.', 503)
  return { ...base, webhookSecret }
}

/**
 * Phase 4B remains closed until Test Mode invoice reconciliation has passed
 * end-to-end. This guard is intentionally separate from Checkout and webhook
 * ingestion: receiving a signed event must never itself grant membership.
 */
export function shopBillingEntitlementSyncEnabled() {
  return process.env.SHOP_BILLING_ENTITLEMENT_SYNC_ENABLED === 'true'
}

export function shopBillingEntitlementSyncConfiguration() {
  if (!shopBillingEntitlementSyncEnabled())
    throw new ListingApiError(
      'Shop Billing entitlement sync is unavailable.',
      503
    )
  return shopBillingBaseConfiguration()
}

/** Paid-invoice proof collection is independently staged and Test-only. */
export function shopBillingInvoiceReconciliationEnabled() {
  return process.env.SHOP_BILLING_INVOICE_RECONCILIATION_ENABLED === 'true'
}

export function shopBillingInvoiceReconciliationConfiguration() {
  if (!shopBillingInvoiceReconciliationEnabled())
    throw new ListingApiError(
      'Shop Billing invoice reconciliation is unavailable.',
      503
    )
  return shopBillingWebhookConfiguration()
}

/**
 * Reversal collection is intentionally independent from paid-invoice proof
 * collection and from any future entitlement-revocation adapter.
 */
export function shopBillingReversalReconciliationEnabled() {
  return process.env.SHOP_BILLING_REVERSAL_RECONCILIATION_ENABLED === 'true'
}

export function shopBillingReversalReconciliationConfiguration() {
  if (!shopBillingReversalReconciliationEnabled())
    throw new ListingApiError(
      'Shop Billing reversal reconciliation is unavailable.',
      503
    )
  return shopBillingWebhookConfiguration()
}

/**
 * Separate from reversal fact collection. Both this and the existing paid
 * entitlement gate must be explicitly enabled before a reversal can revoke a
 * Provider Term.
 */
export function shopBillingReversalEntitlementSyncEnabled() {
  return (
    shopBillingEntitlementSyncEnabled() &&
    process.env.SHOP_BILLING_REVERSAL_ENTITLEMENT_SYNC_ENABLED === 'true'
  )
}

export function shopBillingReversalEntitlementSyncConfiguration() {
  if (!shopBillingReversalEntitlementSyncEnabled())
    throw new ListingApiError(
      'Shop Billing reversal entitlement synchronization is unavailable.',
      503
    )
  return shopBillingBaseConfiguration()
}

/**
 * Complex reversal review is evidence-only. It is separate from both the
 * full-refund revocation gate and paid-entitlement synchronization.
 */
export function shopBillingReversalReviewEnabled() {
  return process.env.SHOP_BILLING_REVERSAL_REVIEW_ENABLED === 'true'
}

export function shopBillingReversalReviewConfiguration() {
  if (!shopBillingReversalReviewEnabled())
    throw new ListingApiError(
      'Shop Billing reversal review is unavailable.',
      503
    )
  return shopBillingBaseConfiguration()
}

/**
 * Governance records are deliberately a stricter, separately staged gate.
 * A true staff identity source is not configured yet, so this only enables
 * the server-side configuration check; the governance adapter still fails
 * closed until that source exists.
 */
export function shopBillingReversalGovernanceEnabled() {
  return (
    shopBillingReversalReconciliationEnabled() &&
    shopBillingReversalReviewEnabled() &&
    process.env.SHOP_BILLING_REVERSAL_GOVERNANCE_ENABLED === 'true'
  )
}

export function shopBillingReversalGovernanceConfiguration() {
  if (!shopBillingReversalGovernanceEnabled())
    throw new ListingApiError(
      'Shop Billing reversal governance is unavailable.',
      503
    )
  return shopBillingBaseConfiguration()
}
