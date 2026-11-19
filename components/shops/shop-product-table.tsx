import {
  Eye,
  MoreHorizontal,
  Pencil,
  ReceiptText,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'

import FilterInteraction from '@/components/filter-interaction'
import sortStyles from '@/components/filter-interaction.module.css'

import type { Listing } from '@/types/listing'
import { formatListingPrice } from '@/utils/format-listing-price'

import styles from './shop-product-table.module.css'

type Props = {
  items: Listing[]
  demo: boolean
  onEdit: (listing: Listing) => void
  onDelete: (listing: Listing) => void
  onMarkSold: (listing: Listing) => void
  onCost: (listing: Listing) => void
  onInventory: (listing: Listing) => void
  onPreview: (listing: Listing, trigger: HTMLButtonElement) => void
}

const statusLabel: Record<Listing['status'], string> = {
  available: 'Active',
  pending: 'Pending',
  reserved: 'Reserved',
  sold: 'Sold',
}

/** Presentation-only table; HomeListings retains all real mutation callbacks. */
export function ShopProductTable({
  items,
  demo,
  onEdit,
  onDelete,
  onMarkSold,
  onCost,
  onInventory,
  onPreview,
}: Props) {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  return (
    <div
      className={styles.wrap}
      data-shop-product-table={demo ? 'demo' : 'live'}
    >
      {demo && <p className={styles.notice}>Demo Data · Preview only</p>}
      <div className={styles.header} role="row">
        <span>Product</span>
        <span>Price</span>
        <span>Inventory</span>
        <span>Status</span>
        <span>Actions</span>
      </div>
      <div className={styles.rows} role="rowgroup">
        {items.map((listing) => {
          const editable = !demo && listing.status === 'available'
          return (
            <article className={styles.row} key={listing.id} role="row">
              <div className={styles.product} role="cell">
                {listing.photoUrls[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={listing.photoUrls[0]} alt="" />
                ) : (
                  <span className={styles.noImage}>No image</span>
                )}
                <span>
                  <b>{listing.title}</b>
                  <small>{listing.category}</small>
                </span>
              </div>
              <strong className={styles.price} role="cell">
                {listing.price === 0
                  ? 'Free'
                  : formatListingPrice(listing.price)}
              </strong>
              <span
                className={styles.inventory}
                role="cell"
                data-state={listing.inventoryStatus}
              >
                {listing.inventory
                  ? listing.inventoryStatus === 'out_of_stock'
                    ? 'Out of stock'
                    : listing.inventoryStatus === 'low_stock'
                    ? `${listing.inventory.availableQuantity} available (Low stock)`
                    : `${listing.inventory.availableQuantity} in stock`
                  : listing.inventoryStatus === 'out_of_stock'
                  ? 'Out of stock'
                  : listing.inventoryStatus === 'low_stock'
                  ? 'Low stock'
                  : 'Not available'}
              </span>
              <span
                className={styles.status}
                data-status={listing.status}
                role="cell"
              >
                {statusLabel[listing.status]}
              </span>
              <div className={styles.actions} role="cell">
                <button
                  type="button"
                  className={styles.iconButton}
                  title="Preview product"
                  aria-label={`Preview ${listing.title}`}
                  onClick={(event) => onPreview(listing, event.currentTarget)}
                >
                  <Eye size={17} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={styles.iconButton}
                  title="Edit product"
                  aria-label={`Edit ${listing.title}`}
                  disabled={!editable}
                  onClick={() => onEdit(listing)}
                >
                  <Pencil size={17} aria-hidden="true" />
                </button>
                {/* UU-REAL-SHOP-MORE-FILTERINTERACTION-20261118 */}
                <div className={styles.more}>
                  <FilterInteraction
                    label={`Manage ${listing.title}`}
                    appearance="select"
                    triggerClassName={`${styles.iconButton} ${styles.moreTrigger}`}
                    triggerContent={
                      <MoreHorizontal size={18} aria-hidden="true" />
                    }
                    isOpen={openMenu === listing.id}
                    onOpenChange={(open) =>
                      setOpenMenu(open ? listing.id : null)
                    }
                    panelClassName={styles.morePanel}
                  >
                    <div
                      className={styles.moreMenuContents}
                      role="menu"
                      aria-label={`Manage ${listing.title}`}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        data-sort-option={true}
                        className={`${sortStyles.option} ${styles.moreMenuItem}`}
                        disabled={demo || !editable}
                        onClick={() => {
                          setOpenMenu(null)
                          onCost(listing)
                        }}
                      >
                        <ReceiptText size={16} aria-hidden="true" />
                        <span>
                          <b>Adjust Product Cost</b>
                          <small>Update the cost of this product</small>
                        </span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        data-sort-option={true}
                        className={`${sortStyles.option} ${styles.moreMenuItem}`}
                        disabled={demo || !listing.inventory}
                        onClick={() => {
                          setOpenMenu(null)
                          onInventory(listing)
                        }}
                      >
                        <SlidersHorizontal size={16} aria-hidden="true" />
                        <span>
                          <b>Adjust Inventory</b>
                          <small>Increase or decrease available stock</small>
                        </span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        data-sort-option={true}
                        className={`${sortStyles.option} ${styles.moreMenuItem}`}
                        disabled={listing.status === 'sold'}
                        onClick={() => {
                          setOpenMenu(null)
                          onMarkSold(listing)
                        }}
                      >
                        <span>
                          <b>Mark as Sold</b>
                          <small>Mark this listing as sold</small>
                        </span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        data-sort-option={true}
                        className={`${sortStyles.option} ${styles.moreMenuItem} ${styles.remove}`}
                        onClick={() => {
                          setOpenMenu(null)
                          onDelete(listing)
                        }}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                        <span>
                          <b>Remove Product</b>
                          <small>Remove this product from your shop</small>
                        </span>
                      </button>
                    </div>
                  </FilterInteraction>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
