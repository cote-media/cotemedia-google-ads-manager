// LORAMER_GOOGLE_ADS_UNIVERSE_RUNNER_V1 — the vendor client the consumer injects into the writer.
//
// ⛔ SEPARATE FILE ON PURPOSE. Flight 1's writer takes `query` as a PARAMETER so it stays drivable with no
// network — that is what let the guard prove three legs without spending a single request. Constructing the
// Google client inside the writer would have destroyed that property. This module is the one place the
// vendor is touched, and nothing imports it except the consumer.
//
// ⚠ ★GAQL-OP-METER STAYS OPEN AND THIS IS WHERE IT WOULD CLOSE. The Google Ads API does NOT return an
// operation count on a search response: there is no field on the response surface and no header the
// google-ads-api client exposes. The only source is the API Center in the Google Ads UI, which is a human
// read. So the governor counts REQUESTS and converts with a stated, pessimistic assumption
// (ASSUMED_OPS_PER_REQUEST) rather than a measurement. If a future SDK version surfaces the count, it is
// recorded here and the assumption is replaced.
import { GoogleAdsApi } from 'google-ads-api'
import { supabaseAdmin } from '@/lib/supabase'

export async function googleAdsQueryFor(userEmail: string, customerId: string): Promise<(gaql: string) => Promise<any[]>> {
  const { data, error } = await supabaseAdmin.from('google_tokens').select('refresh_token').eq('user_email', userEmail).single()
  if (error || !data?.refresh_token) throw new Error(`No Google refresh token for ${userEmail}: ${error?.message ?? 'not found'}`)
  const api = new GoogleAdsApi({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
  })
  const customer = api.Customer({
    customer_id: customerId,
    refresh_token: data.refresh_token,
    login_customer_id: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID!,
  })
  return (gaql: string) => customer.query(gaql) as Promise<any[]>
}
