import { useEffect, useState } from 'react'

import { formatOrderCountdown } from '@/lib/order-presentation-preview'
/** Presentation only. Never advances an Order or invokes a domain/API action. */
export function OrderCountdown({
  expiresAt,
  protection = false,
  suffix = 'remaining',
  serverOffsetMs = 0,
}: {
  expiresAt: number
  protection?: boolean
  suffix?: string
  serverOffsetMs?: number
}) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [expiresAt])
  return (
    <output data-order-countdown={protection ? 'protection' : 'reservation'}>
      {formatOrderCountdown(expiresAt, now + serverOffsetMs, protection)}{' '}
      {suffix}
    </output>
  )
}
