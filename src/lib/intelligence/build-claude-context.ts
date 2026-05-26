// ─── Universal Claude Context Builder ─────────────────────────────────────────
// Converts a ClientIntelligence object into a rich system prompt.
// Every Claude call uses this — InsightChat, AskClaudeButton, chat tab, everything.
//
// Conversation memory:
//   - ALL conversations across ALL panels for the client are merged
//   - Last 20 messages kept (was 6) — directives from earlier sessions survive
//   - Per-message char limit raised to 800 (was 200)
//   - Heuristic scan for "directive-like" statements pulls them into a
//     dedicated DIRECTIVES section at the TOP of the prompt
//   - Directives are also re-stated as hard constraints in the rules section
//     so 50-word insight outputs can't drop them

import type { ClientIntelligence, PlatformIntelligence } from './intelligence-types'

const OBJECTIVE_RULES: Record<string, string> = {
  OUTCOME_AWARENESS: 'Brand Awareness — evaluate CPM/reach ONLY. NEVER mention CTR or ROAS.',
  OUTCOME_ENGAGEMENT: 'Engagement — evaluate CPE and engagement rate only.',
  OUTCOME_LEADS: 'Lead Generation — CPL is the ONLY metric that matters.',
  OUTCOME_SALES: 'Sales/Conversions — ROAS and CPA are primary.',
  OUTCOME_TRAFFIC: 'Traffic — CTR and CPC matter. Do NOT expect or evaluate conversions.',
  REACH: 'Reach — maximize reach at lowest CPM. CTR irrelevant.',
  VIDEO_VIEWS: 'Video Views — view rate and ThruPlays ONLY. CTR is irrelevant.',
  SEARCH: 'Search — CTR, Quality Score, CPC. Conversions expected.',
  DISPLAY: 'Display — 0.1-0.35% CTR is completely normal. NEVER call display CTR low.',
  PERFORMANCE_MAX: 'Performance Max — evaluate conversion efficiency and ROAS only.',
  SHOPPING: 'Shopping — ROAS and CPA primary.',
  DISCOVERY: 'Discovery/Demand Gen — upper funnel. Do not expect high conversion volume.',
}

// LORAMER_PROJECT_3_STEP_1_V1 ─────────────────────────────────────────────────
// Focus-aware data slicing. Each surface that calls buildClaudeContext passes
// a focus string. We normalize it to a typed FocusMode and use the mode to
// decide how much of each platform's data to render in the prompt.
//
// Step 1 sets up the scaffolding with current behavior as the default.
// Step 2 will add new data sections (search terms, asset performance, audience
// segments, etc.) that respect these same limits.

export type FocusMode =
  | 'overview'           // main dashboard, broad analysis
  | 'campaigns'          // campaigns tab, full campaign list visible
  | 'adgroups'           // drilled into ad groups under a campaign
  | 'ads'                // drilled into ads under an ad group
  | 'keywords'           // keywords tab (Google)
  | 'shopify'            // shopify tab
  | 'woocommerce'        // woocommerce tab
  | 'asset-attribution'  // PMax / asset-level analysis (Step 2+)
  | 'audience'           // audience-segment analysis (Step 2+)
  | 'search-terms'       // search-term report drill (Step 2+)
  | 'health'             // account-health focus (Step 4+)
  | 'row-context'        // ✦ diamond on a specific row — uses row scope to pick limits

export type DataLimits = {
  campaigns: number          // how many campaigns to render
  adGroups: number           // how many ad groups
  ads: number                // how many ads
  keywords: number           // how many keywords
  conversionActions: number  // how many conversion actions
  topProducts: number        // how many shopify/woo products
  // Step 2+ fields (placeholders for now, default 0)
  searchTerms: number
  audiences: number
  assetGroups: number
  assetsPerGroup: number
  demographics: number
  geographic: number
}

const DEFAULT_LIMITS: DataLimits = {
  campaigns: 15,
  adGroups: 20,
  ads: 20,
  keywords: 20,
  conversionActions: 50,
  topProducts: 5,
  // LORAMER_PROJECT_3_STEP_2A_V1 — search terms enabled
  searchTerms: 10,
  audiences: 0,        // Step 2 (later sub-steps) fills this
  assetGroups: 0,      // Step 2f fills this
  assetsPerGroup: 0,   // Step 2f fills this
  demographics: 0,     // Step 2d fills this
  geographic: 0,       // Step 3 fills this
}

