// Browser-component tests only: no hosted requests, login, credentials or session mutation.
const fs = require('node:fs')
const path = require('node:path')

module.exports = function writeBrowserMocks(root) {
  const sources = {
    auth: 'export function useAuthModal(){return {openAuth(){throw Error("Unexpected Auth action")}}}',
    router: 'export function useRouter(){return {query:{},pathname:"/home",push:async url=>{window.actions.push(url)}}}',
    financial: 'export function useFinancialCapabilities(){return {loading:false,error:"",refresh:async()=>{},data:{paymentMethod:{status:window.methodStatus||"set"},payoutAccount:{status:"ready"}}}}',
    request: 'export async function marketplaceRequest(url,method,body){return window.fixtureRequest(url,method,body)}',
  }
  for (const [name, source] of Object.entries(sources)) fs.writeFileSync(path.join(root, name + '-mock.js'), source)
  return {
    '@/components/auth/auth-modal': path.join(root, 'auth-mock.js'),
    'next/router': path.join(root, 'router-mock.js'),
    '@/hooks/use-financial-capabilities': path.join(root, 'financial-mock.js'),
    '@/lib/listings-api': path.join(root, 'request-mock.js'),
  }
}
