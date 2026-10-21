import { Check, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useCallback, useState } from 'react'

import ShiningButton from '@/components/animata/button/shining-button'
import FilterInteraction from '@/components/filter-interaction'
import sortStyles from '@/components/filter-interaction.module.css'
import { ExpandableCard } from '@/components/velora/expandable-card'
import { listingConditions } from '@/lib/listing-metadata'
import type { Listing } from '@/types/listing'
import { formatListingPrice } from '@/utils/format-listing-price'

import { listingCardRadius } from './listing-card-presentation'
import { ListingMedia } from './listing-media'
import { PublishedListingDetails } from './published-listing-details'
import styles from './resale-management.module.css'

function DeleteMenu({
  title,
  disabled,
  onDelete,
  onMarkSold,
  onCost,
}: {
  title: string
  disabled: boolean
  onDelete: () => void
  onMarkSold?: () => void
  onCost?: () => void
}) {
  const [open, setOpen] = useState(false)
  const toggle = useCallback((value: boolean) => setOpen(value), [])
  return (
    <FilterInteraction
      label={`Listing actions for ${title}`}
      appearance="select"
      disabled={disabled && !onCost}
      triggerClassName={styles.more}
      triggerContent={<MoreHorizontal size={18} aria-hidden="true" />}
      isOpen={open}
      onOpenChange={toggle}
    >
      <div role="menu" aria-label={`Listing actions for ${title}`}>
        {onCost && (
          <button
            type="button"
            role="menuitem"
            data-sort-option={true}
            className={sortStyles.option}
            onClick={(event) => {
              event.stopPropagation()
              setOpen(false)
              onCost()
            }}
          >
            Product cost
          </button>
        )}
        {onMarkSold && (
          <button
            type="button"
            role="menuitem"
            disabled={disabled}
            data-sort-option={true}
            className={sortStyles.option}
            onClick={(event) => {
              event.stopPropagation()
              setOpen(false)
              onMarkSold()
            }}
          >
            <Check size={16} aria-hidden="true" />
            Mark as sold
          </button>
        )}
        <button
          type="button"
          role="menuitem"
          disabled={disabled}
          data-sort-option={true}
          className={`${sortStyles.option} ${styles.delete}`}
          onClick={(event) => {
            event.stopPropagation()
            setOpen(false)
            onDelete()
          }}
        >
          <Trash2 size={16} aria-hidden="true" />
          Delete Listing
        </button>
      </div>
    </FilterInteraction>
  )
}
export function ResaleManagementCard({
  listing,
  onEdit,
  onDelete,
  channel = 'resale',
  demo = false,
  onMarkSold,
  onCost,
}: {
  onMarkSold?: () => void
  onCost?: () => void
  demo?: boolean
  channel?: 'resale' | 'shop'
  listing: Listing
  onEdit: () => void
  onDelete: () => void
}) {
  const available = !demo && listing.status === 'available'
  const condition = listingConditions.find(
    (value) => value.value === listing.condition
  )?.label
  const price = listing.price === 0 ? 'Free' : formatListingPrice(listing.price)
  const status = {
    available: 'Active',
    pending: 'Pending',
    reserved: 'Reserved',
    sold: 'Sold',
  }[listing.status]
  return (
    <article
      className={styles.card}
      aria-label={listing.title}
      data-resale-management-card={
        channel === 'resale' ? listing.id : undefined
      }
      data-shop-management-card={channel === 'shop' ? listing.id : undefined}
    >
      <ExpandableCard
        className={styles.preview}
        visualRadius={listingCardRadius}
        title={price}
        expandedTitle={listing.title}
        expandedEyebrow={price}
        media={
          <ListingMedia
            images={listing.photoUrls.slice(0, 1)}
            alt={listing.title}
          />
        }
        expandedMedia={
          <ListingMedia images={listing.photoUrls} alt={listing.title} />
        }
        renderCloseAction={(close) => (
          <ShiningButton
            variant="red"
            desktopAppearance={true}
            showArrow={false}
            onClick={close}
          >
            Close
          </ShiningButton>
        )}
        collapsedContent={
          <span className={styles.summary}>
            <span className={styles.priceRow}>
              <span className={styles.price}>{price}</span>
              <span className={styles.status} data-state={listing.status}>
                {status}
              </span>
            </span>
            <span className={styles.title}>{listing.title}</span>
            <span className={styles.metadata}>
              {[condition, listing.category].filter(Boolean).join(' \u00b7 ')}
            </span>
          </span>
        }
      >
        <PublishedListingDetails listing={listing} />
      </ExpandableCard>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.edit}
          data-owner-edit={true}
          disabled={!available}
          onClick={(event) => {
            event.stopPropagation()
            onEdit()
          }}
        >
          <Pencil size={14} aria-hidden="true" />
          {channel === 'shop' ? 'Edit Product' : 'Edit listing'}
        </button>
        <DeleteMenu
          title={listing.title}
          disabled={!available}
          onDelete={onDelete}
          onMarkSold={channel === 'shop' ? onMarkSold : undefined}
          onCost={channel === 'shop' && !demo ? onCost : undefined}
        />
      </div>
    </article>
  )
}
