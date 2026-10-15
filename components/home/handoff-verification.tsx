import { ArrowRight } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useId, useState } from 'react'

import FluidTabs from '@/components/animata/tabs/fluid-tabs'
import success from '@/components/listings/create-success.module.css'
import { StatefulButton } from '@/components/velora/stateful-button'

import styles from './handoff-credential.module.css'
import { SellerHandoffForm } from './order-flow-actions'

/** Decorative scanner frame only: never receives or encodes a credential. */
function ScannerIllustration() {
  return (
    <div className={styles.scanVisual} aria-hidden={true}>
      <svg viewBox="0 0 120 120" fill="none">
        <path
          d="M8 32V8h24m56 0h24v24m0 56v24H88m-56 0H8V88"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M28 28h18v18H28zm46 0h18v18H74zM28 74h18v18H28zM56 28v16m0 12h16m14 0h6M28 56h16m12 16v20m14-20h22m-8 8v12m-14-6h6"
          stroke="currentColor"
          strokeWidth="5"
        />
      </svg>
      <span className={styles.scanLine} />
    </div>
  )
}

export function HandoffVerification({
  disabled,
  numericRetryAt,
  onOpenScanner,
  onVerify,
}: {
  disabled: boolean
  numericRetryAt?: string
  onOpenScanner: () => void
  onVerify: (code: string) => Promise<void>
}) {
  const [mode, setMode] = useState(0)
  const id = useId()
  const reduced = useReducedMotion()
  return (
    <section className={styles.method} aria-label="Handoff verification method">
      <FluidTabs activeIndex={mode} onActiveIndexChange={setMode}>
        <FluidTabs.List aria-label="Verification method">
          {['Scan QR', 'Enter code'].map((label, index) => (
            <FluidTabs.Tab key={label} aria-controls={`${id}-${index}`}>
              <FluidTabs.Label>{label}</FluidTabs.Label>
            </FluidTabs.Tab>
          ))}
        </FluidTabs.List>
      </FluidTabs>
      <div className={styles.methodContent}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={mode}
            id={`${id}-${mode}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.14 }}
          >
            {mode === 0 ? (
              <div className={styles.scanIntro}>
                <ScannerIllustration />
                <div>
                  <h5>Scan buyer&apos;s QR</h5>
                  <p>
                    Point your camera at the Buyer&apos;s handoff QR after
                    inspection.
                  </p>
                  <span className={styles.forwardAction}>
                    <StatefulButton
                      className={success.createButton}
                      disabled={disabled}
                      onClick={() => Promise.resolve().then(onOpenScanner)}
                    >
                      <span className={styles.forwardLabel}>
                        Open scanner <ArrowRight size={16} aria-hidden={true} />
                      </span>
                    </StatefulButton>
                  </span>
                </div>
              </div>
            ) : (
              <section aria-label="6-digit handoff verification">
                <h5>6-digit code</h5>
                {numericRetryAt && (
                  <p role="status">
                    Numeric entry is temporarily locked until{' '}
                    {new Date(numericRetryAt).toLocaleString()}. You can still
                    scan the QR.
                  </p>
                )}
                <SellerHandoffForm disabled={disabled} onVerify={onVerify} />
              </section>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  )
}
