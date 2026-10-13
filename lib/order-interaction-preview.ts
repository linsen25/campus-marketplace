import { isRequestScheduleAvailable } from './order-schedule-preview'
import type { OrderDetailVisual } from './order-visual-preview'

/** In-memory UX simulation only. Never an API/database contract or authorization. */
export type PreviewRole = 'buyer' | 'seller'
export type PreviewAddress = {
  recipient: string
  address: string
  unit: string
  city: string
  province: string
  postal: string
}
export type PreviewCancellation = Readonly<{
  cancelledBy: PreviewRole
  cancelReason: string
  cancelNote: string
  cancelledAt: string
}>
export type PreviewConversationEvent = {
  actorId?: string
  id: string
  conversationId: string
  createdAt: string
  kind:
    | 'order-cancelled'
    | 'request-cancelled'
    | 'request-expired'
    | 'request-replaced'
  requestId: string
  orderId?: string
  cancellation?: PreviewCancellation
}
export type PreviewRequest = {
  lifecycle?: Readonly<{ replacedAt?: string; expiredAt?: string }>
  cancellation?: PreviewCancellation
  readonly createdAt: string
  id: string
  conversationId: string
  status: 'accepted' | 'active' | 'cancelled' | 'expired' | 'superseded'
  snapshot: OrderDetailVisual
}
export type PreviewOrder = {
  cancellation?: PreviewCancellation
  buyerId?: string
  sellerId?: string
  id: string
  requestId: string
  snapshot: OrderDetailVisual
  status:
    | 'cancelled'
    | 'completed'
    | 'delivered'
    | 'expired'
    | 'paid'
    | 'protection'
    | 'reserved'
    | 'shipped'
  expiresAt: number
  protectionEndsAt?: number
  address?: PreviewAddress
  carrier?: string
  tracking?: string
  handoffCode?: string
  issue?: { role: PreviewRole; reason: string; detail: string }
}
export type InteractionPreviewState = {
  events?: PreviewConversationEvent[]
  requests: PreviewRequest[]
  orders: PreviewOrder[]
}
export type PreviewOrderEvent =
  | { type: 'address'; address: PreviewAddress }
  | { type: 'advance-protection' }
  | { type: 'cancel'; reason: string; note?: string }
  | { type: 'deliver' }
  | { type: 'expire' }
  | { type: 'issue'; reason: string; detail: string }
  | { type: 'pay' }
  | { type: 'receive' }
  | { type: 'reveal-code'; code: string }
  | { type: 'ship'; carrier: string; tracking: string }
  | { type: 'verify-code'; code: string }

export const emptyInteractionPreview: InteractionPreviewState = {
  requests: [],
  orders: [],
}
export function isStagingOrderPreview(
  environment: string | undefined,
  url: string | undefined
) {
  return (
    environment === 'staging' &&
    url === 'https://pcaqxezdfxofysghssyo.supabase.co'
  )
}
export function parsePreviewCurrency(value: string, allowZero = false) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null
  const cents = Math.round(Number(value) * 100)
  return Number.isSafeInteger(cents) &&
    cents <= 100000000 &&
    (allowZero ? cents >= 0 : cents > 0)
    ? cents
    : null
}
export function validPreviewAddress(address: PreviewAddress) {
  return (
    ['recipient', 'address', 'city', 'province'].every(
      (key) => address[key as keyof PreviewAddress].trim().length > 0
    ) && /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i.test(address.postal.trim())
  )
}
function freezeSnapshot<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeSnapshot)
    Object.freeze(value)
  }
  return value
}
export type PreviewRequestScope = {
  conversationId: string
  listingId: string
  buyerId?: string
  sellerId?: string
}
export const unfinishedRequestMessage =
  'An order is already in progress for this buyer and listing.'
