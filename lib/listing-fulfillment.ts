/** Additive preference is available only where its staging schema is deployed. */
export function listingFulfillmentEnabled() {
  return (
    process.env.NEXT_PUBLIC_MESSAGES_ENV === 'staging' &&
    process.env.NEXT_PUBLIC_SUPABASE_URL ===
      'https://pcaqxezdfxofysghssyo.supabase.co'
  )
}
