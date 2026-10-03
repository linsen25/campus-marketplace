import { motion, useReducedMotion } from 'motion/react'
import type { SyntheticEvent } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import TextType from '@/components/ui/TextType'
import { validUsername } from '@/lib/auth-username'

import styles from './auth-success-reveal.module.css'

export function AuthSuccessReveal({
  onCovered,
  onComplete,
  username,
}: {
  onCovered: () => Promise<void>
  onComplete: () => void
  username?: string
}) {
  const reduced = useReducedMotion()
  const dialog = useRef<HTMLDialogElement>(null)
  const started = useRef(false)
  const [phase, setPhase] = useState('cover')
  const [destinationReady, setDestinationReady] = useState(false)
  const [textFaded, setTextFaded] = useState(false)
  const message = validUsername(username)
    ? `Welcome back, ${username}`
    : 'Welcome back'
  useEffect(() => {
    if (destinationReady && textFaded) setPhase('reveal')
  }, [destinationReady, textFaded])
  useEffect(() => {
    if (phase !== 'hold' && !(reduced && phase === 'covered')) return undefined
    const timer = setTimeout(() => setPhase('fading'), 150)
    return () => clearTimeout(timer)
  }, [phase, reduced])
  useLayoutEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  async function covered() {
    if (started.current) return
    started.current = true
    setPhase('covered')
    try {
      await onCovered()
    } finally {
      setDestinationReady(true)
    }
  }
  function completed() {
    if (phase === 'cover') covered()
    if (phase === 'reveal') onComplete()
  }
  const duration = reduced
    ? 0.12
    : { cover: 0.4, covered: 0.4, reveal: 0.5 }[phase] || 0.4
  return createPortal(
    <motion.dialog
      ref={dialog}
      aria-label="Authentication successful"
      className={`${styles.overlay} ${reduced ? styles.reduced : ''}`}
      data-auth-success={phase}
      initial={reduced ? { opacity: 0 } : false}
      animate={{ opacity: reduced && phase === 'reveal' ? 0 : 1 }}
      transition={{ duration, ease: 'easeInOut' }}
      onAnimationComplete={reduced ? completed : undefined}
      onCancel={(event: SyntheticEvent<HTMLDialogElement>) =>
        event.preventDefault()
      }
    >
      {!reduced && (
        <>
          <motion.div
            className={`${styles.panel} ${styles.top}`}
            initial={{ y: '-100%' }}
            animate={{ y: phase === 'reveal' ? '-100%' : '0%' }}
            transition={{ duration, ease: 'easeInOut' }}
            onAnimationComplete={() => completed()}
          />
          <motion.div
            className={`${styles.panel} ${styles.bottom}`}
            initial={{ y: '100%' }}
            animate={{ y: phase === 'reveal' ? '100%' : '0%' }}
            transition={{ duration, ease: 'easeInOut' }}
          />
        </>
      )}
      {phase !== 'cover' && (
        <motion.p
          className={styles.message}
          role="status"
          aria-label={message}
          initial={{ opacity: 1 }}
          animate={{
            opacity: phase === 'fading' || phase === 'reveal' ? 0 : 1,
          }}
          transition={{ duration: 0.2 }}
          onAnimationComplete={() => {
            if (phase === 'fading') setTextFaded(true)
          }}
        >
          {reduced ? (
            message
          ) : (
            <TextType
              text={message}
              as="span"
              typingSpeed={50}
              loop={false}
              showCursor={false}
              aria-hidden="true"
              onTypingComplete={() => setPhase('hold')}
            />
          )}
        </motion.p>
      )}
    </motion.dialog>,
    document.body
  )
}
