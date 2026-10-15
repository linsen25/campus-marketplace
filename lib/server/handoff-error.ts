import { handoffMessages } from '@/lib/handoff'
import type { HandoffErrorCode } from '@/lib/handoff'
import { ListingApiError } from '@/lib/listing-validation'

export class HandoffApiError extends ListingApiError {
  constructor(
    public errorCode: HandoffErrorCode,
    status: number,
    public retryAt?: string
  ) {
    super(handoffMessages[errorCode], status)
  }
}

/** Only map known RPC rejections; never forward SQL messages or credential inputs. */
export function handoffRpcError(error: { code?: string; message?: string }) {
  if (error.code === '42501')
    return new HandoffApiError('handoff_unauthorized', 403)
  if (error.message === 'Cancellation or Case holds this transaction.')
    return new HandoffApiError('handoff_held', 409)
  if (error.message === 'Valid verification channel and command required.')
    return new HandoffApiError('invalid_handoff_credential', 400)
  if (!['23505', '23514', '22P02', '22003'].includes(error.code || ''))
    return new ListingApiError(
      'Unable to verify handoff. Refresh the Order before retrying.',
      503
    )
  return new HandoffApiError(
    'handoff_not_ready',
    error.code === '23514' ? 400 : 409
  )
}
