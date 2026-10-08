/* eslint-disable no-nested-ternary -- Route method selection is based on two bounded path segments. */
import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { requireImageEnvironment } from '@/lib/server/chat-image-storage'
import {
  requireMarketplaceUser,
  requireSameOriginWrite,
} from '@/lib/server/marketplace-auth'
import {
  abandonImages,
  imageError,
  imagePresentation,
  ownedSubmission,
  signMessageImages,
} from '@/lib/server/message-image-service'
import {
  createSupabaseMessagesRepository,
  messageUuid,
} from '@/lib/server/supabase-messages-repository'
import { createMarketplaceClient } from '@/lib/supabase/server'

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } }
// eslint-disable-next-line complexity -- Dispatcher for prepare/finalize/cancel/private renewal.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  const parts =
    typeof req.query.segments === 'string'
      ? [req.query.segments]
      : req.query.segments || []
  const allowed =
    parts.length === 1
      ? ['GET']
      : parts.length === 2 &&
        ['prepare', 'finalize', 'cancel'].includes(parts[1])
      ? ['POST']
      : []
  if (!allowed.length) return res.status(404).json({ error: 'Not found.' })
  if (!allowed.includes(req.method || '')) {
    res.setHeader('Allow', allowed.join(', '))
    return res.status(405).json({ error: 'Method not allowed.' })
  }
  try {
    if (req.method === 'POST') requireSameOriginWrite(req)
    requireImageEnvironment()
    const client = createMarketplaceClient({ req, res })
    await requireMarketplaceUser(client)
    const id = messageUuid(parts[0])
    if (req.method === 'GET') {
      const images = await signMessageImages(client, [id])
      if (!images.length)
        throw new ListingApiError('Image message not found.', 404)
      return res.status(200).json({
        images: images.map(imagePresentation),
      })
    }
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))
      throw new ListingApiError('A JSON object is required.')
    if (parts[1] === 'prepare') {
      if (
        Object.keys(req.body).some(
          (key) => !['clientMessageId', 'images'].includes(key)
        )
      )
        throw new ListingApiError('Unexpected image fields.')
      const { data, error } = await client.rpc(
        'marketplace_prepare_image_message',
        {
          p_conversation_id: id,
          p_client_message_id: messageUuid(req.body.clientMessageId),
          p_images: req.body.images,
        }
      )
      imageError(error)
      return res.status(200).json({
        id: data.id,
        state: data.state,
        manifest: data.manifest,
        expiresAt: data.expires_at,
      })
    }
    if (Object.keys(req.body).length)
      throw new ListingApiError('Unexpected image fields.')
    if (parts[1] === 'cancel')
      return res.status(200).json(await abandonImages(client, id))
    await ownedSubmission(client, id)
    const { data, error } = await client.rpc(
      'marketplace_finalize_image_message',
      { p_submission_id: id }
    )
    imageError(error)
    // Commit is confirmed before presentation/signing. A signing failure is retryable
    // with the same ID; never abandon or delete a possibly committed send.
    const repository = createSupabaseMessagesRepository({ req, res })
    return res
      .status(200)
      .json(await repository.present([data]).then((items) => items[0]))
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 503)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Unable to complete image request. Retry the same submission.',
      })
  }
}
