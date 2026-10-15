/** Public, sanitized error vocabulary for the existing handoff operation only. */
export const handoffMessages = {
  qr_expired: 'This QR code has expired. Ask the Buyer to generate a new one.',
  invalid_handoff_credential:
    'That handoff credential does not match this Order. Try again.',
  numeric_temporarily_locked:
    'Numeric verification is temporarily locked. You can still scan the QR.',
  handoff_already_redeemed:
    'Handoff was already confirmed. Refreshing the Order.',
  handoff_unauthorized:
    'Only the authenticated Seller for this Order can verify handoff.',
  handoff_not_ready:
    'Handoff is not available at the current Order stage. Refresh the Order.',
  handoff_held:
    'Cancellation or Case review is holding this transaction. Handoff cannot proceed.',
} as const

export type HandoffErrorCode = keyof typeof handoffMessages

export class HandoffError extends Error {
  constructor(public code: HandoffErrorCode, public retryAt?: string) {
    super(handoffMessages[code])
    this.name = 'HandoffError'
  }
}

export const validHandoffQr = (value: string) => /^[0-9a-f]{64}$/.test(value)