export function previewRequestScope(
  conversationId: string,
  snapshot: Pick<OrderDetailVisual, 'buyerId' | 'listing' | 'sellerId'>
): PreviewRequestScope {
  return {
    conversationId,
    listingId: snapshot.listing.id,
    buyerId: snapshot.buyerId,
    sellerId: snapshot.sellerId,
  }
}
function sameRequestScope(a: PreviewRequestScope, b: PreviewRequestScope) {
  if (a.listingId !== b.listingId) return false
  if (a.buyerId && a.sellerId && b.buyerId && b.sellerId)
    return a.buyerId === b.buyerId && a.sellerId === b.sellerId
  // A real conversation's immutable identity is Buyer + Seller + original Listing.
  return a.conversationId === b.conversationId
}
export function expirePreviewRequests(
  state: InteractionPreviewState,
  now: number
) {
  let changed = false
  const requests = state.requests.map((request) => {
    if (
      request.status !== 'active' ||
      isRequestScheduleAvailable(request.snapshot.draft, new Date(now))
    )
      return request
    changed = true
    return { ...request, status: 'expired' as const }
  })
  return changed ? { ...state, requests } : state
}
export function getPreviewRequestSendGate(
  state: InteractionPreviewState,
  scope: PreviewRequestScope,
  now: number
) {
  const blocked = state.orders.some((order) => {
    if (['cancelled', 'completed', 'expired'].includes(order.status))
      return false
    const request = state.requests.find((value) => value.id === order.requestId)
    if (!request || order.snapshot.listing.id !== scope.listingId) return false
    if (order.snapshot.buyerId && scope.buyerId)
      return order.snapshot.buyerId === scope.buyerId
    return request.conversationId === scope.conversationId
  })
  const active = state.requests.find(
    (request) =>
      request.status === 'active' &&
      isRequestScheduleAvailable(request.snapshot.draft, new Date(now)) &&
      sameRequestScope(
        previewRequestScope(request.conversationId, request.snapshot),
        scope
      )
  )
  return { blocked, active: active || null }
}
export function addPreviewRequest(
  state: InteractionPreviewState,
  id: string,
  conversationId: string,
  visual: OrderDetailVisual,
  options: { createdAt?: string; replaceRequestId?: string } = {}
) {
  const { createdAt = new Date().toISOString(), replaceRequestId } = options
  if (state.requests.some((request) => request.id === id)) return state
  const now = Date.parse(createdAt)
  const current = expirePreviewRequests(state, now)
  const gate = getPreviewRequestSendGate(
    current,
    previewRequestScope(conversationId, visual),
    now
  )
  if (gate.blocked || (gate.active?.id || undefined) !== replaceRequestId)
    return current
  // Clone before freezing: never freeze a live Marketplace object or later editor draft.
  const snapshot = freezeSnapshot(
    JSON.parse(JSON.stringify(visual)) as OrderDetailVisual
  )
  return {
    ...current,
    requests: [
      ...current.requests.map((request) =>
        request.id === replaceRequestId && request.status === 'active'
          ? { ...request, status: 'superseded' as const }
          : request
      ),
      { id, conversationId, createdAt, status: 'active' as const, snapshot },
    ],
  }
}
export function cancelPreviewRequest(
  state: InteractionPreviewState,
  requestId: string,
  input: { role: PreviewRole; reason: string; note?: string; now: number }
) {
  const request = state.requests.find((value) => value.id === requestId)
  if (
    input.role !== 'seller' ||
    !request ||
    request.status !== 'active' ||
    !input.reason.trim() ||
    !isRequestScheduleAvailable(request.snapshot.draft, new Date(input.now))
  )
    return state
  const cancellation = Object.freeze({
    cancelledBy: input.role,
    cancelReason: input.reason.trim(),
    cancelNote: input.note?.trim() || '',
    cancelledAt: new Date(input.now).toISOString(),
  })
  return {
    ...state,
    requests: state.requests.map((value) =>
      value.id === requestId
        ? { ...value, cancellation, status: 'cancelled' as const }
        : value
    ),
    events: [
      ...(state.events || []),
      {
        id: `request-cancelled:${requestId}`,
        kind: 'request-cancelled' as const,
        requestId,
        conversationId: request.conversationId,
        createdAt: cancellation.cancelledAt,
        cancellation,
      },
    ],
  }
}
export function canCancelPreviewOrder(order: PreviewOrder, now: number) {
  return order.status === 'reserved' && now < order.expiresAt
}
export function acceptPreviewRequest(
  state: InteractionPreviewState,
  requestId: string,
  orderId: string,
  now: number
) {
  const request = state.requests.find((value) => value.id === requestId)
  if (
    !request ||
    request.status !== 'active' ||
    !isRequestScheduleAvailable(request.snapshot.draft, new Date(now)) ||
    state.orders.some((order) => order.requestId === requestId) ||
    getPreviewRequestSendGate(
      state,
      previewRequestScope(request.conversationId, request.snapshot),
      now
    ).blocked
  )
    return state
  return {
    ...state,
    requests: state.requests.map((value) =>
      value.id === requestId ? { ...value, status: 'accepted' as const } : value
    ),
    orders: [
      ...state.orders,
      {
        id: orderId,
        requestId,
        snapshot: request.snapshot,
        status: 'reserved' as const,
        expiresAt: now + 30 * 60 * 1000,
      },
    ],
  }
}

