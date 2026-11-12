/** Additive preference is available only where its staging schema is deployed. */
export function listingFulfillmentEnabled() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const isB32 =
    process.env.B32_SUPABASE_PROJECT_REF === 'giqdwyiupslpfhstbtqf' &&
    supabaseUrl === 'https://giqdwyiupslpfhstbtqf.supabase.co'
  return (
    (process.env.NEXT_PUBLIC_MESSAGES_ENV === 'staging' ||
      process.env.APP_ENV === 'staging') &&
    (supabaseUrl === 'https://pcaqxezdfxofysghssyo.supabase.co' || isB32)
  )
}
