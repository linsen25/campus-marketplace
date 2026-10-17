import { footerSections } from './homepage-footer-content'
import styles from './homepage-footer.module.css'

export function HomepageFooter() {
  return (
    <footer className={styles.footer} aria-label="About Usual & Unusual">
      <div className={styles.content}>
        <div className={styles.intro}>
          <p className={styles.brand}>Usual & Unusual</p>
          <p>A private marketplace built for the Western student community.</p>
          <p>
            Buy, sell, open a shop, and manage transactions in one connected
            marketplace.
          </p>
        </div>
        <div className={styles.columns}>
          {footerSections.map((section) => (
            <section
              key={section.id}
              aria-labelledby={`homepage-footer-${section.id}`}
            >
              <h2 id={`homepage-footer-${section.id}`}>{section.title}</h2>
              {section.items.length > 0 && (
                <dl className={styles.items}>
                  {section.items.map((item) => (
                    <div key={item.title}>
                      <dt>{item.title}</dt>
                      <dd>{item.copy}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
          ))}
        </div>
        <div className={styles.legal}>
          <div>
            <p>Independent project for the Western community.</p>
            <p>Not affiliated with Western University.</p>
          </div>
          <p className={styles.copyright}>&copy; 2026 Usual & Unusual</p>
        </div>
      </div>
    </footer>
  )
}
