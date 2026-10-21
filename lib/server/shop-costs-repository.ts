import { ListingApiError } from '@/lib/listing-validation'
import { requireMarketplaceUser } from '@/lib/server/marketplace-auth'
import { messageUuid } from '@/lib/server/messages-environment'
import {
  costAmount,
  costFields,
  costRevision,
  expenseFields,
} from '@/lib/shop-costs'
import { createMarketplaceClient } from '@/lib/supabase/server'
import type { MarketplaceContext } from '@/lib/supabase/server'
import type {
  ShopCost,
  ShopExpensePage,
  ShopExpenseRecord,
} from '@/types/shop-costs'

const fields = ['amountCents', 'currency', 'on', 'kind', 'description']
const unavailable = () =>
  new ListingApiError(
    'Private Shop records are unavailable. Please retry.',
    503
  )
function projectCost(v: ShopCost): ShopCost {
  if (!v || v.currency !== 'CAD') throw unavailable()
  return {
    listingId: messageUuid(v.listingId),
    shopId: messageUuid(v.shopId),
    amountCents: costAmount(v.amountCents, true),
    currency: 'CAD',
    revision: costRevision(v.revision, true),
    updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : null,
  }
}
function projectExpense(v: ShopExpenseRecord): ShopExpenseRecord {
  if (!v || typeof v.createdAt !== 'string' || typeof v.updatedAt !== 'string')
    throw unavailable()
  return {
    ...expenseFields(v),
    id: messageUuid(v.id),
    shopId: messageUuid(v.shopId),
    revision: costRevision(v.revision),
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    deletedAt: typeof v.deletedAt === 'string' ? v.deletedAt : null,
  }
}
export function createShopCostsRepository(context: MarketplaceContext) {
  const client = createMarketplaceClient(context)
  async function rpc(name: string, args: Record<string, unknown>) {
    await requireMarketplaceUser(client)
    const { data, error } = await client.rpc(name, args)
    if (error) {
      if (error.code === '42501')
        throw new ListingApiError('Private Shop record unavailable.', 404)
      if (['40001', '23505'].includes(error.code))
        throw new ListingApiError(
          'This record changed. Reload before saving again.',
          409
        )
      if (
        [
          '23514',
          '23502',
          '22P02',
          '22007',
          '22008',
          '22023',
          '22003',
        ].includes(error.code)
      )
        throw new ListingApiError('Check the cost or expense fields.')
      throw unavailable()
    }
    return data
  }
  return {
    async cost(listingId: unknown, input?: unknown): Promise<ShopCost> {
      const id = messageUuid(listingId)
      let change = null
      if (input !== undefined) {
        const v = costFields(input, ['amountCents', 'currency', 'revision'])
        if (v.currency !== 'CAD')
          throw new ListingApiError('Currency must be CAD.')
        change = {
          amountCents: costAmount(v.amountCents, true),
          currency: 'CAD',
          revision: costRevision(v.revision, true),
        }
      }
      return projectCost(
        await rpc('marketplace_shop_product_cost', {
          p_listing_id: id,
          p_change: change,
        })
      )
    },
    async expenses(beforeId?: unknown): Promise<ShopExpensePage> {
      const data = await rpc('marketplace_shop_expenses', {
        p_action: 'list',
        p_input:
          beforeId === undefined ? {} : { beforeId: messageUuid(beforeId) },
      })
      if (!data || !Array.isArray(data.expenses) || data.expenses.length > 20)
        throw unavailable()
      return {
        expenses: data.expenses.map(projectExpense),
        nextCursor:
          data.nextCursor === null ? null : messageUuid(data.nextCursor),
        shopId: messageUuid(data.shopId),
      }
    },
    async saveExpense(
      action: 'create' | 'delete' | 'update',
      input: unknown,
      pathId?: unknown
    ): Promise<ShopExpenseRecord> {
      const v = costFields(
        input,
        action === 'delete'
          ? ['id', 'revision']
          : ['id', ...fields, ...(action === 'update' ? ['revision'] : [])]
      )
      const id = messageUuid(v.id)
      if (pathId !== undefined && messageUuid(pathId) !== id)
        throw new ListingApiError('Expense ID mismatch.')
      const data = {
        id,
        ...(action === 'delete' ? {} : expenseFields(v)),
        ...(action === 'create' ? {} : { revision: costRevision(v.revision) }),
      }
      return projectExpense(
        await rpc('marketplace_shop_expenses', {
          p_action: action,
          p_input: data,
        })
      )
    },
  }
}
