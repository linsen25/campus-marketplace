import { AnimatePresence, m, useReducedMotion } from 'framer-motion'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { ActionRow } from '@/components/ui/action-row'
import { Confetti } from '@/components/ui/confetti'
import type { ConfettiRef } from '@/components/ui/confetti'
import { DynamicAction } from '@/components/ui/dynamic-action'
import { FadingDialog } from '@/components/ui/fading-dialog'

import styles from './create-success.module.css'

type Choice = 'another' | 'back'
type Phase = 'celebrating' | 'checkmark' | 'darkening' | 'decision' | 'exit'

export function CreateSuccess({
  workspace,
  onReset,
  onDone,
}: {
  workspace: HTMLElement | null
  onReset: () => void
  onDone: (choice: Choice) => void
}) {
  const reduced = useReducedMotion()
  const [phase, setPhase] = useState<Phase>('checkmark')
  const [dialog, setDialog] = useState(false)
  const [particles, setParticles] = useState(false)
  const [area, setArea] = useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)
  const confetti = useRef<ConfettiRef>(null)
  const choice = useRef<Choice | null>(null)
  const finished = useRef(false)
  useLayoutEffect(() => {
    const app = document.getElementById('__next')
    const wasInert = app?.hasAttribute('inert')
    app?.setAttribute('inert', '')
    const measure = () => {
      const main = workspace?.closest('main') ?? workspace
      if (!main) return
      const rect = main.getBoundingClientRect()
      const css = getComputedStyle(main)
      const header = main.querySelector(
        '[data-home-section-header]'
      ) as HTMLElement | null
      const top = Math.max(
        0,
        rect.top + parseFloat(css.paddingTop) + (header?.offsetHeight ?? 0) + 24
      )
      const bottom = Math.min(
        window.innerHeight -
          (window.innerWidth < 1024 ? parseFloat(css.paddingBottom) : 0),
        rect.bottom - parseFloat(css.paddingBottom)
      )
      setArea({
        left: rect.left + parseFloat(css.paddingLeft),
        top,
        width:
          main.clientWidth -
          parseFloat(css.paddingLeft) -
          parseFloat(css.paddingRight),
        height: Math.max(1, bottom - top),
      })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('resize', measure)
      if (!wasInert) app?.removeAttribute('inert')
    }
  }, [workspace])
  useEffect(() => {
    const timer = setTimeout(() => setPhase('darkening'), 250)
    return () => clearTimeout(timer)
  }, [])
  useEffect(() => {
    if (phase !== 'celebrating') return undefined
    if (reduced) {
      setPhase('decision')
      setDialog(true)
      return undefined
    }
    setParticles(true)
    const enter = setTimeout(() => {
      setPhase('decision')
      setDialog(true)
    }, 550)
    return () => clearTimeout(enter)
  }, [phase, reduced])
  // Keep the finite particle lifetime independent of the dialog's entrance.
  useEffect(() => {
    if (!particles) return undefined
    confetti.current
      ?.fire({
        particleCount: 90,
        spread: 100,
        startVelocity: 24,
        gravity: 0.65,
        ticks: 48,
        scalar: 0.8,
        colors: ['#c29aed', '#ffd786', '#f0a5c3'],
        origin: { x: 0.5, y: 0.5 },
        disableForReducedMotion: true,
      })
      .catch(() => {})
    const end = setTimeout(() => setParticles(false), 800)
    return () => clearTimeout(end)
  }, [particles])
  const choose = (next: Choice) => {
    if (choice.current) return
    choice.current = next
    setDialog(false)
  }
  return createPortal(
    <div className={styles.layer} data-create-success-phase={phase}>
      <m.div
        className={styles.backdrop}
        data-create-success-backdrop="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: phase === 'checkmark' || phase === 'exit' ? 0 : 1 }}
        transition={{ duration: reduced ? 0.05 : 0.2, ease: 'easeOut' }}
        onAnimationComplete={() => {
          if (phase === 'darkening') setPhase('celebrating')
          if (phase === 'exit' && choice.current && !finished.current) {
            finished.current = true
            onDone(choice.current)
          }
        }}
      />
      {particles && area && (
        <Confetti
          ref={confetti}
          manualstart={true}
          className={styles.canvas}
          style={area}
          aria-hidden={true}
          data-create-confetti="true"
        />
      )}
      <AnimatePresence
        onExitComplete={() => {
          if (!choice.current) return
          if (choice.current === 'another') onReset()
          setParticles(false)
          setPhase('exit')
        }}
      >
        {dialog && (
          <FadingDialog
            className={styles.dialog}
            aria-labelledby="listing-created-title"
          >
            <h3 id="listing-created-title">Listing created</h3>
            <p>Your listing is now live in Marketplace.</p>
            <ActionRow>
              <DynamicAction
                variant="blue"
                footer={true}
                onClick={() => choose('back')}
              >
                Back to My Listings
              </DynamicAction>
              <DynamicAction
                variant="green"
                footer={true}
                onClick={() => choose('another')}
              >
                Create another
              </DynamicAction>
            </ActionRow>
          </FadingDialog>
        )}
      </AnimatePresence>
    </div>,
    document.body
  )
}
