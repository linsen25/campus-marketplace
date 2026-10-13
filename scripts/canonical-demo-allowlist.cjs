// Explicit identities and Listings, never inferred from a name, timestamp or prefix.
module.exports = {
  sellers: [
    '2ce144f6-9be2-4ca2-b9e9-214ee01c8ef2',
    'eb0fc272-b774-4253-af20-dd53713222a0',
  ],
  buyers: [
    '91286dfc-03a2-4179-aa3e-39cea1387d3e',
    '8a475b40-46a1-4475-bbb8-7c0f754c786e',
  ],
  listings: {
    '90d144b0-7bf1-4e1e-9b63-8aa5c4b3ce60':
      '2ce144f6-9be2-4ca2-b9e9-214ee01c8ef2',
    '5e1234d0-0f67-4af1-a036-0c18e4a8693a':
      '2ce144f6-9be2-4ca2-b9e9-214ee01c8ef2',
    'f0629930-524c-452c-91e4-c47a3a231ae6':
      'eb0fc272-b774-4253-af20-dd53713222a0',
    '82680659-1f93-405c-a0b6-cebe52011498':
      'eb0fc272-b774-4253-af20-dd53713222a0',
    'cbbc071e-4ea5-447e-b048-e700187234f9':
      'eb0fc272-b774-4253-af20-dd53713222a0',
  },
  protectedListings: [
    'd5fcc2b1-2369-4757-b604-cd98f1f0e650',
    '0596733b-b296-4d36-a24a-fc5eb4a01179',
  ],
  // Additional manual/history rows on an approved Listing must be registered here
  // before allowing that Listing's future transaction reset.
  protectedOffers: [],
  protectedOrders: [],
}
