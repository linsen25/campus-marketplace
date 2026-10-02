import { motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { TransitionPanel } from '@/components/motion-primitives/transition-panel'

import { contactLinks, panels } from './homepage-footer-content'
import styles from './homepage-footer.module.css'
import { useHomeReducedMotion } from './use-home-reduced-motion'

function HomepageFooterContact() {
  if (!contactLinks.email && !contactLinks.discord && !contactLinks.github)
    return null
  const discordUrl = contactLinks.discord?.match(/^https?:\/\//i)
  return (
    <section className={styles.contact} aria-labelledby="homepage-contact">
      <h2 id="homepage-contact">Questions, ideas, or found a bug?</h2>
      <p>
        Campus Marketplace is still growing. If you have feedback, want to
        contribute, or just want to say hi, reach out.
      </p>
      <dl className={styles.contactLinks}>
        {contactLinks.email && (
          <div>
            <dt>Email</dt>
            <dd>
              <a href={`mailto:${contactLinks.email}`}>{contactLinks.email}</a>
            </dd>
          </div>
        )}
        {contactLinks.discord && (
          <div>
            <dt>Discord</dt>
            <dd>
              {discordUrl ? (
                <a
                  href={contactLinks.discord}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {contactLinks.discord}
                </a>
              ) : (
                contactLinks.discord
              )}
            </dd>
          </div>
        )}
        {contactLinks.github && (
          <div>
            <dt>GitHub</dt>
            <dd>
              <a
                href={contactLinks.github}
                target="_blank"
                rel="noopener noreferrer"
              >
                {contactLinks.github}
              </a>
            </dd>
          </div>
        )}
      </dl>
    </section>
  )
}

export function HomepageFooter() {
  const [activeIndex, setActiveIndex] = useState(0)
  const reduced = useHomeReducedMotion()
  const measure = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const finalFooterRef = useRef<HTMLDivElement>(null)
  const pendingVisibility = useRef(false)
  const [height, setHeight] = useState<number | null>(null)
  useEffect(() => {
    const element = measure.current
    if (!element) return undefined
    const observer = new ResizeObserver(() =>
      setHeight(element.getBoundingClientRect().height)
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const keepActivePanelVisible = useCallback(() => {
    if (
      !pendingVisibility.current ||
      !panelRef.current ||
      !measure.current ||
      !finalFooterRef.current
    )
      return
    const rect = panelRef.current.getBoundingClientRect()
    if (
      Math.abs(rect.height - measure.current.getBoundingClientRect().height) > 1
    )
      return
    pendingVisibility.current = false
    const navigation = document.querySelector<HTMLElement>(
      'nav[aria-label="Primary navigation"]'
    )
    const navigationRect = navigation?.getBoundingClientRect()
    const bottom =
      navigationRect && navigationRect.height > 0
        ? Math.min(window.innerHeight, navigationRect.top) - 24
        : window.innerHeight - 24
    const footerBottom = finalFooterRef.current.getBoundingClientRect().bottom
    if (footerBottom <= bottom) return
    const available = bottom - 24
    const delta =
      rect.height > available ? rect.top - 24 : footerBottom - bottom
    if (Math.abs(delta) < 1) return
    const html = document.documentElement
    const oldBehavior = html.style.scrollBehavior
    if (reduced) html.style.scrollBehavior = 'auto'
    window.scrollTo({
      top: window.scrollY + delta,
      behavior: reduced ? 'auto' : 'smooth',
    })
    if (reduced) html.style.scrollBehavior = oldBehavior
  }, [reduced])
  useEffect(() => {
    if (!reduced || !pendingVisibility.current) return undefined
    // Zero-duration transitions may not emit an animation completion event.
    const frame = requestAnimationFrame(keepActivePanelVisible)
    return () => cancelAnimationFrame(frame)
  }, [activeIndex, height, reduced, keepActivePanelVisible])
  return (
    <footer className={styles.footer} aria-label="About Campus Marketplace">
      <div className={styles.content}>
        <p className={styles.brand}>Campus Marketplace</p>
        <div
          className={styles.controls}
          role="group"
          aria-label="Marketplace information"
        >
          {panels.map((panel, index) => (
            <button
              key={panel.title}
              type="button"
              className={styles.control}
              aria-pressed={activeIndex === index}
              aria-controls="homepage-information"
              onClick={() => {
                if (index === activeIndex) return
                pendingVisibility.current = true
                setActiveIndex(index)
              }}
            >
              {panel.title}
            </button>
          ))}
        </div>
        <motion.div
          ref={panelRef}
          animate={{ height: height ?? 'auto' }}
          transition={{ duration: reduced ? 0 : 0.25, ease: 'easeInOut' }}
          id="homepage-information"
          className={styles.panel}
          aria-live="polite"
          aria-atomic="true"
          onAnimationComplete={keepActivePanelVisible}
        >
          <div ref={measure}>
            <TransitionPanel
              activeIndex={activeIndex}
              transition={{ duration: reduced ? 0 : 0.25, ease: 'easeInOut' }}
              variants={{
                enter: {
                  opacity: 0,
                  y: reduced ? 0 : -6,
                },
                center: { opacity: 1, y: 0 },
                exit: {
                  opacity: 0,
                  y: reduced ? 0 : 6,
                },
              }}
              onAnimationComplete={keepActivePanelVisible}
            >
              {panels.map((panel) => (
                <div key={panel.title}>
                  <h2 className={styles.trustHeading}>{panel.heading}</h2>
                  <p className={styles.intro}>{panel.intro}</p>
                  {panel.statusNote && (
                    <p className={styles.futureNote}>{panel.statusNote}</p>
                  )}
                  <ol className={styles.trustList}>
                    {panel.items.map((item, index) => (
                      <li key={item.title}>
                        <span className={styles.number} aria-hidden="true">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <div>
                          <h3>{item.title}</h3>
                          <p>{item.copy}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </TransitionPanel>
          </div>
        </motion.div>
        <HomepageFooterContact />
        <div ref={finalFooterRef} className={styles.projectNote}>
          <p>
            Independent project for the Western community. Not affiliated with
            Western University.
          </p>
          <p>&copy; 2026 Campus Marketplace</p>
        </div>
      </div>
    </footer>
  )
}
