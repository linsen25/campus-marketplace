// Controlled transport fixture only; never used by application code or persisted.
module.exports = function fixture(access = 'plus', range = 'month') {
  const now = new Date(),
    start = now.toISOString().slice(0, 10),
    end = new Date(now.getTime() + 86400000).toISOString().slice(0, 10)
  const core = {
    bounds: { start, end, observedUntil: now.toISOString() },
    revenueCents: 10000,
    knownExpensesCents: 2500,
    estimatedProfitCents: 7500,
    sold: 1,
    missingCostCount: 0,
    orders: { completed: 1, pending: 2, cancelled: 0 },
    breakdown: [{ name: 'Product Cost', cents: 2500 }],
    trend: [
      {
        date: start,
        revenue: 100,
        expenses: 25,
        profit: 75,
        sold: 1,
        impressions: null,
        visits: null,
      },
    ],
    coverage: {
      knownSalesCents: 10000,
      uuPayCents: 6000,
      externalCents: 4000,
      missingProvenanceCount: 0,
      currencyMismatchCount: 0,
      invalidFactCount: 0,
      refundedCount: 0,
      excludedRefundedItemCents: 0,
      expiredCount: 0,
      authenticatedListingOpens: 3,
      authenticatedShopOpens: 2,
      productCount: 1,
      productLimit: 20,
      grossItemValueCents: 10000,
      profitComplete: true,
    },
  }
  return {
    source: 'real',
    timezone: 'America/Toronto',
    asOf: now.toISOString(),
    range,
    access,
    membershipStatus: access === 'trial' ? 'trial' : 'active',
    nextBoundaryAt: new Date(now.getTime() + 86400000).toISOString(),
    current: core,
    previous: JSON.parse(JSON.stringify(core)),
    pro: {
      products: [
        {
          id: '19111111-1111-4111-8111-111111111111',
          name: 'Local product',
          image: '',
          sold: 1,
          revenueCents: 10000,
          costCents: 2500,
          directExpenseCents: 0,
          profitCents: 7500,
          margin: 75,
        },
      ],
      topProducts: [
        {
          id: '19111111-1111-4111-8111-111111111111',
          name: 'Local product',
          sold: 1,
        },
      ],
      distribution: [{ name: 'Local product', cents: 10000 }],
      featured:
        access === 'plus'
          ? null
          : { available: false, reason: 'Not collected' },
    },
  }
}
