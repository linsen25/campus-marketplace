import type { ConversationListingProvenance as Provenance } from '@/types/conversation'

import styles from './conversation-listing-provenance.module.css'

export function ConversationListingProvenance({
  provenance,
}: {
  provenance?: Provenance
}) {
  if (provenance?.channel !== 'shop') return null
  return (
    <span className={styles.provenance} title={provenance.shopName}>
      {provenance.shopName} &middot; Shop
    </span>
  )
}
