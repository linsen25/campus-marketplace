import { marketplaceRequest } from '@/lib/listings-api'
import type {
  ShopCost,
  ShopExpenseFields,
  ShopExpensePage,
  ShopExpenseRecord,
} from '@/types/shop-costs'

export const getShopCost = (listingId: string) =>
  marketplaceRequest<ShopCost>(
    `/api/shop/costs?listingId=${encodeURIComponent(listingId)}`,
    'GET'
  )
export const saveShopCost = (cost: ShopCost, amountCents: number | null) =>
  marketplaceRequest<ShopCost>(
    `/api/shop/costs?listingId=${encodeURIComponent(cost.listingId)}`,
    'PATCH',
    { amountCents, currency: 'CAD', revision: cost.revision }
  )
export const getShopExpenses = (beforeId?: string) =>
  marketplaceRequest<ShopExpensePage>(
    `/api/shop/expenses${
      beforeId ? `?beforeId=${encodeURIComponent(beforeId)}` : ''
    }`,
    'GET'
  )
export const saveShopExpense = (
  id: string,
  fields: ShopExpenseFields,
  revision?: number
) =>
  marketplaceRequest<ShopExpenseRecord>(
    `/api/shop/expenses${
      revision === undefined ? '' : `/${encodeURIComponent(id)}`
    }`,
    revision === undefined ? 'POST' : 'PATCH',
    { id, ...fields, ...(revision === undefined ? {} : { revision }) }
  )
export const deleteShopExpense = (expense: ShopExpenseRecord) =>
  marketplaceRequest<ShopExpenseRecord>(
    `/api/shop/expenses/${encodeURIComponent(expense.id)}`,
    'DELETE',
    { id: expense.id, revision: expense.revision }
  )
