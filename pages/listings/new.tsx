import type { GetServerSideProps } from 'next'

import { getMarketplaceSession } from '@/lib/server/marketplace-auth'
/** Legacy entry resolves to the single management-owned creation sheet. */
export default function NewListingPage() {
  return null
}
export const getServerSideProps: GetServerSideProps = async (context) => {
  const seller = await getMarketplaceSession(context)
  if (!seller)
    return {
      redirect: {
        destination: '/auth/sign-in?next=/listings/new',
        permanent: false,
      },
    }
  return {
    redirect: { destination: '/home?section=create-listing', permanent: false },
  }
}
