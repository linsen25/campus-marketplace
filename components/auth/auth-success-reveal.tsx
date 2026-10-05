import { motion, useReducedMotion } from 'motion/react'
import type { SyntheticEvent } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import TextType from '@/components/ui/TextType'
import { validUsername } from '@/lib/auth-username'

import styles from './auth-success-reveal.module.css'
import { SuccessThoughtLine } from './success-thought-line'

export function AuthSuccessReveal({
  preparation,
  startedAt,
  usernameReady,
  onRetry,
  onComplete,
  username,
}: {
  startedAt: number
  preparation: Promise<void>
  usernameReady: boolean
  onRetry: () => void
  onComplete: () => void
  username?: string
}) {
  const reduced = useReducedMotion()
  const dialog = useRef<HTMLDialogElement>(null)
  const started = useRef(false)
  const [phase, setPhase] = useState('cover')
  const [destinationReady, setDestinationReady] = useState(false)
  const [textFaded, setTextFaded] = useState(false)
  const [textReady, setTextReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [readyAt, setReadyAt] = useState<number | null>(null)
  const [statusReady, setStatusReady] = useState(false)
  const message = validUsername(username)
    ? `Welcome back, ${username}`
    : 'Welcome back'
  useEffect(() => {
    if (destinationReady && textReady && statusReady && !failed)
      setPhase('fading')
  }, [destinationReady, textReady, statusReady, failed])
  useEffect(() => {
    if (destinationReady && textFaded && !failed) setPhase('reveal')
  }, [destinationReady, textFaded, failed])
  useEffect(() => {
    let active = true
    preparation.then(
      () => {
        if (active) {
          setReadyAt(performance.now())
          setDestinationReady(true)
        }
      },
      () => {
        if (active) {
          setFailed(true)
          setPhase('error')
        }
      }
    )
    return () => {
      active = false
    }
  }, [preparation])
  useEffect(() => {
    if (phase !== 'hold' && !(reduced && phase === 'covered')) return undefined
    if (!usernameReady) return undefined
    const timer = setTimeout(() => {
      setTextReady(true)
      setPhase('waiting')
    }, 150)
    return () => clearTimeout(timer)
  }, [phase, reduced, usernameReady])
  useLayoutEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  function covered() {
    if (started.current) return
    started.current = true
    setPhase('covered')
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
      {failed ? (
        <div className={styles.message}>
          <div>
            <p role="alert">You are signed in, but Market could not open.</p>
            <button type="button" onClick={onRetry}>
              Try opening Market again
            </button>
          </div>
        </div>
      ) : (
        phase !== 'cover' &&
        usernameReady && (
          <motion.div
            className={styles.content}
            data-success-content="true"
            initial={{ opacity: 1 }}
            animate={{
              opacity: phase === 'fading' || phase === 'reveal' ? 0 : 1,
            }}
            transition={{ duration: 0.2 }}
            onAnimationComplete={() => {
              if (phase === 'fading') setTextFaded(true)
            }}
          >
            <div className={styles.stack}>
              <p className={styles.hero} role="status" aria-label={message}>
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
              </p>
              <SuccessThoughtLine
                destinationReady={destinationReady}
                startedAt={startedAt}
                readyAt={readyAt}
                reduced={Boolean(reduced)}
                onComplete={() => setStatusReady(true)}
              />
            </div>
          </motion.div>
        )
      )}
    </motion.dialog>,
    document.body
  )
}
