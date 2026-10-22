// Environment
export const isDev = process.env.NODE_ENV === 'development'
export const isProd = process.env.NODE_ENV === 'production'
export const isTest = process.env.NODE_ENV === 'test'

// Google Analytics
export const gaTrackingId = process.env.NEXT_PUBLIC_UA_ID!
