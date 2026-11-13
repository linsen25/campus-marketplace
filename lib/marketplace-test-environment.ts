// Shared public environment identity. This deliberately contains only fixed
// test-project references; credentials are validated server-side and never
// exported from here.
export const marketplaceTestProjects = {
  staging: 'pcaqxezdfxofysghssyo',
  b32: 'giqdwyiupslpfhstbtqf',
} as const

export type MarketplaceTestEnvironment = keyof typeof marketplaceTestProjects

export function marketplaceTestUrl(ref: string) {
  return `https://${ref}.supabase.co`
}

export function configuredMarketplaceTestRef(
  environment = process.env.APP_ENV,
  url = process.env.NEXT_PUBLIC_SUPABASE_URL
) {
  if (
    !environment ||
    !Object.prototype.hasOwnProperty.call(marketplaceTestProjects, environment)
  )
    return null
  const ref = marketplaceTestProjects[
    environment as MarketplaceTestEnvironment
  ]
  try {
    const target = new URL(url || '')
    return target.origin === marketplaceTestUrl(ref) &&
      target.pathname === '/' &&
      !target.username &&
      !target.password &&
      !target.search &&
      !target.hash
      ? ref
      : null
  } catch {
    return null
  }
}
