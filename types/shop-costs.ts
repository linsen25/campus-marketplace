export type ShopCost = {
  listingId: string
  shopId: string
  amountCents: number | null
  currency: 'CAD'
  revision: number
  updatedAt: string | null
}
export type ShopExpenseFields = {
  amountCents: number
  currency: 'CAD'
  on: string
  kind: 'Marketing' | 'Other' | 'Packaging'
  description: string
}
export type ShopExpenseRecord = ShopExpenseFields & {
  id: string
  shopId: string
  revision: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}
export type ShopExpensePage = {
  expenses: ShopExpenseRecord[]
  nextCursor: string | null
  shopId: string
}
