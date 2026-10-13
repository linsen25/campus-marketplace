import { useCallback, useEffect, useRef, useState } from 'react'

import { useMarketplaceSession } from '@/components/listings/marketplace-session'
import { marketplaceRequest } from '@/lib/listings-api'
import type { FinancialCapabilities } from '@/types/financial-capabilities'

export function useFinancialCapabilities() {
  const { seller, loading: sessionLoading } = useMarketplaceSession()
  const userId = seller?.id
  const [result, setResult] = useState<{
    userId: string
    data: FinancialCapabilities
  } | null>(null)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const version = useRef(0)
  const refresh = useCallback(async () => {
    if (!userId) return
    const scope = generation.current
    const request = ++version.current
    try {
      const data = await marketplaceRequest<FinancialCapabilities>(
        '/api/financial-capabilities',
        'GET'
      )
      if (scope === generation.current && request === version.current) {
        setResult({ userId, data })
        setError('')
      }
    } catch {
      if (scope === generation.current && request === version.current)
        setError('Unable to load financial capabilities. Please retry.')
    }
  }, [userId])
  useEffect(() => {
    generation.current++
    setResult(null)
    setError('')
    if (!userId) return undefined
    const update = () => {
      refresh().catch(() => {})
    }
    const clear = () => {
      generation.current++
      setResult(null)
    }
    update()
    window.addEventListener('focus', update)
    window.addEventListener('marketplace-financial-changed', update)
    window.addEventListener('marketplace-session-ended', clear)
    return () => {
      clear()
      window.removeEventListener('focus', update)
      window.removeEventListener('marketplace-financial-changed', update)
      window.removeEventListener('marketplace-session-ended', clear)
    }
  }, [userId, refresh])
  const data = result && result.userId === userId ? result.data : null
  return {
    data,
    error,
    refresh,
    loading: sessionLoading || (!data && !error && Boolean(userId)),
  }
}
