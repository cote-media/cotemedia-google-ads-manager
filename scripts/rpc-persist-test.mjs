// TEMP diagnostic — reproduce the app's supabase-js rpc path to test write persistence.
// Run: node scripts/rpc-persist-test.mjs   (reads .env.local)
import { readFileSync } from 'fs'
// Realtime is never used here; stub WebSocket so createClient doesn't throw on Node 20.
if (!globalThis.WebSocket) globalThis.WebSocket = class { constructor() {} close() {} }
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n').filter(Boolean).map((l) => {
    const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]
  })
)
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
const admin = createClient(url, key)
const CID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const PLAT = 'woocommerce_backfill'

// 1) set a known sentinel via supabase-js update
await admin.from('sync_state').update({ backfill_block_fails: 5, backfill_earliest_date: null })
  .eq('client_id', CID).eq('platform', PLAT)

// 2) call bump exactly like the engine does
const { data: bumpRows, error: bumpErr } = await admin.rpc('bump_backfill_block', {
  p_client_id: CID, p_platform: PLAT, p_threshold: 2, p_window: 'NODEWIN', p_reason: 'nodetest', p_earliest: '2026-06-09',
})
console.log('bump err:', bumpErr?.message ?? null)
console.log('bump returned:', JSON.stringify(bumpRows))

// 3) immediate read-back via supabase-js
const { data: rb } = await admin.from('sync_state').select('backfill_block_fails, backfill_earliest_date, backfill_block_window')
  .eq('client_id', CID).eq('platform', PLAT).maybeSingle()
console.log('supabase-js readBack:', JSON.stringify(rb))
