// Shared public environment identity. This deliberately contains only fixed
// test-project references; credentials are validated server-side and never
// exported from here.
// Historical test-project designations remain here only so archived test tools
// can identify their own targets. Unified UU application code must use the
// dedicated helpers below; it never selects a legacy project as a fallback.
export const marketplaceTestProjects = {
  staging: 'pcaqxezdfxofysghssyo',
  b32: 'giqdwyiupslpfhstbtqf',
  uu: 'uqhyjpjiznpgomuizfqe',
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
  const ref = marketplaceTestProjects[environment as MarketplaceTestEnvironment]
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

export const canonicalUuProjectRef = marketplaceTestProjects.uu

/**
 * Exact identity guard for the sole unified application backend. Keep this
 * separate from the legacy helper above: accepting a historical designation
 * here would silently reconnect the new application to an old environment.
 */
export function configuredUuProjectRef(
  environment = process.env.APP_ENV,
  url = process.env.NEXT_PUBLIC_SUPABASE_URL
) {
  return environment === 'uu' &&
    configuredMarketplaceTestRef(environment, url) === canonicalUuProjectRef
    ? canonicalUuProjectRef
    : null
}

export function isConfiguredUuProject(
  environment = process.env.NEXT_PUBLIC_MESSAGES_ENV,
  url = process.env.NEXT_PUBLIC_SUPABASE_URL
) {
  return configuredUuProjectRef(environment, url) !== null
}
