import { Check, Sparkles } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useState } from 'react'

import styles from '../auth/auth-success-reveal.module.css'

const labels = ['Wrapping things up', 'Signing you out', 'Returning to Welcome']

export function LogoutThoughtLine({
  stage,
  reduced,
  onComplete,
}: {
  stage: number
  reduced: boolean
  onComplete: () => void
}) {
  const [visible, setVisible] = useState(0)
  useEffect(() => {
    if (visible >= stage) return undefined
    // A readability floor acknowledges only boundaries already reached.
    const timer = setTimeout(() => setVisible((n) => n + 1), reduced ? 0 : 180)
    return () => clearTimeout(timer)
  }, [stage, visible, reduced])
  useEffect(() => {
    if (visible === 3) onComplete()
  }, [visible, onComplete])
  return (
    <div className={styles.thoughtLine}>
      <div className={styles.thoughtHeader}>
        <Sparkles size={16} />
        <span>Returning to Welcome{visible === 3 ? '' : '...'}</span>
      </div>
      <ol className={styles.thoughtSteps} aria-label="Logout progress">
        {labels.slice(0, Math.min(visible + 1, 3)).map((label, index) => (
          <motion.li
            key={label}
            className={styles.step}
            data-state={index < visible ? 'complete' : 'active'}
            initial={reduced ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            <span className={styles.statusMark} aria-hidden="true">
              {index < visible ? (
                <Check size={14} />
              ) : (
                <i className={styles.pulse} />
              )}
            </span>
            <span>{label}</span>
          </motion.li>
        ))}
      </ol>
    </div>
  )
}
