import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useRef, useState } from 'react'

import { StatefulButton } from '@/components/velora/stateful-button'
import { validHandoffQr } from '@/lib/handoff'
import { generateHandoffQr } from '@/lib/order-flow-api'
import type {
  HandoffCredential,
  HandoffQrCredential,
} from '@/lib/order-flow-api'

import styles from './handoff-credential.module.css'
import orderStyles from './order-detail-preview.module.css'

export function BuyerHandoffCredential({
  credential,
  orderId,
}: {
  credential: HandoffCredential | null | undefined
  orderId: string
}) {
  const [visible, setVisible] = useState(false)
  const [qr, setQr] = useState<{
    value: HandoffQrCredential
    receivedAt: number
  }>()
  const [remaining, setRemaining] = useState(0)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const command = useRef<string>()
  const generation = useRef(0)
  useEffect(
    () => () => {
      generation.current++
    },
    []
  )
  useEffect(() => {
    if (!qr) return undefined
    const tick = () =>
      setRemaining(
        Math.max(
          0,
          Math.ceil(
            (Date.parse(qr.value.expiresAt) -
              Date.parse(qr.value.serverTime) -
              (performance.now() - qr.receivedAt)) /
              1000
          )
        )
      )
    tick()
    const timer = setInterval(tick, 250)
    return () => clearInterval(timer)
  }, [qr])
  const generate = async () => {
    if (busy.current) return
    busy.current = true
    const current = generation.current
    if (!command.current) command.current = crypto.randomUUID()
    setError('')
    try {
      const value = await generateHandoffQr(orderId, command.current)
      if (
        !value.available ||
        !validHandoffQr(value.qrToken) ||
        !Number.isFinite(Date.parse(value.expiresAt)) ||
        !Number.isFinite(Date.parse(value.serverTime))
      )
        throw Error('Unable to load the handoff QR. Try again.')
      if (generation.current === current) {
        setQr({ value, receivedAt: performance.now() })
        setRemaining(
          Math.max(
            0,
            Math.ceil(
              (Date.parse(value.expiresAt) - Date.parse(value.serverTime)) /
                1000
            )
          )
        )
        command.current = undefined
      }
    } catch (failure) {
      if (generation.current === current)
        setError(
          'Unable to generate the handoff QR. Retry or use the 6-digit code.'
        )
      throw failure
    } finally {
      busy.current = false
    }
  }
  if (!credential?.available || !/^[0-9]{6}$/.test(credential.code || ''))
    return <p>Waiting for the server-issued handoff credential.</p>
  const code = credential.code!
  return (
    <section
      className={styles.credential}
      aria-label="Buyer handoff credential"
    >
      <p className={styles.safety}>
        Show this to the Seller only after inspecting the item and when you are
        ready to complete handoff.
      </p>
      <div className={styles.qrSlot} aria-label="Handoff QR area">
        {qr && remaining > 0 ? (
          <>
            <div
              className={styles.qr}
              role="img"
              aria-label="Handoff QR. Show to the Seller only after inspection."
            >
              <QRCodeSVG
                value={qr.value.qrToken}
                size={240}
                level="M"
                marginSize={4}
                bgColor="#ffffff"
                fgColor="#000000"
              />
            </div>
            <p role="timer">
              Valid for {Math.floor(remaining / 60)}:
              {String(remaining % 60).padStart(2, '0')}
            </p>
          </>
        ) : (
          <>
            {qr && <p>QR expired</p>}
            <StatefulButton
              className={styles.generateAction}
              onClick={generate}
            >
              {qr ? 'Generate new QR code' : 'Generate QR code'}
            </StatefulButton>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
      <section
        className={orderStyles.codePanel}
        aria-label="6-digit handoff code"
      >
        <h5>6-digit code</h5>
        <div className={styles.codeValue}>
          <output className={orderStyles.code} data-handoff-code={true}>
            {visible
              ? `${code.slice(0, 3)} ${code.slice(3)}`
              : '\u2022\u2022\u2022 \u2022\u2022\u2022'}
          </output>
          <button
            type="button"
            className={styles.codeReveal}
            aria-label={visible ? 'Hide code' : 'Show code'}
            aria-pressed={visible}
            onClick={() => setVisible((v) => !v)}
          >
            {visible ? (
              <EyeOffIcon aria-hidden={true} />
            ) : (
              <EyeIcon aria-hidden={true} />
            )}
          </button>
        </div>
      </section>
    </section>
  )
}
