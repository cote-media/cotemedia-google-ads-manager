import { NextResponse } from 'next/server'
import { safeReturnTo } from '@/lib/access/return-to' // LORAMER_NEXT_CONNECT_V1 F2 — same open-redirect guard

// LORAMER_WOO_RETURN_V1
// GET /api/woocommerce/return?clientId=X&success=1   (after approval)
// GET /api/woocommerce/return?clientId=X&success=0   (if user denied)
//
// WordPress redirects the user here AFTER it has POSTed the credentials
// to our callback. The keys are already saved at this point. We just
// route the user back to /clients with a status param the UI can show.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId') || ''
  const success = searchParams.get('success')

  // LORAMER_NEXT_CONNECT_V1 F2 — return to the -next client-profile when a valid returnTo was threaded; else the
  // existing /clients redirect, byte-identical. Same open-redirect guard as the Shopify Branch A path.
  const rt = safeReturnTo(searchParams.get('returnTo'))
  const target = rt ? new URL(rt, request.url) : new URL('/clients', request.url)

  if (success === '0') {
    target.searchParams.set('woo_error', 'denied')
  } else {
    target.searchParams.set('woo_connected', clientId)
  }

  return NextResponse.redirect(target)
}