// Perspective checks preserve intended UI boundaries, not real permissions/security.
// eslint-disable-next-line complexity -- Explicit local event/state guards stay together so invalid UX transitions are auditable and tested.
export function transitionPreviewOrder(
  order: PreviewOrder,
  event: PreviewOrderEvent,
  role: PreviewRole,
  now: number
): PreviewOrder {
  if (
    event.type === 'expire' &&
    order.status === 'reserved' &&
    now >= order.expiresAt
  )
    return { ...order, status: 'expired' }
  if (order.status === 'reserved' && now >= order.expiresAt) return order
  const shipping = order.snapshot.draft.fulfillment === 'shipping'
  switch (event.type) {
    case 'address':
      return role === 'buyer' &&
        shipping &&
        order.status === 'reserved' &&
        validPreviewAddress(event.address)
        ? { ...order, address: { ...event.address } }
        : order
    case 'pay':
      return role === 'buyer' &&
        order.status === 'reserved' &&
        (!shipping || order.snapshot.draft.shippingCost !== 'arranged') &&
        (!shipping || Boolean(order.address))
        ? { ...order, status: 'paid' }
        : order
    case 'cancel':
      return canCancelPreviewOrder(order, now) && event.reason.trim()
        ? {
            ...order,
            status: 'cancelled',
            cancellation: Object.freeze({
              cancelledBy: role,
              cancelReason: event.reason.trim(),
              cancelNote: event.note?.trim() || '',
              cancelledAt: new Date(now).toISOString(),
            }),
          }
        : order
    case 'reveal-code':
      return role === 'buyer' &&
        !shipping &&
        order.status === 'paid' &&
        !order.handoffCode &&
        /^\d{6}$/.test(event.code)
        ? { ...order, handoffCode: event.code }
        : order
    case 'verify-code':
      return role === 'seller' &&
        !shipping &&
        order.status === 'paid' &&
        Boolean(order.handoffCode) &&
        event.code === order.handoffCode
        ? {
            ...order,
            status: 'protection',
            protectionEndsAt: now + 24 * 60 * 60 * 1000,
          }
        : order
    case 'ship':
      return role === 'seller' &&
        shipping &&
        order.status === 'paid' &&
        event.carrier.trim() &&
        event.tracking.trim()
        ? {
            ...order,
            status: 'shipped',
            carrier: event.carrier.trim(),
            tracking: event.tracking.trim(),
          }
        : order
    case 'deliver':
      return shipping && order.status === 'shipped'
        ? { ...order, status: 'delivered' }
        : order
    case 'receive':
      return role === 'buyer' && shipping && order.status === 'delivered'
        ? {
            ...order,
            status: 'protection',
            protectionEndsAt: now + 24 * 60 * 60 * 1000,
          }
        : order
    case 'issue':
      return ['paid', 'shipped', 'delivered', 'protection'].includes(
        order.status
      ) && event.reason.trim()
        ? {
            ...order,
            issue: {
              role,
              reason: event.reason.trim(),
              detail: event.detail.trim(),
            },
          }
        : order
    case 'advance-protection':
      return order.status === 'protection' && !order.issue
        ? { ...order, status: 'completed' }
        : order
    default:
      return order
  }
}
export function updatePreviewOrder(
  state: InteractionPreviewState,
  id: string,
  event: PreviewOrderEvent,
  role: PreviewRole,
  now: number
) {
  const orders = state.orders.map((order) =>
    order.id === id ? transitionPreviewOrder(order, event, role, now) : order
  )
  const before = state.orders.find((order) => order.id === id)
  const after = orders.find((order) => order.id === id)
  const request = state.requests.find((value) => value.id === after?.requestId)
  if (
    before?.status === 'reserved' &&
    after?.status === 'cancelled' &&
    after.cancellation &&
    request
  ) {
    return {
      ...state,
      orders,
      events: [
        ...(state.events || []),
        {
          id: `order-cancelled:${id}`,
          kind: 'order-cancelled' as const,
          orderId: id,
          requestId: request.id,
          conversationId: request.conversationId,
          createdAt: after.cancellation.cancelledAt,
          cancellation: after.cancellation,
        },
      ],
    }
  }
  return { ...state, orders, requests: state.requests }
}
export const previewOrderStatus = {
  reserved: 'Reserved / Payment pending',
  paid: 'Paid / Awaiting fulfillment',
  shipped: 'Shipped',
  delivered: 'Delivered',
  protection: 'Handoff confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  expired: 'Reservation expired',
}
export function previewStatusLabel(order: PreviewOrder, role: PreviewRole) {
  if (
    order.status === 'paid' &&
    role === 'seller' &&
    order.snapshot.draft.fulfillment === 'shipping'
  )
    return 'Paid · Ready to ship'
  if (
    order.status === 'protection' &&
    order.snapshot.draft.fulfillment === 'shipping'
  )
    return 'Delivery confirmed'
  return previewOrderStatus[order.status]
}
export function previewProgress(order: PreviewOrder) {
  const shipping = order.snapshot.draft.fulfillment === 'shipping'
  if (order.status === 'completed') return shipping ? 5 : 4
  if (order.status === 'protection') return shipping ? 4 : 3
  if (order.status === 'delivered') return 4
  if (order.status === 'shipped') return 3
  return order.status === 'paid' ? 2 : 1
}
export function previewNextStep(order: PreviewOrder, role: PreviewRole) {
  const shipping = order.snapshot.draft.fulfillment === 'shipping'
  switch (order.status) {
    case 'reserved':
      if (shipping && order.snapshot.draft.shippingCost === 'arranged')
        return 'Shipping cost pending'
      if (role === 'seller') return 'Waiting for payment'
      return shipping && !order.address
        ? 'Add shipping address'
        : 'Review summary and complete payment'
    case 'paid':
      if (shipping)
        return role === 'seller'
          ? 'Ship the item'
          : 'Waiting for seller to ship'
      return role === 'buyer'
        ? 'Meet the seller and inspect the item'
        : 'Enter Handoff Code'
    case 'shipped':
      return 'Waiting for delivery'
    case 'delivered':
      return role === 'buyer'
        ? 'Confirm received'
        : 'Waiting for buyer confirmation'
    case 'protection':
      return role === 'buyer' ? 'Marketplace Protection' : 'Payout pending'
    case 'completed':
      return role === 'buyer' ? 'Purchase completed' : 'Sale completed'
    default:
      return 'Listing available again · Preview only'
  }
}
