import { isIP } from 'net'

import { ListingApiError } from '@/lib/listing-validation'
import { publicSellerPath } from '@/lib/public-seller'

export const sellerProductDescription =
  'I sell new and pre-owned personal items through the Usual & Unusual marketplace.'

export async function sellerOnboardingProfile(identifier: string) {
  const profile: { business_url?: string; product_description: string } = {
    product_description: sellerProductDescription,
  }
  // This is deliberately separate from the local hosted return/refresh origin.
  // No public staging deployment is configured yet; never invent a website URL.
  const configured = process.env.UU_PUBLIC_STAGING_ORIGIN
  if (!configured) return profile
  let origin: URL
  try {
    origin = new URL(configured)
    if (
      process.env.APP_ENV !== 'staging' ||
      origin.protocol !== 'https:' ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash ||
      origin.port ||
      isIP(origin.hostname) ||
      !origin.hostname.includes('.') ||
      /(?:^|\.)(?:localhost|local|internal|test|example|invalid)$/.test(
        origin.hostname
      )
    )
      throw new Error('Invalid public staging origin')
  } catch {
    throw new ListingApiError(
      'Public seller page configuration is unavailable.',
      503
    )
  }
  const url = new URL(publicSellerPath(identifier), origin).href
  // Check the exact seller page without auth or redirects. A protected preview,
  // generic homepage or missing route must not be submitted as a seller website.
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetch(url, {
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
    })
    if (
      !response.ok ||
      !response.headers.get('content-type')?.includes('text/html') ||
      !(await response.text()).includes(
        `data-public-seller-id="${identifier.toLowerCase()}"`
      )
    )
      throw new Error('Public seller page unavailable')
  } catch {
    throw new ListingApiError(
      'Your public seller page is unavailable. Please retry later.',
      503
    )
  } finally {
    clearTimeout(timeout)
  }
  profile.business_url = url
  return profile
}
