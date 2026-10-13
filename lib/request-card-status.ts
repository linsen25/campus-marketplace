import type { PreviewRequest } from '@/lib/order-interaction-preview'

const requestLabels = {
  active: 'Active',
  superseded: 'Replaced',
  cancelled: 'Cancelled',
  expired: 'Expired',
  accepted: 'Accepted',
}

const outcomes: Record<
  string,
  { outcome: string; primary: string; tone: string }
> = {
  expired: { outcome: 'Expired', primary: 'Order expired', tone: 'muted' },
  cancelled: {
    outcome: 'Cancelled',
    primary: 'Order cancelled',
    tone: 'destructive',
  },
  completed: { outcome: 'Completed', primary: 'Completed', tone: 'success' },
  refunded: { outcome: 'Refunded', primary: 'Refunded', tone: 'neutral' },
}

// Read-only presentation: never infer completion/expiry from a clock or viewer role.
// Completed is supported only when explicitly supplied by authoritative data.
export function requestCardStatus(
  status: PreviewRequest['status'],
  order?: { lifecycle: string; paymentStatus?: string }
) {
  if (status === 'accepted' && order) {
    const terminal =
      outcomes[order.lifecycle] || outcomes[order.paymentStatus || '']
    if (terminal) return { ...terminal, secondary: 'Request accepted' }
  }
  let tone = 'muted'
  if (status === 'active') tone = 'active'
  if (status === 'accepted') tone = 'success'
  return {
    primary: requestLabels[status],
    secondary: null,
    outcome: null,
    tone,
  }
}
