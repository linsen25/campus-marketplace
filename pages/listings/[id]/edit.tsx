import type { GetServerSideProps } from 'next'
import Head from 'next/head'

import { Container } from '@/components/container/container'
import { ListingForm } from '@/components/listings/listing-form'
import { getListing, getMyListings } from '@/lib/listings-api'
import { getMarketplaceSession } from '@/lib/server/marketplace-auth'
import type { Listing } from '@/types/listing'
import { Link } from '@ui/link/link'

type EditListingPageProps = { listing: Listing }

export default function EditListingPage({ listing }: EditListingPageProps) {
  return (
    <>
      <Head>
        <title>Edit {listing.title} | Campus Marketplace</title>
      </Head>
      <main className="py-8 laptop:py-12">
        <Container>
          <div className="flex flex-col gap-6">
            <Link href="/profile/listings" className="underline">
              Back to My Listings
            </Link>
            <h1 className="text-2xl font-bold">Edit listing</h1>
            <ListingForm
              key={listing.id + listing.updatedAt}
              listing={listing}
            />
          </div>
        </Container>
      </main>
    </>
  )
}

export const getServerSideProps: GetServerSideProps<
  EditListingPageProps
> = async ({ params, req, res }) => {
  const seller = await getMarketplaceSession({ req, res })
  if (!seller)
    return {
      redirect: {
        destination: `/auth/sign-in?next=${encodeURIComponent(
          `/listings/${params?.id}/edit`
        )}`,
        permanent: false,
      },
    }
  if (typeof params?.id !== 'string') return { notFound: true }
  const listing = await getListing(params.id, { req, res })
  if (!listing) return { notFound: true }
  const mine = await getMyListings({ req, res })
  if (!mine.some((item) => item.id === listing.id)) return { notFound: true }
  return { props: { listing } }
}
