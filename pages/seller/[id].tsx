import type { GetServerSideProps } from 'next'
import Head from 'next/head'

import { PublishedListingCard } from '@/components/listings/published-listing-card'
import { UserAvatar } from '@/components/ui/user-avatar'
import type { PublicSeller } from '@/lib/public-seller'
import { publicSellerPath } from '@/lib/public-seller'
import { getPublicSeller } from '@/lib/server/public-seller'
import { Link } from '@ui/link/link'

import styles from './seller.module.css'

type Props = { seller: PublicSeller | null }

export default function SellerPage({ seller }: Props) {
  return (
    <main className={styles.page}>
      <div className={styles.content}>
        <Head>
          <title>
            {seller
              ? `${seller.username} | Usual & Unusual`
              : 'Seller unavailable | Usual & Unusual'}
          </title>
        </Head>
        <Link href="/listings" className={styles.brand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/static/icons/uu-logo.svg" alt="" width={48} height={30} />
          Usual &amp; Unusual
        </Link>
        {seller ? (
          <article data-public-seller-id={seller.identifier}>
            <header className={styles.identity}>
              <UserAvatar
                className={styles.avatar}
                username={seller.username}
                image={seller.avatarUrl || undefined}
                tone="purple"
              />
              <div>
                <h1>{seller.username}</h1>
                <p>Seller on Usual &amp; Unusual</p>
              </div>
            </header>
            <section aria-label="Active listings">
              <h2>Active listings</h2>
              {seller.listings.length ? (
                <ul className={styles.grid}>
                  {seller.listings.map((listing) => (
                    <li key={listing.id}>
                      <PublishedListingCard listing={listing} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No active listings right now.</p>
              )}
              {(seller.page > 1 || seller.hasNextPage) && (
                <nav className={styles.pagination} aria-label="Listing pages">
                  {seller.page > 1 && (
                    <Link
                      href={`${publicSellerPath(seller.identifier)}?page=${
                        seller.page - 1
                      }`}
                    >
                      Previous
                    </Link>
                  )}
                  {seller.hasNextPage && (
                    <Link
                      href={`${publicSellerPath(seller.identifier)}?page=${
                        seller.page + 1
                      }`}
                    >
                      Next
                    </Link>
                  )}
                </nav>
              )}
            </section>
          </article>
        ) : (
          <p role="alert">Seller page unavailable. Please try again later.</p>
        )}
      </div>
    </main>
  )
}

export const getServerSideProps: GetServerSideProps<Props> = async ({
  params,
  query,
  res,
}) => {
  const identifier = params?.id
  if (typeof identifier !== 'string') return { notFound: true }
  const page = query.page === undefined ? 1 : Number(query.page)
  res.setHeader('Cache-Control', 'private, no-store')
  try {
    const seller = await getPublicSeller(identifier, page)
    return seller ? { props: { seller } } : { notFound: true }
  } catch {
    // eslint-disable-next-line no-param-reassign -- Return a real SSR service-unavailable status.
    res.statusCode = 503
    return { props: { seller: null } }
  }
}
