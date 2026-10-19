/** Presentation contexts; never publication eligibility or a client channel override. */
export const listingWizardModes = {
  resale: {
    heading: 'Create Resale',
    details: 'Listing Details',
    publish: 'Publish Listing',
    review: 'Resale Listing',
    destination: '/home?section=my-listings',
    serviceFee:
      'UU Resale service fee: CA$0. Selling through UU Resale is free.',
  },
  shop: {
    heading: 'Add Product',
    details: 'Product Details',
    publish: 'Publish Product',
    review: 'Shop Product',
    destination: '/home?section=my-shop',
    serviceFee: '',
  },
} as const
