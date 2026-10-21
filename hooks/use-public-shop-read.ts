import { useEffect, useState } from 'react'

// Every refresh replaces public state; failures never retain stale entitled data.
export function usePublicShopRead<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  initial?: T
) {
  const [state, setState] = useState<{
    key: string
    data?: T
    error: string
    loading: boolean
  }>({ key, data: initial, error: '', loading: !initial })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    let version = 0
    let controller: AbortController | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    setState({ key, data: undefined, error: '', loading: true })
    const refresh = async () => {
      const current = ++version
      setState({ key, data: undefined, error: '', loading: true })
      controller?.abort()
      controller = new AbortController()
      clearTimeout(timer)
      try {
        const data = await load(controller.signal)
        if (!active || current !== version) return
        setState({ key, data, error: '', loading: false })
        const delay = Number(
          (data as { refreshAfterMs?: number })?.refreshAfterMs ?? 30000
        )
        timer = setTimeout(refresh, Math.max(100, Math.min(30000, delay)))
      } catch {
        if (active && current === version)
          setState({
            key,
            data: undefined,
            error: 'Unable to load Shops. Please retry.',
            loading: false,
          })
      }
    }
    refresh()
    window.addEventListener('focus', refresh)
    return () => {
      active = false
      version += 1
      controller?.abort()
      clearTimeout(timer)
      window.removeEventListener('focus', refresh)
    }
    // The serialized key owns the request's inputs and lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, retry])
  return {
    ...state,
    ...(state.key !== key ? { data: undefined, error: '', loading: true } : {}),
    retry: () => setRetry((value) => value + 1),
  }
}
