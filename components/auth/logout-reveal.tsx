import { motion, useReducedMotion } from 'motion/react'
import type { SyntheticEvent } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import TextType from '@/components/ui/TextType'
import { validUsername } from '@/lib/auth-username'

import { LogoutThoughtLine } from '../home/logout-thought-line'

import styles from './auth-success-reveal.module.css'

export function LogoutReveal({
  preparation,
  stage,
  onRetry,
  onComplete,
  onCovered,
  username,
}: {
  preparation: Promise<void>
  stage: number
  onRetry: () => void
  onComplete: () => void
  onCovered: () => void
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
  const [statusReady, setStatusReady] = useState(false)
  const message = validUsername(username) ? `Goodbye, ${username}` : 'Goodbye'
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
    if (stage < 1) return undefined
    const timer = setTimeout(() => {
      setTextReady(true)
      setPhase('waiting')
    }, 150)
    return () => clearTimeout(timer)
  }, [phase, reduced, stage])
  useLayoutEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  function covered() {
    if (started.current) return
    started.current = true
    setPhase('covered')
    onCovered()
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
      aria-label="Signing out"
      className={`${styles.overlay} ${reduced ? styles.reduced : ''}`}
      data-logout-phase={phase}
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
            <p role="alert">
              Unable to finish signing out and returning to Welcome. Please
              retry.
            </p>
            <button type="button" onClick={onRetry}>
              Retry
            </button>
          </div>
        </div>
      ) : (
        phase !== 'cover' &&
        stage >= 1 && (
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
              <LogoutThoughtLine
                stage={destinationReady ? 3 : stage}
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
