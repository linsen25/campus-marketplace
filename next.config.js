/* eslint import/no-commonjs: off, @typescript-eslint/no-var-requires: off, @typescript-eslint/naming-convention: off, import/order: off, jsdoc/valid-types: off -- Next.js 12 loads this configuration as CommonJS. */
const withNextPlugins = require('next-compose-plugins')
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
})
const withPWA = require('next-pwa')
const defaultRuntimeCaching = require('next-pwa/cache')

const supabaseImageHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : null

const ifdefOpts = {
  DEV: process.env.NODE_ENV === 'development',
  PROD: process.env.NODE_ENV === 'production',
  TEST: process.env.NODE_ENV === 'test',
}

/** @type {import('next').NextConfig} */
module.exports = withNextPlugins([withBundleAnalyzer, withPWA], {
  generateBuildId: () => 'build',
  eslint: {
    dirs: ['pages', 'components', 'config', 'layouts', 'lib', 'utils', 'hooks'],
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    domains: [
      'res.cloudinary.com',
      ...(supabaseImageHost ? [supabaseImageHost] : []),
    ],
    deviceSizes: [375, 425, 768, 828, 1024, 1440, 1920, 2560],
    minimumCacheTTL: 60 * 60 * 24,
  },
  pwa: {
    dest: 'public',
    // The live marketplace homepage must use the NetworkOnly rule below.
    cacheStartUrl: false,
    dynamicStartUrl: false,
    runtimeCaching: [
      {
        urlPattern: ({ url }) =>
          url.origin === self.location.origin &&
          (url.pathname === '/' ||
            /^\/(api\/(auth|listings|listing-images)(\/|$)|auth(\/|$)|profile\/listings(\/|$)|listings(\/|$))/.test(
              url.pathname
            ) ||
            /^\/_next\/data\/[^/]+\/(index\.json|listings(?:\/|\.json)|profile\/listings\.json|auth\/)/.test(
              url.pathname
            )),
        handler: 'NetworkOnly',
        options: {},
      },
      ...defaultRuntimeCaching,
    ],
    disable: process.env.NODE_ENV !== 'production',
  },
  webpack: (config) => {
    const rules = config.module.rules

    // Ifdef loader
    rules.push({
      test: /\.tsx$/,
      use: [
        {
          loader: 'ifdef-loader',
          options: ifdefOpts,
        },
      ],
    })

    // SVGR loader
    rules.push({
      test: /\.svg$/,
      use: [
        {
          loader: '@svgr/webpack',
          options: {
            icon: true,
            svgProps: {
              fill: 'currentColor',
            },
          },
        },
      ],
    })

    return config
  },
})
