import { ListingApiError } from '@/lib/listing-validation'
import {
  SellerPayoutNotReadyError,
  sellerPayoutNotReady,
} from '@/lib/order-payout-error'
import { requireMarketplaceUser } from '@/lib/server/marketplace-auth'
import { messageUuid } from '@/lib/server/messages-environment'
import { requireOrderRequestEnvironment } from '@/lib/server/order-request-service'
import { prepareOrderSnapshotMedia } from '@/lib/server/order-snapshot-media'
import { createMarketplaceClient } from '@/lib/supabase/server'
import type { MarketplaceContext } from '@/lib/supabase/server'
import type {
  Agreement,
  Offer,
  OfferStatus,
  OfferEvent,
  OfferTerms,
} from '@/types/offer'

type Row = {
  linked_order_id?: string | null
  accept_block_reason?: string | null
  id: string
  protocol_version: number
  conversation_id: string
  listing_id: string
  buyer_origin_id: string
  seller_origin_id: string
  sender_user_id: string
  recipient_user_id: string
  status: string
  created_at: string
  updated_at: string
  item_amount_cents: number
  listing_price_cents_snapshot: number
  currency: string
  seller_note: string | null
  offer_terms: Record<string, unknown> | null
  listing_updated_at_at_offer: string | null
  replacement_request_id: string | null
  replaced_at: string | null
  withdrawn_at: string | null
  withdrawn_by: string | null
  withdrawal_note: string | null
  can_withdraw?: boolean
  changed_fields?: string[]
  mutation_kind?: 'counter' | 'create' | 'revise'
}
function deliveryArea(value: unknown) {
  if (value === undefined) return undefined
  const area = value as Record<string, unknown>
  if (
    !area ||
    area.country_code !== 'CA' ||
    typeof area.province_code !== 'string' ||
    typeof area.city_label !== 'string' ||
    typeof area.postal_prefix !== 'string'
  )
    throw new ListingApiError('Invalid Delivery area.', 503)
  return {
    countryCode: 'CA' as const,
    provinceCode: area.province_code,
    cityLabel: area.city_label,
    postalPrefix: area.postal_prefix,
  }
}
export function mapTerms(
  row: Pick<Row, 'item_amount_cents' | 'offer_terms'>
): OfferTerms {
  const v = row.offer_terms
  if (
    !v ||
    !Number.isSafeInteger(v.item_amount_cents) ||
    Number(v.item_amount_cents) < 1 ||
    v.item_amount_cents !== Number(row.item_amount_cents) ||
    (v.note !== undefined && typeof v.note !== 'string')
  )
    throw new ListingApiError('Offer terms unavailable.', 503)
  const common = {
    itemAmountCents: Number(v.item_amount_cents),
    currency: 'CAD' as const,
    note: String(v.note || ''),
  }
  if (
    v.fulfillment === 'on_campus' &&
    typeof v.meetup_location === 'string' &&
    typeof v.scheduled_at === 'string' &&
    Number.isFinite(Date.parse(v.scheduled_at))
  )
    return {
      ...common,
      fulfillment: 'on_campus',
      meetupLocation: v.meetup_location,
      scheduledAt: v.scheduled_at,
    }
  if (
    v.fulfillment === 'delivery' &&
    Number.isSafeInteger(v.delivery_fee_cents) &&
    Number(v.delivery_fee_cents) >= 0 &&
    ['seller_delivery', 'courier'].includes(String(v.delivery_method))
  ) {
    const area = deliveryArea(v.delivery_area)
    return {
      ...common,
      fulfillment: 'delivery',
      deliveryFeeCents: Number(v.delivery_fee_cents),
      deliveryMethod: v.delivery_method as 'courier' | 'seller_delivery',
      ...(area && {
        deliveryArea: area,
      }),
    }
  }
  throw new ListingApiError('Invalid Offer terms.', 503)
}
export function mapOffer(row: Row, viewer: string): Offer {
  const statuses: Record<string, OfferStatus> = {
    active: 'Active',
    superseded: 'Replaced',
    accepted: 'Accepted',
    withdrawn: 'Withdrawn',
    expired: 'Expired',
    closed: 'Closed',
    declined: 'Declined',
  }
  if (
    row.protocol_version !== 2 ||
    !statuses[row.status] ||
    row.currency !== 'CAD' ||
    !Number.isSafeInteger(Number(row.item_amount_cents)) ||
    !Number.isSafeInteger(row.listing_price_cents_snapshot) ||
    row.listing_price_cents_snapshot < 0
  )
    throw new ListingApiError('Invalid Offer response.', 503)
  return {
    id: row.id,
    protocolVersion: 2,
    conversationId: row.conversation_id,
    listingId: row.listing_id,
    buyerId: row.buyer_origin_id,
    sellerId: row.seller_origin_id,
    senderId: row.sender_user_id,
    recipientId: row.recipient_user_id,
    status: statuses[row.status],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    terms: mapTerms(row),
    askingPriceCents: row.listing_price_cents_snapshot,
    listingUpdatedAtAtOffer: row.listing_updated_at_at_offer,
    linkedOrderId: row.linked_order_id || null,
    canAccept:
      row.status === 'active' &&
      row.recipient_user_id === viewer &&
      row.accept_block_reason === null,
    acceptBlockReason: row.accept_block_reason ?? null,
    replacementOfferId: row.replacement_request_id,
    replacedAt: row.replaced_at,
    withdrawnAt: row.withdrawn_at,
    withdrawnBy: row.withdrawn_by,
    withdrawalNote: row.withdrawal_note,
    canWithdraw:
      row.status === 'active' &&
      row.sender_user_id === viewer &&
      (row.can_withdraw ?? Date.now() < Date.parse(row.created_at) + 300000),
    changedFields: row.changed_fields ?? [],
    mutationKind: row.mutation_kind ?? 'create',
  }
}
function acceptError(reason: string) {
  if (reason === 'listing_changed')
    return 'Listing changed since this offer. Review the updated listing and send a new offer.'
  if (reason === 'asking_price_lower')
    return 'The current asking price is lower than this offer. Send a new offer.'
  return 'This offer or listing is no longer available. Refresh to review.'
}
export function createOffersService(context: MarketplaceContext) {
  requireOrderRequestEnvironment()
  const client = createMarketplaceClient(context)
  async function call(name: string, params: Record<string, unknown>) {
    const user = await requireMarketplaceUser(client)
    const { data, error } = await client.rpc(name, params)
    if (error) {
      if (error.code === 'P0001' && error.message === sellerPayoutNotReady)
        throw new SellerPayoutNotReadyError('Offer')
      let status = 503
      if (error.code === '42501') status = 403
      else if (error.code === '23505') status = 409
      else if (
        ['23514', '22P02', '22003', '22007', '22008'].includes(error.code || '')
      )
        status = 400
      const messages: Record<number, string> = {
        409: 'The proposal changed or the submission was already used. Refresh and review.',
        403: 'Offer not accessible for this account.',
        400: 'Check the Offer price and fulfillment terms.',
        503: 'Unable to load Offers. Please retry.',
      }
      throw new ListingApiError(
        ['listing_changed', 'asking_price_lower'].includes(error.message)
          ? acceptError(error.message)
          : messages[status],
        status
      )
    }
    return { data, viewer: user.id }
  }
  return {
    async context(listingId: unknown) {
      const { data } = await call('marketplace_listing_offer_context', {
        p_listing_id: messageUuid(listingId),
      })
      return data as {
        activeOfferId: string | null
        orderId: string | null
        hasHistory: boolean
        available: boolean
      }
    },
    async accept(id: unknown, body: Record<string, unknown>) {
      const offerId = messageUuid(id)
      const commandId = messageUuid(body.clientActionId)
      const preflight = await call('marketplace_offer_accept_preflight', {
        p_offer_id: offerId,
        p_client_action_id: commandId,
      })
      if (preflight.data.errorCode)
        throw new ListingApiError(acceptError(preflight.data.errorCode), 409)
      // Replay returns the original result before payout recheck/media work.
      if (preflight.data.orderId) {
        const { data } = await call('marketplace_order_detail', {
          p_order_id: preflight.data.orderId,
        })
        return {
          orderId: data.order.id,
          buyerId: data.order.buyer_id,
          sellerId: data.order.seller_id,
        }
      }
      const batch = await prepareOrderSnapshotMedia(client, offerId, commandId)
      const { data } = await call('marketplace_accept_offer', {
        p_offer_id: offerId,
        p_client_action_id: commandId,
        p_media_batch: batch.id,
      })
      return {
        orderId: data.id,
        buyerId: data.buyer_id,
        sellerId: data.seller_id,
      }
    },
    async history(conversationId: unknown) {
      const { data, viewer } = await call('marketplace_offer_history', {
        p_conversation_id: messageUuid(conversationId),
      })
      return {
        offers: data.offers.map((row: Row) => mapOffer(row, viewer)),
        agreements: (data.agreements || []).map(
          (value: {
            id: string
            offer_id: string
            created_at: string
            status: Agreement['status']
            listing_title: string
            buyer_id: string
            seller_id: string
            terms: Record<string, unknown>
          }): Agreement => ({
            id: value.id,
            offerId: value.offer_id,
            createdAt: value.created_at,
            status: value.status,
            listingTitle: value.listing_title,
            buyerId: value.buyer_id,
            sellerId: value.seller_id,
            terms: mapTerms({
              item_amount_cents: Number(value.terms.item_amount_cents),
              offer_terms: value.terms,
            }),
          })
        ),
        events: data.events.map(
          (event: {
            id: string
            request_id: string
            conversation_id: string
            actor_id: string | null
            actor_role: 'buyer' | 'seller' | 'system'
            event_type: OfferEvent['type']
            created_at: string
          }): OfferEvent => ({
            id: event.id,
            offerId: event.request_id,
            conversationId: event.conversation_id,
            actorId: event.actor_id,
            actorRole: event.actor_role,
            type: event.event_type,
            createdAt: event.created_at,
          })
        ),
      }
    },
    async mutate(
      action: 'create' | 'deny' | 'withdraw',
      id: unknown,
      body: Record<string, unknown>
    ) {
      const params =
        action === 'create'
          ? {
              p_conversation_id: messageUuid(body.conversationId),
              p_terms: body.terms,
              p_client_action_id: messageUuid(body.clientActionId),
              p_comparison_offer_id: body.comparisonOfferId
                ? messageUuid(body.comparisonOfferId)
                : null,
              p_kind: body.kind ?? 'create',
            }
          : {
              p_offer_id: messageUuid(id),
              p_client_action_id: messageUuid(body.clientActionId),
              ...(action === 'withdraw' ? { p_note: body.note ?? null } : {}),
            }
      const { data, viewer } = await call(
        `marketplace_${action === 'create' ? 'submit' : action}_offer`,
        params
      )
      return mapOffer(data, viewer)
    },
  }
}
