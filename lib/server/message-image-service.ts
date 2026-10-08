import { createHash } from 'crypto'

import type { NextApiRequest } from 'next'

import { hasImageSignature, listingImageRules } from '@/lib/listing-images'
import { ListingApiError } from '@/lib/listing-validation'
import {
  createChatStorage,
  requireImageEnvironment,
} from '@/lib/server/chat-image-storage'
import { requireMarketplaceUser } from '@/lib/server/marketplace-auth'
import { messageUuid } from '@/lib/server/messages-environment'
import type { MarketplaceClient } from '@/lib/supabase/server'

const bucket = 'chat-images'
type Slot = {
  id: string
  position: number
  storage_path: string
  original_name: string
  mime_type: string
  size_bytes: number
  sha256: string
}
type Submission = {
  id: string
  conversation_id: string
  sender_id: string
  state: string
  expires_at: string
  manifest: Slot[]
}
export function imageError(error: { code?: string } | null) {
  if (!error) return
  let status = 503
  if (error.code === '23505') status = 409
  else if (error.code === '42501') status = 404
  else if (['23514', '22P02', 'P0001'].includes(error.code || '')) status = 400
  const messages: Record<number, string> = {
    404: 'Image submission not found.',
    409: 'This submission conflicts with an existing send.',
    400: 'Image submission did not pass validation.',
    503: 'Unable to complete image request. Retry the same submission.',
  }
  throw new ListingApiError(messages[status], status)
}
export function imagePresentation(image: {
  id: string
  name: string
  size: number
  mimeType: string
  previewUrl: string
  expiresAt: string
}) {
  return {
    id: image.id,
    name: image.name,
    size: image.size,
    mimeType: image.mimeType,
    previewUrl: image.previewUrl,
    expiresAt: image.expiresAt,
  }
}
export async function ownedSubmission(
  client: MarketplaceClient,
  id: string
): Promise<Submission> {
  requireImageEnvironment()
  const user = await requireMarketplaceUser(client)
  const { data, error } = await client
    .from('image_message_submissions')
    .select('*')
    .eq('id', messageUuid(id))
    .maybeSingle()
  imageError(error)
  if (!data || data.sender_id !== user.id)
    throw new ListingApiError('Image submission not found.', 404)
  const { data: conversation, error: accessError } = await client
    .from('conversations')
    .select('id')
    .eq('id', data.conversation_id)
    .maybeSingle()
  imageError(accessError)
  if (!conversation)
    throw new ListingApiError('Image submission not found.', 404)
  return data as Submission
}
export async function signMessageImages(
  client: MarketplaceClient,
  messageIds: string[]
) {
  if (!messageIds.length) return []
  requireImageEnvironment()
  await requireMarketplaceUser(client)
  const { data, error } = await client
    .from('message_images')
    .select('*')
    .in('message_id', messageIds.map(messageUuid))
    .order('position')
  imageError(error)
  if (!data?.length) return []
  // Paths come exclusively from participant-RLS metadata, never a browser path.
  const { data: signed, error: signingError } = await createChatStorage()
    .storage.from(bucket)
    .createSignedUrls(
      data.map((item) => item.storage_path),
      300
    )
  if (
    signingError ||
    !signed ||
    signed.some((item) => item.error || !item.signedUrl)
  )
    throw new ListingApiError(
      'Unable to load private photos. Please retry.',
      503
    )
  const expiresAt = new Date(Date.now() + 300000).toISOString()
  return data.map((item, index) => ({
    messageId: item.message_id as string,
    id: item.id as string,
    name: item.original_name as string,
    size: Number(item.size_bytes),
    mimeType: item.mime_type as string,
    previewUrl: signed[index].signedUrl as string,
    expiresAt,
  }))
}
async function removeAbandoned(
  client: MarketplaceClient,
  id: string,
  signal?: AbortSignal
) {
  const submission = await ownedSubmission(client, id)
  if (submission.state !== 'abandoned') return
  const { data: live, error } = await client
    .from('message_images')
    .select('id')
    .in(
      'storage_path',
      submission.manifest.map((slot) => slot.storage_path)
    )
  imageError(error)
  if (live?.length) return
  // Keep queued records/tombstones for late-write reconciliation; never ack young work.
  await createChatStorage(signal)
    .storage.from(bucket)
    .remove(submission.manifest.map((slot) => slot.storage_path))
}
export async function abandonImages(client: MarketplaceClient, id: string) {
  await ownedSubmission(client, id)
  const { data, error } = await client.rpc(
    'marketplace_abandon_image_message',
    { p_submission_id: id }
  )
  imageError(error)
  try {
    await removeAbandoned(client, id)
  } catch {
    /* Durable queue retains removal failures. */
  }
  return { id: data.id, state: data.state }
}
const digest = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex')
// eslint-disable-next-line complexity -- Validate stream, immutable Storage reconciliation and receipt within one bounded request.
export async function uploadMessageImage(
  client: MarketplaceClient,
  req: NextApiRequest,
  submissionId: string,
  imageId: string,
  controller: AbortController
) {
  const submission = await ownedSubmission(client, submissionId)
  const slot = submission.manifest.find(
    (item) => item.id === messageUuid(imageId)
  )
  if (!slot) throw new ListingApiError('Image slot not found.', 404)
  if (
    submission.state !== 'pending' ||
    Date.parse(submission.expires_at) <= Date.now()
  )
    throw new ListingApiError(
      'This image submission is no longer pending.',
      409
    )
  if (Number(req.headers['content-length']) > listingImageRules.maxBytes)
    throw new ListingApiError('Each image must be at most 3 MiB.', 413)
  if (req.headers['content-type'] !== slot.mime_type)
    throw new ListingApiError(
      'The file type does not match the reserved image.',
      415
    )
  if (
    req.headers['content-length'] !== undefined &&
    Number(req.headers['content-length']) !== slot.size_bytes
  )
    throw new ListingApiError(
      'Image metadata does not match the reserved slot.'
    )
  const storage = createChatStorage(controller.signal)
  try {
    const chunks: Buffer[] = []
    let size = 0
    const read = async () => {
      for await (const chunk of req) {
        if (controller.signal.aborted) throw new Error('Upload timed out')
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += bytes.length
        if (size > listingImageRules.maxBytes || size > slot.size_bytes)
          throw new ListingApiError('Each image must be at most 3 MiB.', 413)
        chunks.push(bytes)
      }
      return Buffer.concat(chunks)
    }
    let abortRead: () => void = () => undefined
    const timeout = new Promise<never>((_, reject) => {
      abortRead = () =>
        reject(
          new ListingApiError(
            'Upload timed out. Retry the same submission.',
            503
          )
        )
      controller.signal.addEventListener('abort', abortRead, { once: true })
    })
    let bytes: Buffer
    try {
      bytes = await Promise.race([read(), timeout])
    } finally {
      controller.signal.removeEventListener('abort', abortRead)
    }
    if (size !== slot.size_bytes || digest(bytes) !== slot.sha256)
      throw new ListingApiError('Image bytes do not match the reserved file.')
    if (!hasImageSignature(bytes, slot.mime_type))
      throw new ListingApiError(
        'The file contents do not match a supported image.',
        415
      )
    if (controller.signal.aborted) throw new Error('Upload aborted')
    // Never overwrite: ambiguous/duplicate upload outcomes reconcile immutable bytes.
    const uploaded = await storage.storage
      .from(bucket)
      .upload(slot.storage_path, bytes, {
        contentType: slot.mime_type,
        cacheControl: '0',
        upsert: false,
      })
    if (
      uploaded.error &&
      !['409', '400'].includes(String(uploaded.error.statusCode))
    )
      throw new ListingApiError(
        'Upload could not be confirmed. Retry the same submission.',
        503
      )
    const info = await storage.storage.from(bucket).info(slot.storage_path)
    const downloaded = await storage.storage
      .from(bucket)
      .download(slot.storage_path)
    if (
      info.error ||
      downloaded.error ||
      !downloaded.data ||
      downloaded.data.size !== slot.size_bytes
    )
      throw new ListingApiError(
        'Stored image could not be verified. Retry the same submission.',
        503
      )
    const stored = Buffer.from(await downloaded.data.arrayBuffer())
    if (
      info.data.contentType !== slot.mime_type ||
      Number(info.data.size) !== slot.size_bytes ||
      !hasImageSignature(stored, slot.mime_type) ||
      digest(stored) !== slot.sha256
    )
      throw new ListingApiError(
        'Stored image does not match the reserved file.',
        409
      )
    const { error } = await storage.rpc(
      'marketplace_record_verified_chat_image',
      {
        p_submission_id: submission.id,
        p_image_id: slot.id,
        p_actor_id: submission.sender_id,
        p_object_id: info.data.id,
        p_sha256: digest(stored),
      }
    )
    imageError(error)
    return { id: slot.id, verified: true }
  } finally {
    // Cancel may have raced this upload; compensate after bounded upstream settlement.
    try {
      await removeAbandoned(client, submissionId, controller.signal)
    } catch {
      /* Queue remains for unknown/late writes. */
    }
  }
}
