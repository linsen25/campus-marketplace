import { ListingApiError } from '@/lib/listing-validation'
import { requireMarketplaceUser } from '@/lib/server/marketplace-auth'
import { mapListing } from '@/lib/supabase/listing-mapper'
import type { ListingRow } from '@/lib/supabase/listing-mapper'
import type { MarketplaceContext } from '@/lib/supabase/server'
import { createMarketplaceClient } from '@/lib/supabase/server'
import type { Conversation } from '@/types/conversation'
import type { TextMessage } from '@/types/message'

const messagesProjects: Record<string, string> = {
  staging: 'pcaqxezdfxofysghssyo',
  production: 'yzvchumzyonegujucyqs',
}
export function requireMessagesEnvironment() {
  const designation = process.env.APP_ENV || ''
  const ref = Object.prototype.hasOwnProperty.call(
    messagesProjects,
    designation
  )
    ? messagesProjects[designation]
    : undefined
  let valid = false
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '')
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
    let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key)
    if (!publicKey && key.split('.').length === 3) {
      const claims = JSON.parse(
        Buffer.from(key.split('.')[1], 'base64url').toString()
      )
      publicKey = claims.role === 'anon' && claims.ref === ref
    }
    valid = Boolean(
      ref &&
        url.origin === `https://${ref}.supabase.co` &&
        url.pathname === '/' &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        publicKey
    )
  } catch {
    valid = false
  }
  if (!valid)
    throw new ListingApiError(
      'Messages environment configuration is unavailable.',
      503
    )
}
export function messageUuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  )
    throw new ListingApiError('A valid UUID is required.')
  return value
}
function checked(error: { code?: string } | null) {
  if (!error) return
  if (error.code === '42501')
    throw new ListingApiError(
      'Conversation not accessible or account not eligible.',
      403
    )
  if (error.code === '23505')
    throw new ListingApiError(
      'This submission ID was already used for different text.',
      409
    )
  if (['23514', '22P02', '22001', 'P0001'].includes(error.code || ''))
    throw new ListingApiError(
      'Message or listing did not pass validation. Contact another seller’s published available listing; send 1–2000 characters of text.'
    )
  throw new ListingApiError(
    'Messages is temporarily unavailable. Please retry.',
    503
  )
}
export function conversationCursor(cursor: string): { at: string; id: string } {
  let boundary: unknown
  try {
    boundary = JSON.parse(Buffer.from(cursor, 'base64url').toString())
  } catch {
    throw new ListingApiError('Invalid conversation cursor.')
  }
  if (!boundary || typeof boundary !== 'object' || Array.isArray(boundary))
    throw new ListingApiError('Invalid conversation cursor.')
  const values = boundary as { at?: unknown; id?: unknown }
  const id = messageUuid(values.id)
  if (
    typeof values.at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(values.at) ||
    !Number.isFinite(Date.parse(values.at))
  )
    throw new ListingApiError('Invalid activity cursor.')
  return { at: values.at, id }
}

type Row = {
  id: string
  buyer_id: string | null
  seller_id: string | null
  listing_id: string | null
  listing_origin_id: string
  listing_title_snapshot: string
  listing_price_cents_snapshot: number
  listing_currency_snapshot: 'CAD'
  listing_category_snapshot: string
  created_at: string
  last_message_at: string | null
  activity_at: string
  last_message_sequence: number
  buyer_last_read_sequence: number
  seller_last_read_sequence: number
}
type MessageRow = {
  id: string
  conversation_id: string
  sender_id: string
  type: 'TEXT'
  content: string
  created_at: string
  sequence: number
  client_message_id: string
}
function message(row: MessageRow): TextMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    type: 'TEXT',
    content: row.content,
    createdAt: row.created_at,
    sequence: Number(row.sequence),
    clientMessageId: row.client_message_id,
  }
}