// Normalize any incoming focus string (which may be a label, a drill key like
// "adgroups:Campaign Name", a platform name like "google", etc.) into a
// typed FocusMode plus the original string for the prompt's "Current view"
// label.
export function normalizeFocus(focus: string | undefined): { mode: FocusMode; label: string } {
  const f = (focus || 'overview').toLowerCase().trim()
  // Drill keys arrive as "adgroups:..." or "ads:..."
  if (f.startsWith('adgroups')) return { mode: 'adgroups', label: focus || 'adgroups' }
  if (f.startsWith('ads')) return { mode: 'ads', label: focus || 'ads' }
  if (f === 'campaigns') return { mode: 'campaigns', label: focus || 'campaigns' }
  if (f === 'keywords') return { mode: 'keywords', label: focus || 'keywords' }
  if (f === 'shopify') return { mode: 'shopify', label: focus || 'shopify' }
  if (f === 'woocommerce') return { mode: 'woocommerce', label: focus || 'woocommerce' }
  if (f === 'asset-attribution' || f.startsWith('asset')) return { mode: 'asset-attribution', label: focus || 'asset-attribution' }
  if (f === 'audience' || f.startsWith('audience')) return { mode: 'audience', label: focus || 'audience' }
  if (f === 'search-terms' || f === 'searchterms') return { mode: 'search-terms', label: focus || 'search-terms' }
  if (f === 'health') return { mode: 'health', label: focus || 'health' }
  // Platform labels: google/meta/combined act like overview
  if (f === 'google' || f === 'meta' || f === 'combined' || f === 'overview') return { mode: 'overview', label: focus || 'overview' }
  // Anything else (e.g. row clicks with custom strings) gets row-context
  return { mode: 'row-context', label: focus || 'row-context' }
}

export function getDataLimitsForFocus(mode: FocusMode): DataLimits {
  switch (mode) {
    case 'overview':
      return { ...DEFAULT_LIMITS, campaigns: 15, adGroups: 20, ads: 20, keywords: 20 }
    case 'campaigns':
      // Campaigns tab — show ALL campaigns, fewer of the others
      return { ...DEFAULT_LIMITS, campaigns: 50, adGroups: 10, ads: 10, keywords: 10, searchTerms: 15 }
    case 'adgroups':
      // Drilled into ad groups for one campaign — emphasize ad groups + ads
      return { ...DEFAULT_LIMITS, campaigns: 5, adGroups: 30, ads: 20, keywords: 10, searchTerms: 10 }
    case 'ads':
      // Drilled into ads for one ad group — maximize ad detail
      return { ...DEFAULT_LIMITS, campaigns: 3, adGroups: 5, ads: 30, keywords: 5, searchTerms: 5 }
    case 'keywords':
      // Keywords tab — full picture pairs keywords with search terms that triggered
      return { ...DEFAULT_LIMITS, campaigns: 10, adGroups: 10, ads: 5, keywords: 50, searchTerms: 30 }
    case 'shopify':
    case 'woocommerce':
      return { ...DEFAULT_LIMITS, campaigns: 5, adGroups: 5, ads: 5, keywords: 5, searchTerms: 5, topProducts: 20 }
    case 'asset-attribution':
      // Step 2 will populate assetGroups + assetsPerGroup limits
      return { ...DEFAULT_LIMITS, campaigns: 8, adGroups: 5, ads: 10, keywords: 0 }
    case 'audience':
      return { ...DEFAULT_LIMITS, campaigns: 8, adGroups: 10, ads: 5, keywords: 5 }
    case 'search-terms':
      // Dedicated search terms focus — the deep dive
      return { ...DEFAULT_LIMITS, campaigns: 5, adGroups: 5, ads: 5, keywords: 30, searchTerms: 50 }
    case 'health':
      return { ...DEFAULT_LIMITS, campaigns: 10, adGroups: 5, ads: 5, keywords: 5 }
    case 'row-context':
      return { ...DEFAULT_LIMITS, campaigns: 10, adGroups: 15, ads: 15, keywords: 15 }
    default:
      return DEFAULT_LIMITS
  }
}
// ── end LORAMER_PROJECT_3_STEP_1_V1 ───────────────────────────────────────────


