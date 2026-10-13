import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'

import { useMarketplaceSession } from '@/components/listings/marketplace-session'
import {
  acceptPreviewRequest,
  addPreviewRequest,
  expirePreviewRequests,
  getPreviewRequestSendGate,
  previewRequestScope,
  unfinishedRequestMessage,
  emptyInteractionPreview,
  isStagingOrderPreview,
  updatePreviewOrder,
  cancelPreviewRequest,
} from '@/lib/order-interaction-preview'
import type {
  PreviewOrderEvent,
  PreviewRole,
} from '@/lib/order-interaction-preview'
import { isRequestScheduleAvailable } from '@/lib/order-schedule-preview'
import type { OrderDetailVisual } from '@/lib/order-visual-preview'
import { deriveOrderWorkspaces } from '@/lib/order-workspaces'
import type { OrderWorkspace } from '@/lib/order-workspaces'

const Context = createContext<{
  viewerId: string | null
  role: PreviewRole | null
  setRole: (role: PreviewRole) => void
  enabled: boolean
  state: typeof emptyInteractionPreview
  selection: { id: string; workspace: OrderWorkspace } | null
  showList: () => void
  send: (
    conversationId: string,
    snapshot: OrderDetailVisual,
    replaceRequestId?: string
  ) => string | null
  cancelRequest: (
    requestId: string,
    role: PreviewRole,
    reason: string,
    note: string
  ) => void
  accept: (requestId: string, perspective: PreviewRole) => void
  open: (orderId: string, workspace?: OrderWorkspace) => void
  update: (orderId: string, event: PreviewOrderEvent, role: PreviewRole) => void
} | null>(null)

/** All simulated requests/orders live here. No storage, API, cookies or cross-session sync. */
export function OrderVisualProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<PreviewRole | null>(null)
  const [state, setReactState] = useState(emptyInteractionPreview)
  const latestState = useRef(state)
  const setState = useCallback(
    (update: typeof state | ((current: typeof state) => typeof state)) => {
      const next =
        typeof update === 'function' ? update(latestState.current) : update
      latestState.current = next
      setReactState(next)
    },
    []
  )
  const [selection, setSelection] = useState<{
    id: string
    workspace: OrderWorkspace
  } | null>(null)
  const session = useMarketplaceSession()
  const owner = useRef<string | null>(null)
  const acceptedIds = useRef(new Map<string, string>())
  const enabled =
    process.env.NEXT_PUBLIC_ORDER_PREVIEW === 'frozen-viewer' &&
    isStagingOrderPreview(
      process.env.NEXT_PUBLIC_MESSAGES_ENV,
      process.env.NEXT_PUBLIC_SUPABASE_URL
    )
  useEffect(() => {
    if (session.loading) return
    const next = session.seller?.id || null
    if (owner.current !== next) {
      setState(emptyInteractionPreview)
      setSelection(null)
      setRole(null)
      acceptedIds.current.clear()
    }
    owner.current = next
  }, [session.loading, session.seller?.id, setState])
  useEffect(() => {
    if (!enabled) return undefined
    const timer = setInterval(
      () => setState((current) => expirePreviewRequests(current, Date.now())),
      1000
    )
    return () => clearInterval(timer)
  }, [enabled, setState])
  const open = (id: string, workspace?: OrderWorkspace) => {
    const owned = deriveOrderWorkspaces(
      state.orders,
      session.seller?.id || null
    )
    const target =
      workspace ||
      (owned.purchases.some((order) => order.id === id) ? 'purchases' : 'sales')
    if (!owned[target].some((order) => order.id === id)) return
    setSelection({ id, workspace: target })
  }
  return (
    <Context.Provider
      value={{
        viewerId: session.seller?.id || null,
        role: enabled ? role : null,
        setRole: (next) => {
          if (enabled) setRole(next)
        },
        enabled,
        state: enabled ? state : emptyInteractionPreview,
        selection: enabled ? selection : null,
        showList: () => setSelection(null),
        send: (conversationId, snapshot, replaceRequestId) => {
          if (!enabled) return 'Local Order preview is unavailable.'
          const current = latestState.current
          const gate = getPreviewRequestSendGate(
            current,
            previewRequestScope(conversationId, snapshot),
            Date.now()
          )
          if (gate.blocked) return unfinishedRequestMessage
          if ((gate.active?.id || undefined) !== replaceRequestId)
            return 'The current request changed. Review the request before sending again.'
          const next = addPreviewRequest(
            current,
            crypto.randomUUID(),
            conversationId,
            snapshot,
            { createdAt: new Date().toISOString(), replaceRequestId }
          )
          if (next.requests.length === current.requests.length)
            return 'The current request changed. Review the request before sending again.'
          setState(next)
          return null
        },
        cancelRequest: (requestId, perspective, reason, note) => {
          if (enabled && (role || perspective) === 'seller')
            setState((current) =>
              cancelPreviewRequest(current, requestId, {
                role: perspective,
                reason,
                note,
                now: Date.now(),
              })
            )
        },
        accept: (requestId, perspective) => {
          if (!enabled || (role || perspective) !== 'buyer') return
          const current = latestState.current
          const existing = current.orders.find(
            (order) => order.requestId === requestId
          )
          if (existing) {
            open(existing.id)
            return
          }
          if (
            !current.requests.some(
              (request) =>
                request.id === requestId &&
                request.status === 'active' &&
                isRequestScheduleAvailable(request.snapshot.draft)
            )
          )
            return
          const request = current.requests.find(
            (value) => value.id === requestId
          )
          const viewerId = session.seller?.id
          if (!request || !viewerId) return
          // Existing Request creation is Seller-only. Capture its known participant identity
          // at acceptance without changing Messages/creation or fabricating a buyer UUID.
          const sellerId =
            request.snapshot.sellerId ||
            request.snapshot.listing.live?.seller.id ||
            viewerId
          const buyerId = request.snapshot.buyerId
          const id = acceptedIds.current.get(requestId) || crypto.randomUUID()
          acceptedIds.current.set(requestId, id)
          const now = Date.now()
          const next = acceptPreviewRequest(current, requestId, id, now)
          if (next === current) return
          setState({
            ...next,
            orders: next.orders.map((order) =>
              order.id === id ? { ...order, buyerId, sellerId } : order
            ),
          })
          setSelection({
            id,
            workspace: buyerId === viewerId ? 'purchases' : 'sales',
          })
        },
        open,
        update: (id, event, actorRole) => {
          if (enabled)
            setState((current) =>
              updatePreviewOrder(current, id, event, actorRole, Date.now())
            )
        },
      }}
    >
      {children}
    </Context.Provider>
  )
}

export function useOrderVisual() {
  const context = useContext(Context)
  if (!context)
    throw new Error('Order visual preview requires its Home provider')
  return context
}