export function createSupabaseMessagesRepository(context: MarketplaceContext) {
  requireMessagesEnvironment()
  const client = createMarketplaceClient(context)
  let authentication: ReturnType<typeof requireMarketplaceUser> | undefined
  const actor = () => {
    if (!authentication) authentication = requireMarketplaceUser(client)
    return authentication
  }
  async function liveListing(id: string) {
    const { data, error } = await client
      .from('listings')
      .select(
        '*,profiles!listings_seller_id_fkey(id,display_name),listing_images(path,slot,ready)'
      )
      .eq('id', id)
      .not('published_at', 'is', null)
      .maybeSingle()
    checked(error)
    return data
      ? mapListing(
          data as unknown as ListingRow,
          (path) =>
            client.storage.from('listing-images').getPublicUrl(path).data
              .publicUrl
        )
      : null
  }
  async function row(id: string) {
    await actor()
    const { data, error } = await client
      .from('conversations')
      .select('*')
      .eq('id', messageUuid(id))
      .maybeSingle()
    checked(error)
    if (!data) throw new ListingApiError('Conversation not found.', 404)
    return data as Row
  }
  async function dto(source: Row): Promise<Conversation> {
    const user = await actor()
    const role = source.buyer_id === user.id ? 'buying' : 'selling'
    const counterpart = role === 'buying' ? source.seller_id : source.buyer_id
    const watermark = Number(
      role === 'buying'
        ? source.buyer_last_read_sequence
        : source.seller_last_read_sequence
    )
    const [profile, latest, unread, live] = await Promise.all([
      counterpart
        ? client
            .from('profiles')
            .select('id,display_name')
            .eq('id', counterpart)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      client
        .from('messages')
        .select('content')
        .eq('conversation_id', source.id)
        .order('sequence', { ascending: false })
        .limit(1),
      client
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', source.id)
        .gt('sequence', watermark)
        .neq('sender_id', user.id),
      source.listing_id
        ? liveListing(source.listing_id)
        : Promise.resolve(null),
    ])
    checked(profile.error)
    checked(latest.error)
    checked(unread.error)
    return {
      id: source.id,
      role,
      person: {
        id: counterpart || 'former-member',
        name: profile.data?.display_name || 'Former member',
      },
      listing: {
        id: source.listing_origin_id,
        liveId: source.listing_id,
        title: source.listing_title_snapshot,
        price: Number(source.listing_price_cents_snapshot),
        currency: source.listing_currency_snapshot,
        category: source.listing_category_snapshot,
        photoUrls: live?.photoUrls || [],
        availability: !source.listing_id
          ? 'deleted'
          : live?.status || 'unavailable',
        ...(live ? { live } : {}),
      },
      lastMessage: latest.data?.[0]?.content || '',
      createdAt: source.created_at,
      lastMessageAt: source.last_message_at,
      activityAt: source.activity_at,
      lastMessageSequence: Number(source.last_message_sequence),
      lastReadSequence: watermark,
      unreadCount: unread.count || 0,
    }
  }
  return {
    authorize: actor,
    async list(role: string, cursor?: string) {
      if (!['buying', 'selling'].includes(role))
        throw new ListingApiError('Choose Buying or Selling.')
      const user = await actor()
      let query = client
        .from('conversations')
        .select('*')
        .eq(role === 'buying' ? 'buyer_id' : 'seller_id', user.id)
        .order('activity_at', { ascending: false })
        .order('id', { ascending: true })
        .limit(51)
      if (cursor) {
        const boundary = conversationCursor(cursor)
        query = query.or(
          `activity_at.lt.${boundary.at},and(activity_at.eq.${boundary.at},id.gt.${boundary.id})`
        )
      }
      const { data, error } = await query
      checked(error)
      const rows = (data || []) as Row[]
      const page = rows.slice(0, 50)
      const last = page[page.length - 1]
      return {
        conversations: await Promise.all(page.map(dto)),
        nextCursor:
          rows.length > 50
            ? Buffer.from(
                JSON.stringify({ at: last.activity_at, id: last.id })
              ).toString('base64url')
            : null,
      }
    },
    async detail(id: string) {
      return dto(await row(id))
    },
    async history(id: string, before?: number) {
      await row(id)
      if (before !== undefined && (!Number.isSafeInteger(before) || before < 1))
        throw new ListingApiError('Invalid message cursor.')
      let query = client
        .from('messages')
        .select('*')
        .eq('conversation_id', id)
        .order('sequence', { ascending: false })
        .limit(51)
      if (before !== undefined) query = query.lt('sequence', before)
      const { data, error } = await query
      checked(error)
      const rows = (data || []) as MessageRow[]
      const page = rows.slice(0, 50)
      return {
        messages: page.reverse().map(message),
        nextBefore: rows.length > 50 ? Number(page[0].sequence) : null,
      }
    },
    async findOrCreate(listingId: unknown) {
      await actor()
      const { data, error } = await client.rpc(
        'marketplace_find_or_create_conversation',
        { p_listing_id: messageUuid(listingId) }
      )
      checked(error)
      return dto(data as Row)
    },
    async send(
      id: string,
      input: {
        type?: unknown
        content?: unknown
        clientMessageId?: unknown
        senderId?: unknown
      }
    ) {
      await row(id)
      if (input.type !== 'TEXT' || input.senderId !== undefined)
        throw new ListingApiError(
          'Only authenticated TEXT submissions are supported.'
        )
      if (
        typeof input.content !== 'string' ||
        !input.content.trim() ||
        Array.from(input.content.trim()).length > 2000
      )
        throw new ListingApiError('Send 1–2000 characters of nonblank text.')
      const { data, error } = await client.rpc('marketplace_send_text', {
        p_conversation_id: id,
        p_client_message_id: messageUuid(input.clientMessageId),
        p_content: input.content,
      })
      checked(error)
      return message(data as MessageRow)
    },
    async read(id: string, through: unknown) {
      await row(id)
      if (
        typeof through !== 'number' ||
        !Number.isSafeInteger(through) ||
        through < 0
      )
        throw new ListingApiError(
          'Read through a valid rendered message sequence.'
        )
      const { data, error } = await client.rpc(
        'marketplace_mark_conversation_read',
        { p_conversation_id: id, p_through_sequence: through }
      )
      checked(error)
      return {
        conversationId: data.conversation_id as string,
        lastReadSequence: Number(data.last_read_sequence),
        unreadCount: Number(data.unread_count),
      }
    },
  }
}