const DIRECTIVE_PATTERNS: RegExp[] = [
  /\bignore\b/i,
  /\bdon'?t\s+(?:focus|worry|mention|recommend|suggest|talk\s+about|pay\s+attention|use|consider|include|flag|highlight|surface)/i,
  /\bdo\s+not\s+(?:focus|worry|mention|recommend|suggest|talk\s+about|pay\s+attention|use|consider|include|flag|highlight|surface)/i,
  /\bstop\s+(?:mentioning|recommending|suggesting|focusing|talking|flagging|highlighting|surfacing)/i,
  /\bfocus\s+on\b/i,
  /\bprioriti[sz]e\b/i,
  /\b(?:we|i)\s+(?:only|just)\s+care\s+about/i,
  /\bnot\s+important\b/i,
  /\binstead\s+of\b/i,
  /\bremember\s+that\b/i,
  /\bkeep\s+in\s+mind\b/i,
  /\bnever\s+(?:mention|recommend|suggest|focus|use|include|flag|surface)/i,
  /\balways\s+(?:mention|recommend|suggest|focus|use|include|consider)/i,
  /\btarget\s+(?:is|for)\b.*\$/i,
  /\bfor\s+now\b/i,
  /\bdeprioriti[sz]e\b/i,
  /\bdisregard\b/i,
  /\bset\s+aside\b/i,
  /\bnot\s+(?:focus|worry|track|measure)/i,
]

