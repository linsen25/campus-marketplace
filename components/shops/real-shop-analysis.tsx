import { AnimatePresence } from 'framer-motion'
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { useMarketplaceSession } from '@/components/listings/marketplace-session'
import type { ShopAnalysisRange } from '@/lib/shop-analysis'
import { getShopAnalysis } from '@/lib/shop-analysis-api'
import { saveShopExpense } from '@/lib/shop-costs-api'
import type { RealShopAnalysis } from '@/types/shop-analysis'

import { ExpenseDialog } from './shop-expense-dialog'

export function RealShopAnalysisView({
  children,
}: {
  children: (state: {
    data: RealShopAnalysis | null
    loading: boolean
    error: string
    range: ShopAnalysisRange
    changeRange: (value: string) => void
    retry: () => void
    addExpense: () => void
  }) => ReactNode
}) {
  const session = useMarketplaceSession()
  return (
    <OwnerAnalysis
      key={session.seller?.id || 'signed-out'}
      owner={session.loading ? null : session.seller?.id || null}
      sessionLoading={session.loading}
      sessionError={session.error}
    >
      {children}
    </OwnerAnalysis>
  )
}
function OwnerAnalysis({
  owner,
  sessionLoading,
  sessionError,
  children,
}: {
  owner: string | null
  sessionLoading: boolean
  sessionError: string
  children: Parameters<typeof RealShopAnalysisView>[0]['children']
}) {
  const [range, setRange] = useState<ShopAnalysisRange>('month')
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{
    data: RealShopAnalysis | null
    error: string
    loading: boolean
  }>({ data: null, error: '', loading: true })
  const [expenseId, setExpenseId] = useState<string | null>(null)
  const retry = useCallback(() => setAttempt((x) => x + 1), [])
  useEffect(() => {
    if (sessionLoading) return undefined
    if (!owner || sessionError) {
      setState({
        data: null,
        loading: false,
        error:
          sessionError || 'Log in with an eligible Shop to view real Analysis.',
      })
      return undefined
    }
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const requestedAt = performance.now()
    setState({ data: null, error: '', loading: true })
    getShopAnalysis(range)
      .then((data) => {
        if (!active) return
        const expiry =
          Date.parse(data.nextBoundaryAt) -
          Date.parse(data.asOf) -
          (performance.now() - requestedAt)
        if (expiry <= 0) {
          setState({
            data: null,
            loading: false,
            error: 'Shop access changed. Retry to refresh your membership.',
          })
          return
        }
        setState({ data, loading: false, error: '' })
        timer = setTimeout(() => {
          if (active) {
            setState({ data: null, error: '', loading: true })
            retry()
          }
        }, Math.min(expiry, 2147483647))
      })
      .catch(() => {
        if (active)
          setState({
            data: null,
            loading: false,
            error:
              'Shop analysis is unavailable or your membership does not allow access. Please retry.',
          })
      })
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [owner, range, attempt, retry, sessionLoading, sessionError])
  useEffect(() => {
    const refresh = () => {
      setState({ data: null, error: '', loading: true })
      retry()
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [retry])
  const changeRange = (value: string) => {
    if (
      value !== range &&
      ['week', 'month', 'last-month', 'year'].includes(value)
    ) {
      setState({ data: null, error: '', loading: true })
      setRange(value as ShopAnalysisRange)
    }
  }
  return (
    <>
      {children({
        ...state,
        data: owner && !sessionLoading && !sessionError ? state.data : null,
        loading: sessionLoading || state.loading,
        range,
        changeRange,
        retry,
        addExpense: () => setExpenseId(crypto.randomUUID()),
      })}
      <AnimatePresence>
        {expenseId && (
          <ExpenseDialog
            key={expenseId}
            onClose={() => setExpenseId(null)}
            onSave={async (fields) => {
              const result = await saveShopExpense(expenseId, fields)
              if (result.deletedAt)
                throw Error(
                  'This expense was already deleted. Close and retry.'
                )
              retry()
            }}
          />
        )}
      </AnimatePresence>
    </>
  )
}
