import type { GetServerSideProps } from 'next'
import Head from 'next/head'

import { Container } from '@/components/container/container'
import { ListingForm } from '@/components/listings/listing-form'
import { getMarketplaceSession } from '@/lib/server/marketplace-auth'
import { Link } from '@ui/link/link'

export default function NewListingPage() {
  return (
    <>
      <Head>
        <title>Post listing | Campus Marketplace</title>
      </Head>
      <main className="py-8 laptop:py-12">
        <Container>
          <div className="flex flex-col gap-6">
            <Link href="/listings" className="underline">
              Back to listings
            </Link>
            <h1 className="text-2xl font-bold">Sell an item</h1>
            <ListingForm />
          </div>
        </Container>
      </main>
    </>
  )
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
  return { props: {} }
}
