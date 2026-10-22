import type { GetServerSideProps } from 'next'

import { marketplaceAuthEntry } from '@/lib/marketplace-auth'

export default function SignInPage() {
  return null
}

export const getServerSideProps: GetServerSideProps = async ({ query }) => ({
  redirect: {
    destination: marketplaceAuthEntry(query.next),
    permanent: false,
  },
})
