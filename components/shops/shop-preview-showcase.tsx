import {
  ChartNoAxesColumn,
  ChevronRight,
  Heart,
  Package,
  Settings,
} from 'lucide-react'
import { useState } from 'react'

import styles from './shop-preview-showcase.module.css'

const previews = [
  {
    key: 'manage-products',
    title: 'Manage Products',
    description:
      'Your shop starts with your first product! Turn the things you love into something others can discover and buy. Create listings, set your prices, and keep everything organized as your little business begins to grow.',
    imagePath: '/static/images/shop-plans/manage-products-preview.png',
    Icon: Package,
  },
  {
    key: 'shop-favorites',
    title: 'Shop Favorites',
    description:
      "Found something you love? Keep it close! Save your favorite finds and shops so you can come back whenever inspiration strikes. There's always something new worth discovering.",
    imagePath: '/static/images/shop-plans/shop-favorites-preview.png',
    Icon: Heart,
  },
  {
    key: 'shop-analysis',
    title: 'Shop Analysis',
    description:
      'Every sale is a new milestone! See how your shop is doing, celebrate your progress, and discover what could help you grow. Start with the essentials on Plus, and unlock deeper insights with Pro.',
    imagePath: '/static/images/shop-plans/shop-analysis-preview.png',
    Icon: ChartNoAxesColumn,
  },
  {
    key: 'shop-settings',
    title: 'Shop Settings',
    description:
      'Make your shop feel like yours! Build a storefront that reflects your style, keep your details up to date, and manage your membership as your business grows.',
    imagePath: '/static/images/shop-plans/shop-settings-preview.png',
    Icon: Settings,
  },
] as const

/**
 * Reserved visual slots for manually captured Shop screenshots. The intended
 * image paths are data only until a matching asset is present, so this
 * component cannot create failed image requests during normal development.
 */
export function ShopPreviewShowcase() {
  const [expanded, setExpanded] = useState('manage-products')

  return (
    <section className={styles.section} aria-labelledby="shop-preview-title">
      <header className={styles.header}>
        <p>Inside My Shop</p>
        <h3 id="shop-preview-title">Everything in one workspace</h3>
      </header>
      <div className={styles.grid}>
        {previews.map((preview) => (
          <article
            className={styles.card}
            data-expanded={expanded === preview.key}
            key={preview.key}
          >
            <button
              type="button"
              className={styles.toggle}
              aria-expanded={expanded === preview.key}
              aria-controls={`${preview.key}-preview`}
              onClick={() => setExpanded(preview.key)}
            >
              <span className={styles.icon} aria-hidden="true">
                <preview.Icon size={18} />
              </span>
              <span className={styles.copy}>
                <span className={styles.title}>{preview.title}</span>
              </span>
              <ChevronRight
                className={styles.chevron}
                aria-hidden="true"
                size={18}
              />
            </button>
            <div className={styles.panel} id={`${preview.key}-preview`}>
              <div className={styles.panelInner}>
                <div
                  className={styles.placeholder}
                  data-preview-path={preview.imagePath}
                  aria-label={`${preview.title} screenshot placeholder`}
                >
                  <span>Screenshot preview</span>
                  <small>Coming soon</small>
                </div>
                <p className={styles.description}>{preview.description}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
