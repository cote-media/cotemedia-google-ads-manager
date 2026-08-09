// LORAMER_UNIVERSE_STREAM_CAPTURE_V1 — the STREAMING vendor client the v2 consumer injects.
//
// ⛔ SEPARATE FILE, FOR THE SAME REASON `universe-vendor-client.ts` IS ONE. The capture function takes
// `stream` as a PARAMETER so it stays drivable with no network — that is what lets the guard prove the
// day-commit boundary, the order check and the mid-day-kill behaviour without spending a single request.
// Constructing the Google client inside the capture path would destroy that property.
//
// ⛔ `queryStream` HAS BEEN THERE THE WHOLE TIME. google-ads-api 23.0.0, `customer.d.ts:22`:
//     queryStream<T = services.IGoogleAdsRow>(gaqlQuery: string, requestOptions?): AsyncGenerator<T>
// v1 calls `customer.query(gaql)`, which returns `Promise<T[]>` and therefore BUFFERS THE WHOLE WINDOW
// before a single row is written. A killed invocation loses everything it fetched, having already spent the
// request. Nothing about that was a constraint — it was an unexamined default.
//
// ⛔ AND IT COSTS THE SAME. Google's rate sheet, already quoted in `universe-governor.ts`: a query or report
// is ONE operation whether streamed via SearchStream or paged via Search, and paginated requests carrying a
// valid next_page_token are not counted at all. Streaming is strictly better here — same price, and the rows
// become durable as they arrive instead of at the end.
import { GoogleAdsApi } from 'google-ads-api'
import { supabaseAdmin } from '@/lib/supabase'

export async function googleAdsStreamFor(
  userEmail: string, customerId: string,
): Promise<(gaql: string) => AsyncGenerator<any>> {
  const { data, error } = await supabaseAdmin
    .from('google_tokens').select('refresh_token').eq('user_email', userEmail).single()
  if (error || !data?.refresh_token) {
    throw new Error(`No Google refresh token for ${userEmail}: ${error?.message ?? 'not found'}`)
  }
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
  return (gaql: string) => customer.queryStream(gaql) as AsyncGenerator<any>
}
