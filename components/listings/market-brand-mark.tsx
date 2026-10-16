import styles from './market-layout.module.css'

export function MarketBrandMark() {
  return (
    <span
      aria-hidden="true"
      className={styles.brandAccent}
      data-market-brand-mark="true"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/static/icons/uu-logo.svg" alt="" width={447} height={267} />
    </span>
  )
}
