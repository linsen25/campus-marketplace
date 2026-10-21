import { marketplaceRequest } from '@/lib/listings-api'
import type { FormalOrder, FormalOrders } from '@/types/order'

export type PaymentConfirmation = {
  orderId: string
  attemptId: string
  paymentIntentId: string
} & (
  | { clientSecret: string; nextAction: 'confirm' }
  | { nextAction: 'reconcile' }
)

export const getOrders = (workspace: 'purchases' | 'sales') =>
  marketplaceRequest<FormalOrders>(`/api/orders?workspace=${workspace}`, 'GET')

export const cancelOrder = (
  id: string,
  reason: string,
  note: string,
  clientActionId: string
) =>
  marketplaceRequest<{ order: FormalOrder; serverTime: string }>(
    `/api/orders/${encodeURIComponent(id)}/cancel`,
    'POST',
    { reason, note, clientActionId }
  )

export const mutateOrderMeetup = (
  id: string,
  action: 'confirm' | 'decline' | 'propose' | 'withdraw',
  revisionId: string | null,
  body: Record<string, unknown>
) =>
  marketplaceRequest<{ order: FormalOrder; serverTime: string }>(
    `/api/orders/${encodeURIComponent(id)}/meetup/proposals${
      action === 'propose'
        ? ''
        : `/${encodeURIComponent(revisionId || '')}/${action}`
    }`,
    'POST',
    body
  )

export const mutateCampusOrder = (
  id: string,
  action: 'inspection' | 'payment',
  clientActionId: string
) =>
  marketplaceRequest<{
    order: FormalOrder
    serverTime: string
    paymentConfirmation?: PaymentConfirmation
  }>(
    `/api/orders/${encodeURIComponent(id)}/${action}/${
      action === 'inspection' ? 'confirm' : 'start'
    }`,
    'POST',
    { clientActionId }
  )
