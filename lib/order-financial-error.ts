import { ListingApiError } from '@/lib/listing-validation'

export type OrderFinancialErrorCode =
  | 'buyer_payment_method_not_ready'
  | 'order_not_payment_ready'

export class OrderFinancialError extends ListingApiError {
  constructor(code: OrderFinancialErrorCode) {
    super(
      code === 'buyer_payment_method_not_ready'
        ? 'Set up a usable payment method before paying for this Order.'
        : 'This Order is not ready for payment. Refresh and review its current state.',
      409
    )
    this.code = code
  }
  readonly code: OrderFinancialErrorCode
}
