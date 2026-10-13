import { ListingApiError } from '@/lib/listing-validation'

export const sellerPayoutNotReady = 'seller_payout_not_ready'
export class SellerPayoutNotReadyError extends ListingApiError {
  constructor(artifact: 'Offer' | 'Order Request' = 'Order Request') {
    super(
      `Seller payout setup is not ready yet. This ${artifact} cannot proceed right now. The seller needs to update their payout account first.`,
      409
    )
  }
  readonly code = sellerPayoutNotReady
}
