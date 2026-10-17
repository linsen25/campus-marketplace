import styles from './shop-pro-badge.module.css'

/** Fixed hanging Label silhouette, never platform emoji or a Lucide Tag. */
export function ShopProBadge() {
  return (
    <span className={styles.badge} data-shop-pro-badge="true">
      PRO
      <span className={styles.chip} aria-hidden="true">
        <svg
          viewBox="0 0 128 128"
          width="14"
          height="14"
          fill="#fff"
          focusable="false"
        >
          {/* Monochrome front label and string from Google Noto Emoji U+1F3F7.
            Source/Apache-2.0 notice: public/static/icons/noto-label-NOTICE.txt */}
          <path d="m115 88.25-51.53-58.29c-1.35-1.51-4.13-2.87-6.16-3l-23.46 1.18c-2.03-0.13-3.8 1.43-3.93 3.46l-4.04 23.15c-0.13 2.03 0.88 4.96 2.23 6.48l51.52 58.29c1.34 1.52 3.72 1.66 5.24 0.32l29.8-26.35c1.53-1.34 1.68-3.71 0.33-5.24zm-70.32-38.81c-2.9 0-5.25-2.35-5.25-5.25s2.35-5.25 5.25-5.25 5.25 2.35 5.25 5.25c0.01 2.9-2.34 5.25-5.25 5.25z" />
          <path d="m43.92 20.12c-4.28-9.4-10.63-15.13-17.44-15.73-4.62-0.41-8.92 1.62-11.54 5.42-3.12 4.52-3.27 10.74-0.4 16.65 2.94 6.06 6.33 10.99 10.07 14.64l0.5 0.48 1.66-2.92-0.3-0.29c-3.41-3.32-6.29-7.55-9.08-13.3-2.39-4.94-2.34-9.84 0.16-13.46 1.96-2.85 5.19-4.36 8.65-4.06 5.64 0.5 11.05 5.56 14.84 13.89 3.84 8.42 4.92 15.76 2.9 19.62-0.9 1.72-1.86 2.37-4.12 2.79l-0.45 0.08 0.01 0.46c0 0.03 0.02 0.7 0.2 1.3 0.18 0.59 0.44 1.04 0.46 1.06l0.19 0.32 0.36-0.07c3.08-0.56 4.75-1.77 6.16-4.46 2.5-4.81 1.47-12.97-2.83-22.42z" />
        </svg>
      </span>
    </span>
  )
}