// Try to extract a normalized "rule" from a directive snippet. E.g.,
// "ignore ROAS for now" → "Do not mention ROAS"
// "focus on lead volume instead" → "Focus on lead volume"
// If we can't normalize cleanly, return the raw snippet.
function normalizeDirective(snippet: string): string {
  const s = snippet.trim()
  // Trim leading conversation cruft
  const cleaned = s
    .replace(/^(yeah|yes|ok|okay|hey|so|but|and|also|please|just|hi)\s*[,:]?\s*/i, '')
    .replace(/^haven'?t\s+i\s+told\s+you\s+(not\s+to\s+|to\s+not\s+|to\s+)?/i, '')
    .replace(/^i\s+told\s+you\s+(not\s+to\s+|to\s+not\s+|to\s+)?/i, '')
    .trim()
  return cleaned || s
}

function formatMetrics(m: any, indent = ''): string {
  const lines = []
  if (m.spend != null) lines.push(`Spend: $${m.spend.toFixed(2)}`)
  if (m.clicks != null) lines.push(`Clicks: ${m.clicks.toLocaleString()}`)
  if (m.impressions != null) lines.push(`Impressions: ${m.impressions.toLocaleString()}`)
  if (m.ctr != null) lines.push(`CTR: ${m.ctr.toFixed(2)}%`)
  if (m.cpc != null && m.cpc > 0) lines.push(`CPC: $${m.cpc.toFixed(2)}`)
  if (m.cpm != null && m.cpm > 0) lines.push(`CPM: $${m.cpm.toFixed(2)}`)
  if (m.reach != null && m.reach > 0) lines.push(`Reach: ${m.reach.toLocaleString()}`)
  if (m.frequency != null && m.frequency > 0) lines.push(`Frequency: ${m.frequency.toFixed(2)}`)
  if (m.conversions != null) lines.push(`Conversions: ${m.conversions.toFixed(1)}`)
  if (m.roas != null) lines.push(`ROAS: ${m.roas.toFixed(2)}x`)
  if (m.cpa != null) lines.push(`CPA: $${m.cpa.toFixed(2)}`)
  if (m.convRate != null) lines.push(`Conv Rate: ${m.convRate.toFixed(2)}%`)
  if (m.purchases != null && m.purchases > 0) lines.push(`Purchases: ${m.purchases}`)
  if (m.addToCart != null && m.addToCart > 0) lines.push(`Add to Cart: ${m.addToCart}`)
  if (m.costPerPurchase != null) lines.push(`Cost/Purchase: $${m.costPerPurchase.toFixed(2)}`)
  return lines.map(l => indent + l).join(', ')
}

// LORAMER_PROJECT_3_STEP_1_V1 — added optional `limits` parameter
function buildPlatformSection(platform: PlatformIntelligence, name: string, limits: DataLimits = DEFAULT_LIMITS): string {
  if (!platform?.connected || !platform.campaigns?.length) return ''
  const lines: string[] = []
  lines.push(`\n=== ${name.toUpperCase()} ADS ===`)
  lines.push(`Account Totals: ${formatMetrics(platform.totals)}`)

  if (platform.campaigns.length > 0 && limits.campaigns > 0) {
    lines.push(`\nCampaigns (${platform.campaigns.length} total, showing top ${Math.min(platform.campaigns.length, limits.campaigns)}):`)
    platform.campaigns.slice(0, limits.campaigns).forEach(c => {
      const rule = OBJECTIVE_RULES[c.objective || ''] || ''
      lines.push(`  • ${c.name} [${c.objective || c.channelType || 'unknown'}] [${c.status}]`)
      if (c.bidStrategy) lines.push(`    Bid strategy: ${c.bidStrategy}`)
      if (c.budget) lines.push(`    Budget: $${c.budget.toFixed(2)}/day`)
      lines.push(`    ${formatMetrics(c.metrics, '    ')}`)
      if (rule) lines.push(`    ⚠ Rule: ${rule}`)
    })
  }

  if (platform.adGroups && platform.adGroups.length > 0 && limits.adGroups > 0) {
    lines.push(`\nAd Groups/Sets (top ${Math.min(platform.adGroups.length, limits.adGroups)}):`)
    platform.adGroups.slice(0, limits.adGroups).forEach(ag => {
      lines.push(`  • ${ag.name} [${ag.campaignName}] [${ag.status}]`)
      if (ag.bidStrategy) lines.push(`    Bid: ${ag.bidStrategy}`)
      if (ag.optimizationGoal) lines.push(`    Optimizing for: ${ag.optimizationGoal}`)
      if (ag.targeting) {
        const t = ag.targeting
        const tParts = []
        if (t.ageMin || t.ageMax) tParts.push(`Ages ${t.ageMin || '18'}-${t.ageMax || '65+'}`)
        if (t.genders?.length) tParts.push(t.genders.join('/'))
        if (t.interests?.length) tParts.push(`Interests: ${t.interests.join(', ')}`)
        if (t.lookalikes?.length) tParts.push(`Lookalikes: ${t.lookalikes.join(', ')}`)
        if (t.customAudiences?.length) tParts.push(`Custom: ${t.customAudiences.join(', ')}`)
        if (t.retargeting) tParts.push('Retargeting')
        if (tParts.length) lines.push(`    Targeting: ${tParts.join(' | ')}`)
      }
      lines.push(`    ${formatMetrics(ag.metrics, '    ')}`)
    })
  }

  if (platform.ads && platform.ads.length > 0 && limits.ads > 0) {
    lines.push(`\nAds (top ${Math.min(platform.ads.length, limits.ads)} by spend):`)
    platform.ads.slice(0, limits.ads).forEach(ad => {
      lines.push(`  • ${ad.name} [${ad.creativeType || 'unknown'}] [${ad.status}]`)
      if (ad.headline) lines.push(`    Headline: "${ad.headline}"`)
      if (ad.body) lines.push(`    Body: "${ad.body.slice(0, 100)}${ad.body.length > 100 ? '...' : ''}"`)
      if (ad.callToAction) lines.push(`    CTA: ${ad.callToAction}`)
      lines.push(`    ${formatMetrics(ad.metrics, '    ')}`)
    })
  }

  if (platform.keywords && platform.keywords.length > 0 && limits.keywords > 0) {
    lines.push(`\nTop Keywords (${platform.keywords.length} total, showing top ${Math.min(platform.keywords.length, limits.keywords)}):`)
    platform.keywords.slice(0, limits.keywords).forEach(kw => {
      lines.push(`  • "${kw.text}" [${kw.matchType}] [QS: ${kw.qualityScore || 'N/A'}] — ${formatMetrics(kw.metrics)}`)
    })
  }

  // LORAMER_PROJECT_3_STEP_2A_V1 — Search Terms (what users actually typed)
  if (platform.searchTerms && platform.searchTerms.length > 0 && limits.searchTerms > 0) {
    lines.push(`\nSearch Terms — actual user queries that triggered ads (${platform.searchTerms.length} total, showing top ${Math.min(platform.searchTerms.length, limits.searchTerms)} by spend):`)
    platform.searchTerms.slice(0, limits.searchTerms).forEach(st => {
      const statusLabel = st.status && st.status !== 'unmapped' ? ` [${st.status}]` : ''
      lines.push(`  • "${st.text}" [${st.matchType}]${statusLabel} — ${formatMetrics(st.metrics)}`)
      lines.push(`    From: ${st.campaignName} → ${st.adGroupName}`)
    })
    lines.push(`  (Search terms with status "added & excluded" are negatives already in place. Status "added" = already a keyword. "unmapped" = no action taken yet.)`)
  }

  if (platform.conversionActions && platform.conversionActions.length > 0) {
    lines.push(`\nConversion Actions:`)
    platform.conversionActions.forEach(ca => {
      lines.push(`  • ${ca.name} [${ca.category}] — ${ca.count.toFixed(1)} conv — ${ca.includeInConversions ? '✓ INCLUDED in conversions column' : '✗ NOT included'}`)
    })
  }

  return lines.join('\n')
}

function flattenConversations(conversations: Record<string, any[]>): Array<{
  panelKey: string
  role: string
  content: string
  timestamp?: number | string
}> {
  const all: Array<{ panelKey: string; role: string; content: string; timestamp?: number | string }> = []
  Object.entries(conversations || {}).forEach(([panelKey, msgs]) => {
    if (!Array.isArray(msgs)) return
    msgs.forEach((m: any) => {
      if (m && typeof m === 'object' && m.content) {
        all.push({
          panelKey,
          role: m.role || 'user',
          content: String(m.content),
          timestamp: m.timestamp || m.ts || m.createdAt,
        })
      }
    })
  })
  const hasTs = all.every(m => m.timestamp != null)
  if (hasTs) {
    all.sort((a, b) => {
      const ta = new Date(a.timestamp as any).getTime()
      const tb = new Date(b.timestamp as any).getTime()
      return ta - tb
    })
  }
  return all
}

function extractDirectives(flat: Array<{ role: string; content: string }>): string[] {
  const directives: string[] = []
  const seen = new Set<string>()
  flat.forEach(m => {
    if (m.role !== 'user') return
    const content = m.content.trim()
    if (!content) return
    const matches = DIRECTIVE_PATTERNS.some(re => re.test(content))
    if (matches) {
      let snippet = content
      const sentenceEnd = snippet.search(/[.!?](?:\s|$)/)
      if (sentenceEnd > 0 && sentenceEnd < 300) snippet = snippet.slice(0, sentenceEnd + 1)
      else if (snippet.length > 300) snippet = snippet.slice(0, 297) + '...'
      const normalized = normalizeDirective(snippet)
      const key = normalized.toLowerCase().replace(/\s+/g, ' ')
      if (!seen.has(key)) {
        seen.add(key)
        directives.push(normalized)
      }
    }
  })
  return directives
}

// LORAMER_MEMORY_V1
// Memory facts come from the client_memory table via /api/intelligence.
// Categories: 'directive' | 'fact' | 'observation' | 'preference' | 'context'.
// Directive facts are folded into HARD CONSTRAINTS; the rest get their own
// "WHAT YOU KNOW ABOUT" block.
type MemoryFact = {
  id: number
  content: string
  category: 'directive' | 'fact' | 'observation' | 'preference' | 'context'
  confidence: number
  pinned: boolean
  source: string
}

function partitionMemory(memory: MemoryFact[]) {
  const directives: MemoryFact[] = []
  const facts: MemoryFact[] = []
  const context: MemoryFact[] = []
  const preferences: MemoryFact[] = []
  const observations: MemoryFact[] = []
  for (const m of memory) {
    if (m.category === 'directive') directives.push(m)
    else if (m.category === 'fact') facts.push(m)
    else if (m.category === 'context') context.push(m)
    else if (m.category === 'preference') preferences.push(m)
    else if (m.category === 'observation' && m.confidence >= 0.7) observations.push(m)
  }
  return { directives, facts, context, preferences, observations }
}

function buildMemorySection(memory: MemoryFact[], clientName: string): string {
  if (!memory || memory.length === 0) return ''
  const { facts, context, preferences, observations } = partitionMemory(memory)
  if (facts.length === 0 && context.length === 0 && preferences.length === 0 && observations.length === 0) {
    return ''
  }
  const lines: string[] = []
  lines.push(`\n=== WHAT YOU KNOW ABOUT ${clientName.toUpperCase()} ===`)
  lines.push('(These are durable facts the user has confirmed about this client. Treat them as')
  lines.push(' binding context. Reference them naturally when relevant — do not list them back.)')
  if (facts.length > 0) {
    lines.push('')
    lines.push('FACTS:')
    facts.forEach(f => lines.push(`  • ${f.content}`))
  }
  if (context.length > 0) {
    lines.push('')
    lines.push('CONTEXT:')
    context.forEach(c => lines.push(`  • ${c.content}`))
  }
  if (preferences.length > 0) {
    lines.push('')
    lines.push('USER PREFERENCES (how the user wants Claude to respond):')
    preferences.forEach(p => lines.push(`  • ${p.content}`))
  }
  if (observations.length > 0) {
    lines.push('')
    lines.push('OBSERVATIONS (high-confidence patterns Claude has noted; treat as likely true):')
    observations.forEach(o => lines.push(`  • ${o.content}`))
  }
  return lines.join('\n')
}

function buildConversationContext(conversations: Record<string, any[]>): string {
  if (!conversations || Object.keys(conversations).length === 0) return ''
  const flat = flattenConversations(conversations)
  if (!flat.length) return ''

  // LORAMER_PANEL_LEAK_FIX_V1 - strip internal panelKey from messages so 'shopify-google' style labels never leak to users
  const lines = ['\n=== PREVIOUS CONVERSATIONS WITH THIS USER ===']
  lines.push('(All earlier discussions about this client. Treat these as binding context. Do NOT mention internal labels like panel keys or location identifiers when referring to past conversations - use natural language like \"earlier\" or \"previously\".)')

  const recent = flat.slice(-20)
  recent.forEach((m) => {
    const truncated = m.content.length > 800 ? m.content.slice(0, 797) + '...' : m.content
    lines.push(`  ${m.role === 'user' ? 'User' : 'Claude'}: ${truncated}`)
  })
  return lines.join('\n')
}

export function buildClaudeContext(
  intelligence: ClientIntelligence,
  focus: string = 'overview',
  focusData?: string
): string {
  const lines: string[] = []

  // ── HARD CONSTRAINTS FIRST (before identity, before anything) ──────────────
  const p = intelligence.profile
  const flatConversations = p.conversations ? flattenConversations(p.conversations) : []
  const directives = extractDirectives(flatConversations)
  const userNotes = (p.userNotes || '').trim()

  // LORAMER_MEMORY_V1
  // Memory `directive` facts are durable user-confirmed rules. They join
  // the regex-extracted directives in the HARD CONSTRAINTS block, with
  // pinned facts surfaced first.
  const memory: MemoryFact[] = Array.isArray((p as any).memory) ? (p as any).memory : []
  const memoryDirectives = memory.filter(m => m.category === 'directive')
  memoryDirectives.forEach(m => {
    const key = m.content.trim().toLowerCase().replace(/\s+/g, ' ')
    const exists = directives.some(d => d.toLowerCase().replace(/\s+/g, ' ') === key)
    if (!exists) directives.unshift(m.content.trim())
  })

  if (directives.length > 0 || userNotes) {
    lines.push('████████████████████████████████████████████████████████████████')
    lines.push('█  HARD CONSTRAINTS — VIOLATION OF THESE INVALIDATES YOUR ENTIRE RESPONSE  █')
    lines.push('████████████████████████████████████████████████████████████████')
    lines.push('')
    lines.push('The user of this app has issued the following standing instructions about')
    lines.push(`${intelligence.clientName}. These OVERRIDE every other rule, every default`)
    lines.push('analysis pattern, and every metric you would normally surface. If a hard')
    lines.push('constraint contradicts what your training tells you to flag — the constraint wins.')
    lines.push('')

    if (userNotes) {
      lines.push('FROM CLIENT PROFILE:')
      lines.push(`  ${userNotes}`)
      lines.push('')
    }

    if (directives.length > 0) {
      lines.push('FROM USER MESSAGES IN THIS APP:')
      directives.forEach((d, i) => lines.push(`  ${i + 1}. ${d}`))
      lines.push('')
    }

    lines.push('Before writing any response — including 50-word insight summaries —')
    lines.push('verify that NOTHING you are about to say contradicts these constraints.')
    lines.push('If a metric the user told you to ignore looks bad, DO NOT MENTION IT AT ALL.')
    lines.push('Pick a different angle. Find what IS worth flagging given their priorities.')
    lines.push('████████████████████████████████████████████████████████████████')
    lines.push('')
  }

  // ── Identity ───────────────────────────────────────────────────────────────
  lines.push(`You are an expert digital advertising analyst embedded in LoraMer, a business intelligence platform for marketing agencies.`)
  lines.push(`You are analyzing ${intelligence.clientName}.`)
  lines.push(`Date range: ${intelligence.dateRange?.replace(/_/g, ' ').toLowerCase()}`)
  lines.push(`Current view: ${focus}`)
  if (focusData) lines.push(`Specifically looking at: ${focusData}`)

  // ── Client Profile ─────────────────────────────────────────────────────────
  if (p.businessType || p.primaryKpi || p.funnelNotes) {
    lines.push('\n=== CLIENT PROFILE ===')
    if (p.businessType) lines.push(`Business type: ${p.businessType}`)
    if (p.primaryKpi) lines.push(`Primary KPI: ${p.primaryKpi}`)
    if (p.funnelNotes) lines.push(`Funnel strategy: ${p.funnelNotes}`)
  }

  // ── Platform Data ──────────────────────────────────────────────────────────
  // LORAMER_PROJECT_3_STEP_1_V1 — focus-aware slicing
  const { mode: focusMode } = normalizeFocus(focus)
  const limits = getDataLimitsForFocus(focusMode)
  lines.push('\n=== COMPLETE ACCOUNT DATA ===')
  lines.push('(You have access to ALL data from ALL platforms. Use all of it to answer questions.)')

  if (intelligence.google) lines.push(buildPlatformSection(intelligence.google, 'Google', limits))
  if (intelligence.meta) lines.push(buildPlatformSection(intelligence.meta, 'Meta', limits))

  if (intelligence.shopify?.connected) {
    const s = intelligence.shopify
    lines.push('\n=== SHOPIFY ===')
    if (s.totalRevenue) lines.push(`Total Revenue: $${s.totalRevenue.toFixed(2)}`)
    if (s.totalOrders) lines.push(`Total Orders: ${s.totalOrders}`)
    if (s.avgOrderValue) lines.push(`Avg Order Value: $${s.avgOrderValue.toFixed(2)}`)
    if (s.newCustomers) lines.push(`New Customers: ${s.newCustomers}`)
    if (s.returningCustomers) lines.push(`Returning Customers: ${s.returningCustomers}`)
    if (s.topProducts?.length) {
      lines.push(`Top Products (showing top ${Math.min(s.topProducts.length, limits.topProducts)}):`)
      s.topProducts.slice(0, limits.topProducts).forEach(prod => {
        lines.push(`  • ${prod.name}: $${prod.revenue.toFixed(2)} revenue, ${prod.units} units`)
      })
    }
  }


  // LORAMER_WOO_INTEL_V1
  if (intelligence.woocommerce?.connected) {
    const w = intelligence.woocommerce
    lines.push('\n=== WOOCOMMERCE ===')
    if (w.totalRevenue) lines.push(`Total Revenue: $${w.totalRevenue.toFixed(2)}`)
    if (w.totalOrders) lines.push(`Total Orders: ${w.totalOrders}`)
    if (w.avgOrderValue) lines.push(`Avg Order Value: $${w.avgOrderValue.toFixed(2)}`)
    if (w.newCustomers) lines.push(`New Customers: ${w.newCustomers}`)
    if (w.returningCustomers) lines.push(`Returning Customers: ${w.returningCustomers}`)
    if (w.topProducts?.length) {
      lines.push(`Top Products (showing top ${Math.min(w.topProducts.length, limits.topProducts)}):`)
      w.topProducts.slice(0, limits.topProducts).forEach(prod => {
        lines.push(`  • ${prod.name}: $${prod.revenue.toFixed(2)} revenue, ${prod.units} units`)
      })
    }
  }
  // LORAMER_MEMORY_V1 — durable facts above conversation history
  const memorySection = buildMemorySection(memory, intelligence.clientName)
  if (memorySection) lines.push(memorySection)

  // ── Previous Conversations (full flat history) ─────────────────────────────
  if (p.conversations) lines.push(buildConversationContext(p.conversations))

  // ── Rules ──────────────────────────────────────────────────────────────────
  lines.push('\n=== ANALYSIS RULES ===')
  if (directives.length > 0 || userNotes) {
    lines.push('REMINDER: The HARD CONSTRAINTS at the top of this prompt override everything below.')
    lines.push('If you are tempted to flag a metric the user told you to ignore — STOP and find a different angle.')
  }
  lines.push('Always respect campaign objectives. Never criticize a metric irrelevant to the objective.')
  lines.push('Be specific — use actual campaign names, ad names, and numbers.')
  lines.push('You are talking to an experienced agency professional. Skip basics.')
  lines.push('If you can see the data needed to answer a question, answer it directly without asking for more info.')

  return lines.join('\n')
}
