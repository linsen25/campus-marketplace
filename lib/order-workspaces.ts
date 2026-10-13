import type { PreviewOrder, PreviewRole } from './order-interaction-preview'

export type OrderWorkspace = 'purchases' | 'sales'
export const orderWorkspaceLabels = { purchases: 'Purchases', sales: 'Sales' }
export function orderWorkspaceRole(workspace: OrderWorkspace): PreviewRole {
  return workspace === 'purchases' ? 'buyer' : 'seller'
}
/** Relationship-based collections from the one ephemeral store; unknown identity fails closed. */
export function deriveOrderWorkspaces(
  orders: readonly PreviewOrder[],
  viewerId: string | null
) {
  if (!viewerId) return { purchases: [], sales: [] }
  return {
    purchases: orders.filter((order) => order.buyerId === viewerId),
    sales: orders.filter((order) => order.sellerId === viewerId),
  }
}
