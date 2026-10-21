import type { GetServerSideProps } from 'next'
import Head from 'next/head'

import { ShopPage } from '@/components/shops/shop-page'
import { getPublicShop } from '@/lib/server/public-shop'
import type { PublicShop } from '@/types/shop'

type ShopPageProps = { result?: PublicShop; message?: string }
export default function PublicShopPage({
  result: props,
  message,
}: ShopPageProps) {
  if (!props)
    return (
      <main>
        <p role="status">{message}</p>
      </main>
    )
  return (
    <>
      <Head>
        <title>{props.shop.shopName} | Usual &amp; Unusual</title>
      </Head>
      <ShopPage {...props} />
    </>
  )
}

export const getServerSideProps: GetServerSideProps<ShopPageProps> = async ({
  params,
  res,
}) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  const username = params?.username
  if (typeof username !== 'string') return { notFound: true }
  try {
    const result = await getPublicShop(username, { pageSize: 15 })
    if (result.state === 'not_found') return { notFound: true }
    if (result.state === 'unavailable')
      return { props: { message: 'This shop is temporarily unavailable.' } }
    if (username !== result.shop.username)
      return {
        redirect: {
          destination: `/shop/${encodeURIComponent(result.shop.username)}`,
          permanent: false,
        },
      }
    return {
      props: {
        result: {
          shop: result.shop,
          listings: result.listings,
          page: result.page,
          hasNextPage: result.hasNextPage,
          refreshAfterMs: result.refreshAfterMs,
        },
      },
    }
  } catch {
    // eslint-disable-next-line no-param-reassign -- SSR must distinguish an unavailable data source from a missing Shop.
    res.statusCode = 503
    return { props: { message: 'Shop unavailable. Please retry.' } }
  }
}
