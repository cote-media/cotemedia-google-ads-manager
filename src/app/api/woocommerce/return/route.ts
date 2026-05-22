import { NextResponse } from 'next/server'

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

  const target = new URL('/clients', request.url)

  if (success === '0') {
    target.searchParams.set('woo_error', 'denied')
  } else {
    target.searchParams.set('woo_connected', clientId)
  }

  return NextResponse.redirect(target)
}
