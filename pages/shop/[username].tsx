import type { GetServerSideProps } from 'next'
import Head from 'next/head'

import { ShopPage } from '@/components/shops/shop-page'
import { getPublicShop } from '@/lib/server/public-shop'
import type { PublicShop } from '@/types/shop'

export default function PublicShopPage(props: PublicShop) {
  return (
    <>
      <Head>
        <title>{props.shop.shopName} | Usual &amp; Unusual</title>
      </Head>
      <ShopPage {...props} />
    </>
  )
}

export const getServerSideProps: GetServerSideProps<PublicShop> = ({
  params,
  res,
}) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  const username = params?.username
  const result = typeof username === 'string' ? getPublicShop(username) : null
  return Promise.resolve(result ? { props: result } : { notFound: true })
}
