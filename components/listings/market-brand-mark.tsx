import styles from './market-layout.module.css'

export function MarketBrandMark() {
  return (
    <span
      aria-hidden="true"
      className={styles.brandAccent}
      data-market-brand-mark="true"
    >
      ✦
    </span>
  )
}
