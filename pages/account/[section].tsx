import type { GetStaticPaths, GetStaticProps } from 'next'
import Head from 'next/head'

import { AccountBackLink } from '@/components/listings/account-layout'

const sections: Record<string, string> = {
  favorites: 'Favorites',
  messages: 'Messages',
  profile: 'Profile',
  settings: 'Settings',
}
export default function AccountPlaceholder({ title }: { title: string }) {
  return (
    <>
      <Head>
        <title>{title} | Campus Marketplace</title>
      </Head>
      <section aria-label={title}>
        <div className="flex flex-col gap-6">
          <AccountBackLink />
          <h1 className="text-2xl font-bold">{title}</h1>
          <p>Coming soon.</p>
        </div>
      </section>
    </>
  )
}
export const getStaticPaths: GetStaticPaths = () => ({
  paths: Object.keys(sections).map((section) => ({ params: { section } })),
  fallback: false,
})
export const getStaticProps: GetStaticProps = ({ params }) => {
  const title = sections[String(params?.section)]
  return title ? { props: { title } } : { notFound: true }
}
