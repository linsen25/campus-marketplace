'use client'
/* eslint jsx-a11y/no-noninteractive-tabindex: off -- Labelled native step scroll region supports keyboard scrolling. */

// Adapted from the user-supplied useLayouts Multi-Step Form source.
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  AnimatePresence,
  motion,
  MotionConfig,
  useReducedMotion,
} from 'motion/react'
import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import useMeasure from 'react-use-measure'

import styles from './multi-step-form.module.css'

export type WizardStep = {
  title: string
  description: string
  content: ReactNode
}
export default function MultiStepForm({
  steps,
  onContinue,
  onStepChange,
  publishAction,
  disabled = false,
  embedded = false,
  contentSizedDesktop = false,
}: {
  steps: WizardStep[]
  onContinue: (step: number) => Promise<boolean>
  onStepChange?: () => void
  publishAction: ReactNode
  disabled?: boolean
  embedded?: boolean
  contentSizedDesktop?: boolean
}) {
  const [currentStep, setCurrentStep] = useState(0)
  const [direction, setDirection] = useState(1)
  const [ref, bounds] = useMeasure()
  const reduced = useReducedMotion()
  const heading = useRef<HTMLHeadingElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const scrollRegion = useRef<HTMLDivElement>(null)
  const previous = useRef(0)
  const advancing = useRef(false)
  useLayoutEffect(() => {
    if (previous.current === currentStep) return
    previous.current = currentStep
    onStepChange?.()
    const node = root.current
    if (embedded)
      scrollRegion.current?.scrollTo({
        top: 0,
        behavior: 'instant' as ScrollBehavior,
      })
    else if (node) {
      const owner = node.closest<HTMLElement>(
        '[data-listing-creation-scroll], [data-home-main]'
      )
      if (owner)
        owner.scrollTop +=
          node.getBoundingClientRect().top - owner.getBoundingClientRect().top
      else
        window.scrollTo({
          top: Math.max(0, window.scrollY + node.getBoundingClientRect().top),
          behavior: 'instant' as ScrollBehavior,
        })
    }
    heading.current?.focus({ preventScroll: true })
  }, [currentStep, onStepChange, embedded])
  const nextStep = async () => {
    if (disabled || advancing.current || currentStep === steps.length - 1)
      return
    advancing.current = true
    try {
      if (await onContinue(currentStep)) {
        setDirection(1)
        setCurrentStep((step) => step + 1)
      }
    } finally {
      advancing.current = false
    }
  }
  const variants = {
    initial: (travel: number) => ({
      x: reduced ? '0%' : `${110 * travel}%`,
      opacity: reduced ? 1 : 0,
    }),
    animate: { x: '0%', opacity: 1 },
    exit: (travel: number) => ({
      x: reduced ? '0%' : `${-110 * travel}%`,
      opacity: reduced ? 1 : 0,
    }),
  }
  return (
    <MotionConfig
      reducedMotion="user"
      transition={{ duration: reduced ? 0 : 0.5, type: 'spring', bounce: 0 }}
    >
      <div
        className={`${styles.host} ${embedded ? styles.embedded : ''} ${
          contentSizedDesktop ? styles.contentSizedDesktop : ''
        }`}
        ref={root}
        data-multi-step-form={currentStep}
      >
        <div className={styles.card}>
          {/* The measured viewport already animates size. Projecting a second
              scale onto its ancestors would distort the measured content. */}
          <motion.div className={styles.frame} layout={!contentSizedDesktop}>
            <header className={styles.header}>
              <div>
                <h2 ref={heading} tabIndex={-1}>
                  {steps[currentStep].title}
                </h2>
                <p>{steps[currentStep].description}</p>
              </div>
              <div
                className={styles.progress}
                role="progressbar"
                aria-label="Listing creation progress"
                aria-valuemin={1}
                aria-valuemax={steps.length}
                aria-valuenow={currentStep + 1}
              >
                {steps.map((step, index) => (
                  <span
                    key={step.title}
                    data-current={index === currentStep || undefined}
                  />
                ))}
              </div>
            </header>
            <motion.div
              animate={{ height: bounds.height > 0 ? bounds.height : 'auto' }}
              ref={scrollRegion}
              role={embedded ? 'region' : undefined}
              aria-label={
                embedded ? `${steps[currentStep].title} content` : undefined
              }
              tabIndex={embedded ? 0 : undefined}
              data-listing-wizard-scroll={embedded || undefined}
              className={styles.viewport}
              transition={{
                type: 'spring',
                bounce: 0,
                duration: reduced ? 0 : 0.5,
              }}
            >
              <div ref={ref}>
                <div className={styles.content}>
                  <AnimatePresence
                    mode="popLayout"
                    initial={false}
                    custom={direction}
                  >
                    <motion.div
                      key={currentStep}
                      variants={variants}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      custom={direction}
                      className={styles.step}
                    >
                      {steps[currentStep].content}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
            <footer className={styles.footer}>
              <button
                type="button"
                className={styles.back}
                disabled={currentStep === 0 || disabled}
                onClick={() => {
                  setDirection(-1)
                  setCurrentStep((step) => step - 1)
                }}
              >
                <ChevronLeft size={16} />
                Back
              </button>
              {currentStep === steps.length - 1 ? (
                publishAction
              ) : (
                <button
                  type="button"
                  className={styles.forward}
                  disabled={disabled}
                  onClick={nextStep}
                >
                  Continue
                  <ChevronRight size={16} />
                </button>
              )}
            </footer>
          </motion.div>
        </div>
      </div>
    </MotionConfig>
  )
}
