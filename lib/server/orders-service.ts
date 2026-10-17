import { ListingApiError } from '@/lib/listing-validation'
import {
  SellerPayoutNotReadyError,
  sellerPayoutNotReady,
} from '@/lib/order-payout-error'
import {
  createTrustedFinancialClient,
  requireFinancialEnvironment,
} from '@/lib/server/financial-capabilities-service'
import { requireMarketplaceUser } from '@/lib/server/marketplace-auth'
import { messageUuid } from '@/lib/server/messages-environment'
import { mapTerms } from '@/lib/server/offers-service'
import {
  mapRequest,
  requireOrderRequestEnvironment,
} from '@/lib/server/order-request-service'
import { signOrderSnapshotMedia } from '@/lib/server/order-snapshot-media'
import { createMarketplaceClient } from '@/lib/supabase/server'
import type { MarketplaceContext } from '@/lib/supabase/server'
import type { FormalOrder, FormalOrders, MeetupRevision } from '@/types/order'

// The SQL row shape remains server-side. Only the bounded participant DTO is returned.
type OrderRow = {
  order_protocol_version?: 1 | 2
  listing_snapshot?: {
    listingChannel?: 'resale' | 'shop'
    shopName?: string
    title: string
    category: string
    subcategory: string
    condition: string
    description: string
    askingPriceCents: number
    materialHash: string
  }
  id: string
  request_id: string
  conversation_id: string
  listing_id: string
  buyer_id: string | null
  seller_id: string | null
  terms_snapshot: Parameters<typeof mapRequest>[0] & {
    terms?: Record<string, unknown>
    buyerName?: string
    sellerName?: string
  }
  lifecycle_status: FormalOrder['lifecycle']
  holds_listing: boolean
  money_status: FormalOrder['moneyStatus']
  payment_status: FormalOrder['paymentStatus']
  payment_paid_at: string | null
  payout_status: FormalOrder['payoutStatus']
  fulfillment_status: FormalOrder['fulfillmentStatus']
  item_amount_cents: number
  shipping_amount_cents: number | null
  service_fee_amount_cents: number | null
  total_amount_cents: number | null
  created_at: string
  accepted_at?: string | null
  expired_at?: string | null
  reservation_started_at: string | null
  reservation_expires_at: string | null
  cancelled_at?: string | null
  cancelled_by_role?: 'buyer' | 'seller'
  cancel_reason_code?: string
  cancel_reason_label_snapshot?: string
  cancel_note?: string
}
function mapListingProvenance(
  row: OrderRow
): NonNullable<FormalOrder['listingProvenance']> {
  if (
    row.order_protocol_version !== 2 ||
    row.listing_snapshot?.listingChannel !== 'shop'
  )
    return { channel: 'resale' }
  const shopName = row.listing_snapshot.shopName
  if (!shopName?.trim())
    throw new ListingApiError('Order provenance unavailable.', 503)
  return { channel: 'shop', shopName }
}
export function mapOrder(row: OrderRow): FormalOrder {
  return {
    listingProvenance: mapListingProvenance(row),
    id: row.id,
    requestId: row.request_id,
    conversationId: row.conversation_id,
    listingId: row.listing_id,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    protocolVersion: row.order_protocol_version || 1,
    ...(row.order_protocol_version === 2
      ? {
          v2: {
            terms: mapTerms({
              item_amount_cents: row.item_amount_cents,
              offer_terms: row.terms_snapshot.terms || null,
            }),
            condition: row.listing_snapshot!.condition,
            description: row.listing_snapshot!.description,
            subcategory: row.listing_snapshot!.subcategory,
            askingPriceCents: Number(row.listing_snapshot!.askingPriceCents),
            materialHash: row.listing_snapshot!.materialHash,
          },
        }
      : {}),
    snapshot:
      row.order_protocol_version === 2
        ? {
            buyerId: row.buyer_id || undefined,
            sellerId: row.seller_id || undefined,
            buyer: row.terms_snapshot.buyerName || 'Buyer',
            seller: row.terms_snapshot.sellerName || 'Seller',
            listing: {
              id: row.listing_id,
              liveId: row.listing_id,
              title: row.listing_snapshot!.title,
              price: Number(row.listing_snapshot!.askingPriceCents),
              currency: 'CAD',
              category: row.listing_snapshot!.category,
              availability: 'unavailable',
              photoUrls: [],
            },
            // Compatibility layout DTO only. V2 UI renders v2.terms; never feeds this draft to V1 actions.
            draft: {
              price: Number(row.item_amount_cents),
              fulfillment: 'shipping',
              location: '',
              scheduleMode: 'tbd',
              shippingCost: 'included',
              shippingFee: null,
              shippingMethod: '',
              note: '',
            },
          }
        : mapRequest(row.terms_snapshot).snapshot,
    lifecycle: row.lifecycle_status,
    holdsListing: row.holds_listing,
    moneyStatus: row.money_status,
    paymentStatus: row.payment_status,
    paymentPaidAt: row.payment_paid_at,
    payoutStatus: row.payout_status,
    fulfillmentStatus: row.fulfillment_status,
    itemAmount: Number(row.item_amount_cents),
    shippingAmount:
      row.shipping_amount_cents === null
        ? null
        : Number(row.shipping_amount_cents),
    serviceFee:
      row.service_fee_amount_cents === null
        ? null
        : Number(row.service_fee_amount_cents),
    totalAmount:
      row.total_amount_cents === null ? null : Number(row.total_amount_cents),
    createdAt: row.created_at,
    acceptedAt: row.accepted_at || null,
    expiredAt: row.expired_at || null,
    reservationStartedAt: row.reservation_started_at,
    reservationExpiresAt: row.reservation_expires_at,
    cancellation: row.cancelled_at
      ? {
          at: row.cancelled_at,
          byRole: row.cancelled_by_role!,
          reasonCode: row.cancel_reason_code!,
          reason: row.cancel_reason_label_snapshot!,
          note: row.cancel_note || '',
        }
      : null,
  }
}
export function createOrdersService(context: MarketplaceContext) {
  requireOrderRequestEnvironment()
  const client = createMarketplaceClient(context)
  async function call(name: string, params: Record<string, unknown>) {
    await requireMarketplaceUser(client)
    const { data, error } = await client.rpc(name, params)
    if (error) {
      if (error.code === 'P0001' && error.message === sellerPayoutNotReady)
        throw new SellerPayoutNotReadyError()
      const statuses: Record<string, number> = {
        '42501': 403,
        '23505': 409,
        '23514': 400,
        '22P02': 400,
      }
      const messages: Record<number, string> = {
        403: 'Order not accessible.',
        409: 'Request or inventory changed. Refresh and review the current state.',
      }
      const status =
        name === 'marketplace_order_meetup_action' &&
        ['22007', '22008'].includes(error.code)
          ? 400
          : statuses[error.code] || 503
      const message = messages[status] || 'Unable to complete Order operation.'
      throw new ListingApiError(message, status)
    }
    return data
  }
  async function present(row: OrderRow) {
    const order = mapOrder(row)
    if (order.protocolVersion === 2) {
      const money = await call('marketplace_order_economics', {
        p_order_id: order.id,
      })
      order.economics = {
        itemCents: Number(money.item),
        deliveryCents: Number(money.delivery),
        buyerServiceFeeCents: Number(money.fee),
        buyerTotalCents: Number(money.total),
        sellerPlatformFeeCents: 0,
        sellerGrossCents: Number(money.sellerGross),
        feeRule: String(money.feeRule),
      }
      const media = await signOrderSnapshotMedia(client, order.id)
      order.snapshot.listing.photoUrls = media.map(
        (image: { previewUrl: string }) => image.previewUrl
      )
    }
    if (order.v2?.terms.fulfillment === 'on_campus') {
      const history = await call('marketplace_order_meetup_history', {
        p_order_id: order.id,
      })
      const payment = await call('marketplace_campus_payment_state', {
        p_order_id: order.id,
      })
      order.campusPayment = {
        inspectionConfirmedAt: payment.inspectionConfirmedAt || null,
        itemCents: Number(payment.itemCents),
        feeCents: Number(payment.feeCents),
        totalCents: Number(payment.totalCents),
        feeRule: String(payment.feeRule),
      }
      order.meetup = {
        mutable: history.mutable === true,
        revisions: history.revisions.map(
          (r: Record<string, unknown>): MeetupRevision => ({
            id: String(r.id),
            revision: Number(r.revision),
            baseConfirmedId: r.base_confirmed_id
              ? String(r.base_confirmed_id)
              : null,
            location: String(r.location),
            scheduledAt: String(r.scheduled_at),
            note: String(r.note),
            status: r.status as MeetupRevision['status'],
            proposerRole: r.proposer_role as MeetupRevision['proposerRole'],
            deciderRole: r.decider_role as MeetupRevision['deciderRole'],
            proposedAt: String(r.proposed_at),
            decidedAt: r.decided_at ? String(r.decided_at) : null,
          })
        ),
      }
    }
    return order
  }
  return {
    async campusAction(
      id: unknown,
      action: 'inspection' | 'payment',
      body: Record<string, unknown>
    ) {
      requireFinancialEnvironment()
      if (
        action === 'payment' &&
        process.env.STRIPE_PROVIDER_ENABLED === 'true'
      )
        throw new ListingApiError(
          'Order payments are not enabled in this Stripe setup phase.',
          503
        )
      if (Object.keys(body).some((key) => key !== 'clientActionId'))
        throw new ListingApiError('Unexpected payment fields.')
      const orderId = messageUuid(id)
      // Check trusted service availability before starting a protected attempt.
      const trusted =
        action === 'payment' ? createTrustedFinancialClient() : null
      const data = await call(
        action === 'inspection'
          ? 'marketplace_confirm_campus_inspection'
          : 'marketplace_start_campus_payment',
        {
          p_order_id: orderId,
          p_client_action_id: messageUuid(body.clientActionId),
        }
      )
      if (data.errorCode)
        throw new ListingApiError(
          'Review your payment method in Payments Settings before paying.',
          409
        )
      if (trusted && data.status === 'processing') {
        // Outcome is selected by the trusted staging simulator, never the client body.
        const result = await trusted.rpc('marketplace_resolve_campus_payment', {
          p_attempt_id: data.attemptId,
          p_success: true,
        })
        if (result.error)
          throw new ListingApiError(
            'Payment is processing. Refresh to review its authoritative state.',
            503
          )
      }
      const current = await call('marketplace_order_detail', {
        p_order_id: orderId,
      })
      return {
        order: await present(current.order),
        serverTime: current.serverTime,
      }
    },
    async meetupAction(
      id: unknown,
      action: string,
      revision: unknown,
      body: Record<string, unknown>
    ) {
      const keys =
        action === 'propose'
          ? ['clientActionId', 'location', 'scheduledAt', 'note']
          : ['clientActionId']
      if (
        Object.keys(body).some((key) => !keys.includes(key)) ||
        (action === 'propose' &&
          [body.location, body.scheduledAt, body.note].some(
            (value) => typeof value !== 'string'
          ))
      )
        throw new ListingApiError('Unexpected meetup fields.')
      const orderId = messageUuid(id)
      await call('marketplace_order_meetup_action', {
        p_order_id: orderId,
        p_action: action,
        p_revision_id: action === 'propose' ? null : messageUuid(revision),
        p_terms:
          action === 'propose'
            ? {
                location: body.location,
                scheduled_at: body.scheduledAt,
                note: body.note,
              }
            : null,
        p_client_action_id: messageUuid(body.clientActionId),
      })
      const current = await call('marketplace_order_detail', {
        p_order_id: orderId,
      })
      return {
        order: await present(current.order),
        serverTime: current.serverTime,
      }
    },
    async cancel(id: unknown, body: Record<string, unknown>) {
      if (typeof body.reason !== 'string' || typeof body.note !== 'string')
        throw new ListingApiError('Choose a cancellation reason and note.')
      const data = await call('marketplace_cancel_order', {
        p_order_id: messageUuid(id),
        p_reason: body.reason,
        p_note: body.note,
        p_client_action_id: messageUuid(body.clientActionId),
      })
      if (data.errorCode)
        throw new ListingApiError(
          'Order is no longer cancellable. Refresh to review its current state.',
          409
        )
      return { order: await present(data.order), serverTime: data.serverTime }
    },
    async workspace(value: unknown): Promise<FormalOrders> {
      if (value !== 'purchases' && value !== 'sales')
        throw new ListingApiError('Choose Purchases or Sales.')
      const data = await call('marketplace_order_workspace', {
        p_workspace: value,
      })
      return {
        serverTime: data.serverTime,
        orders: await Promise.all(data.orders.map(present)),
      }
    },
    async detail(id: unknown) {
      const data = await call('marketplace_order_detail', {
        p_order_id: messageUuid(id),
      })
      return { order: await present(data.order), serverTime: data.serverTime }
    },
    async accept(id: unknown, body: Record<string, unknown>) {
      const data = await call('marketplace_accept_order_request', {
        p_request_id: messageUuid(id),
        p_client_action_id: messageUuid(body.clientActionId),
      })
      const current = await call('marketplace_order_detail', {
        p_order_id: data.id,
      })
      return { order: mapOrder(current.order), serverTime: current.serverTime }
    },
  }
}
