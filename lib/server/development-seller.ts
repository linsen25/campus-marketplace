// RETIRED in Phase 4: retained only until hosted Supabase acceptance checks pass.
// No active marketplace code may import this development implementation.
import type { SellerSummary } from '@/types/listing'

// Temporary shared identity for the local demo. This is not authentication.
export function getDevelopmentSeller(): SellerSummary {
  return { id: 'development-seller', displayName: 'Development Seller' }
}
