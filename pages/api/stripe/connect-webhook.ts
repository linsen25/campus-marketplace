import { stripeWebhookHandler } from '@/lib/server/stripe-webhook-handler'

export const config = { api: { bodyParser: false } }
export default stripeWebhookHandler('connected')
