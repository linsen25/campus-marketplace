import { configuredUuProjectRef } from '@/lib/marketplace-test-environment'

/** Additive preference is enabled only for an exact approved test project. */
export function listingFulfillmentEnabled() {
  return configuredUuProjectRef(process.env.NEXT_PUBLIC_MESSAGES_ENV) !== null
}
