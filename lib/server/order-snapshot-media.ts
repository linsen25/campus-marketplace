import { createHash } from 'crypto'

import { hasImageSignature, listingImageRules } from '@/lib/listing-images'
import { ListingApiError } from '@/lib/listing-validation'
import { createChatStorage } from '@/lib/server/chat-image-storage'
import { requireMarketplaceUser } from '@/lib/server/marketplace-auth'
import { messageUuid } from '@/lib/server/messages-environment'
import type { MarketplaceClient } from '@/lib/supabase/server'

const bucket = 'order-snapshot-media'
type Asset = {
  id: string
  source_path: string
  path: string
  mime_type: string | null
  sha256: string | null
  verified_at: string | null
}
type Batch = { id: string; state: string; assets: Asset[] }
function storage() {
  if (
    typeof window !== 'undefined' ||
    process.env.APP_ENV !== 'staging' ||
    process.env.NEXT_PUBLIC_SUPABASE_URL !==
      'https://pcaqxezdfxofysghssyo.supabase.co'
  )
    throw new ListingApiError('Snapshot media environment unavailable.', 503)
  return createChatStorage()
}
async function rpc(name: string, params: Record<string, unknown>) {
  const { data, error } = await storage().rpc(name, params)
  if (error)
    throw new ListingApiError(
      'Snapshot media operation unavailable. Retry.',
      503
    )
  return data
}
async function bytes(sourceBucket: string, path: string) {
  const { data, error } = await storage()
    .storage.from(sourceBucket)
    .download(path)
  if (error || !data)
    throw new ListingApiError('Snapshot image unavailable.', 503)
  if (data.size < 1 || data.size > listingImageRules.maxBytes)
    throw new ListingApiError('Invalid snapshot image.', 400)
  const body = Buffer.from(await data.arrayBuffer())
  if (!hasImageSignature(body, data.type))
    throw new ListingApiError('Invalid snapshot image.', 400)
  return {
    body,
    mime: data.type,
    sha: createHash('sha256').update(body).digest('hex'),
  }
}

// No public C1 preparation endpoint. Caller must supply the real session client;
// paths and target UUIDs come solely from the trusted database manifest.
export async function prepareOrderSnapshotMedia(
  client: MarketplaceClient,
  offerId: string,
  commandId: string
): Promise<Batch> {
  storage()
  const actor = await requireMarketplaceUser(client)
  let batch: Batch = await rpc('marketplace_prepare_order_media', {
    p_offer: messageUuid(offerId),
    p_actor: actor.id,
    p_command: messageUuid(commandId),
  })
  for (const asset of batch.assets) {
    const source = await bytes('listing-images', asset.source_path)
    // Reconcile a successful upload whose response/verification was lost.
    const existing = await storage().storage.from(bucket).info(asset.path)
    if (existing.error) {
      if (String(existing.error.statusCode) !== '404')
        throw new ListingApiError('Snapshot destination unavailable.', 503)
      const uploaded = await storage()
        .storage.from(bucket)
        .upload(asset.path, source.body, {
          contentType: source.mime,
          upsert: false,
          cacheControl: '60',
        })
      // A concurrent same-command worker may have uploaded the identical key.
      // Download verification below is authoritative, never overwrite on retry.
      if (uploaded.error && String(uploaded.error.statusCode) !== '409')
        throw new ListingApiError('Snapshot upload failed. Retry.', 503)
    }
    const target = await bytes(bucket, asset.path)
    if (
      target.sha !== source.sha ||
      target.mime !== source.mime ||
      target.body.length !== source.body.length
    )
      throw new ListingApiError('Snapshot integrity check failed.', 503)
    batch = await rpc('marketplace_verify_order_media', {
      p_asset: asset.id,
      p_mime: target.mime,
      p_size: target.body.length,
      p_sha: target.sha,
    })
  }
  if (batch.state !== 'prepared')
    throw new ListingApiError('Complete snapshot preparation required.', 503)
  return batch
}

export async function cleanupOrderSnapshotMedia(batchId: string) {
  const claim = await rpc('marketplace_claim_order_media_cleanup', {
    p_batch: messageUuid(batchId),
  })
  if (!claim) return false
  const params = { p_batch: claim.batch_id, p_lease: claim.lease }
  const manifest: Batch = await rpc(
    'marketplace_order_media_delete_lease',
    params
  )
  const { error } = await storage()
    .storage.from(bucket)
    .remove(manifest.assets.map((a) => a.path))
  if (error) throw new ListingApiError('Snapshot cleanup requires retry.', 503)
  // Database checks exact object absence and the still-owned, valid lease.
  await rpc('marketplace_finish_order_media_cleanup', params)
  return true
}

export async function sweepOrderSnapshotMedia() {
  const ids: string[] = await rpc(
    'marketplace_order_media_cleanup_candidates',
    {}
  )
  const outcomes = []
  for (const id of ids) outcomes.push(await cleanupOrderSnapshotMedia(id))
  return outcomes
}

export async function signOrderSnapshotMedia(
  client: MarketplaceClient,
  orderId: string
) {
  storage()
  await requireMarketplaceUser(client)
  const { data, error } = await client.rpc('marketplace_order_snapshot_media', {
    p_order: messageUuid(orderId),
  })
  if (error) throw new ListingApiError('Order media not accessible.', 404)
  if (!data.length) return []
  const signed = await storage()
    .storage.from(bucket)
    .createSignedUrls(
      data.map((a: { path: string }) => a.path),
      300
    )
  if (signed.error || signed.data?.some((a) => a.error || !a.signedUrl))
    throw new ListingApiError('Order media unavailable.', 503)
  return data.map((a: { id: string; position: number }, index: number) => ({
    id: a.id,
    position: a.position,
    previewUrl: signed.data![index].signedUrl,
    expiresAt: new Date(Date.now() + 300000).toISOString(),
  }))
}
