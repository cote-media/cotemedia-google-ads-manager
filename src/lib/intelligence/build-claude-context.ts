// ─── Universal Claude Context Builder ─────────────────────────────────────────
// Converts a ClientIntelligence object into a rich system prompt.
// Every Claude call uses this — InsightChat, AskClaudeButton, chat tab, everything.
// The `focus` parameter tells Claude what the user is currently looking at,
// but Claude always has access to ALL data regardless of focus.
//
// Conversation memory:
//   - ALL conversations across ALL panels for the client are merged together
//     (the user is the same user, talking about the same client — silo by panel
//     was wrong)
//   - Last 20 messages kept (was 6) so directives from earlier sessions aren't lost
//   - Per-message char limit raised to 800 (was 200) so directives buried in
//     longer messages aren't truncated
//   - Heuristic scan for "directive-like" statements ("ignore X", "focus on Y",
//     "don't recommend Z") — these are pulled into a dedicated DIRECTIVES section
//     at the top of the prompt so Claude can't miss them

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

// Phrases that suggest the user is giving Claude a standing instruction.
// We use these to extract probable directives from chat history and surface
// them prominently in the system prompt.
const DIRECTIVE_PATTERNS: RegExp[] = [
  /\bignore\b/i,
  /\bdon'?t\s+(?:focus|worry|mention|recommend|suggest|talk\s+about|pay\s+attention|use|consider|include)/i,
  /\bdo\s+not\s+(?:focus|worry|mention|recommend|suggest|talk\s+about|pay\s+attention|use|consider|include)/i,
  /\bstop\s+(?:mentioning|recommending|suggesting|focusing|talking)/i,
  /\bfocus\s+on\b/i,
  /\bprioriti[sz]e\b/i,
  /\b(?:we|i)\s+(?:only|just)\s+care\s+about/i,
  /\bnot\s+important\b/i,
  /\binstead\s+of\b/i,
  /\bremember\s+that\b/i,
  /\bkeep\s+in\s+mind\b/i,
  /\bnever\s+(?:mention|recommend|suggest|focus|use|include)/i,
  /\balways\s+(?:mention|recommend|suggest|focus|use|include|consider)/i,
  /\btarget\s+(?:is|for)\b.*\$/i,  // "target CPL is $35"
  /\bfor\s+now\b/i,
  /\bdeprioriti[sz]e\b/i,
]

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

function buildPlatformSection(platform: PlatformIntelligence, name: string): string {
  if (!platform?.connected || !platform.campaigns?.length) return ''
  const lines: string[] = []
  lines.push(`\n=== ${name.toUpperCase()} ADS ===`)
  lines.push(`Account Totals: ${formatMetrics(platform.totals)}`)

  // Campaigns
  if (platform.campaigns.length > 0) {
    lines.push(`\nCampaigns (${platform.campaigns.length} total):`)
    platform.campaigns.slice(0, 15).forEach(c => {
      const rule = OBJECTIVE_RULES[c.objective || ''] || ''
      lines.push(`  • ${c.name} [${c.objective || c.channelType || 'unknown'}] [${c.status}]`)
      if (c.bidStrategy) lines.push(`    Bid strategy: ${c.bidStrategy}`)
      if (c.budget) lines.push(`    Budget: $${c.budget.toFixed(2)}/day`)
      lines.push(`    ${formatMetrics(c.metrics, '    ')}`)
      if (rule) lines.push(`    ⚠ Rule: ${rule}`)
    })
  }

  // Ad Groups / Ad Sets
  if (platform.adGroups && platform.adGroups.length > 0) {
    lines.push(`\nAd Groups/Sets (top ${Math.min(platform.adGroups.length, 20)}):`)
    platform.adGroups.slice(0, 20).forEach(ag => {
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

  // Ads
  if (platform.ads && platform.ads.length > 0) {
    lines.push(`\nAds (top ${Math.min(platform.ads.length, 20)} by spend):`)
    platform.ads.slice(0, 20).forEach(ad => {
      lines.push(`  • ${ad.name} [${ad.creativeType || 'unknown'}] [${ad.status}]`)
      if (ad.headline) lines.push(`    Headline: "${ad.headline}"`)
      if (ad.body) lines.push(`    Body: "${ad.body.slice(0, 100)}${ad.body.length > 100 ? '...' : ''}"`)
      if (ad.callToAction) lines.push(`    CTA: ${ad.callToAction}`)
      lines.push(`    ${formatMetrics(ad.metrics, '    ')}`)
    })
  }

  // Keywords (Google only)
  if (platform.keywords && platform.keywords.length > 0) {
    lines.push(`\nTop Keywords (${platform.keywords.length} total):`)
    platform.keywords.slice(0, 20).forEach(kw => {
      lines.push(`  • "${kw.text}" [${kw.matchType}] [QS: ${kw.qualityScore || 'N/A'}] — ${formatMetrics(kw.metrics)}`)
    })
  }

  // Conversion Actions (Google only)
  if (platform.conversionActions && platform.conversionActions.length > 0) {
    lines.push(`\nConversion Actions:`)
    platform.conversionActions.forEach(ca => {
      lines.push(`  • ${ca.name} [${ca.category}] — ${ca.count.toFixed(1)} conv — ${ca.includeInConversions ? '✓ INCLUDED in conversions column' : '✗ NOT included'}`)
    })
  }

  return lines.join('\n')
}

// Returns a flat array of user messages across all panel/location keys,
// sorted by timestamp (most recent last) so when we slice the tail we get the
// latest activity regardless of which panel it came from.
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
  // If timestamps exist, sort by them. Otherwise keep insertion order.
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

// Scan all USER messages for directive-like statements. Returns an array of
// short excerpts (the matched message, trimmed) for surfacing prominently.
function extractDirectives(flat: Array<{ role: string; content: string }>): string[] {
  const directives: string[] = []
  const seen = new Set<string>()
  flat.forEach(m => {
    if (m.role !== 'user') return
    const content = m.content.trim()
    if (!content) return
    const matches = DIRECTIVE_PATTERNS.some(re => re.test(content))
    if (matches) {
      // Trim to first sentence or 300 chars, whichever shorter
      let snippet = content
      const sentenceEnd = snippet.search(/[.!?](?:\s|$)/)
      if (sentenceEnd > 0 && sentenceEnd < 300) snippet = snippet.slice(0, sentenceEnd + 1)
      else if (snippet.length > 300) snippet = snippet.slice(0, 297) + '...'
      const key = snippet.toLowerCase().replace(/\s+/g, ' ')
      if (!seen.has(key)) {
        seen.add(key)
        directives.push(snippet)
      }
    }
  })
  return directives
}

function buildConversationContext(conversations: Record<string, any[]>): string {
  if (!conversations || Object.keys(conversations).length === 0) return ''
  const flat = flattenConversations(conversations)
  if (!flat.length) return ''

  const lines = ['\n=== PREVIOUS CONVERSATIONS (across all panels for this client) ===']
  lines.push('(All discussions the user has had about this client. Treat these as binding context.)')

  // Keep the most recent 20 messages — wide enough to capture multi-session history,
  // tight enough to not blow context budget.
  const recent = flat.slice(-20)
  recent.forEach((m) => {
    const truncated = m.content.length > 800 ? m.content.slice(0, 797) + '...' : m.content
    lines.push(`  [${m.panelKey}] ${m.role === 'user' ? 'User' : 'Claude'}: ${truncated}`)
  })
  return lines.join('\n')
}

export function buildClaudeContext(
  intelligence: ClientIntelligence,
  focus: string = 'overview',
  focusData?: string
): string {
  const lines: string[] = []

  // ── Identity ───────────────────────────────────────────────────────────────
  lines.push(`You are an expert digital advertising analyst embedded in LoraMer, an ads management platform for marketing agencies.`)
  lines.push(`You are analyzing ${intelligence.clientName}.`)
  lines.push(`Date range: ${intelligence.dateRange?.replace(/_/g, ' ').toLowerCase()}`)
  lines.push(`Current view: ${focus}`)
  if (focusData) lines.push(`Specifically looking at: ${focusData}`)

  // ── DIRECTIVES (top priority — surfaces standing instructions from prior chats) ──
  const p = intelligence.profile
  const flatConversations = p.conversations ? flattenConversations(p.conversations) : []
  const directives = extractDirectives(flatConversations)
  if (directives.length > 0) {
    lines.push('\n=== STANDING DIRECTIVES FROM USER ===')
    lines.push('(The user previously said these things. Treat them as binding for this entire response. Do NOT contradict or ignore them.)')
    directives.forEach((d, i) => lines.push(`  ${i + 1}. "${d}"`))
  }

  // ── Client Profile ─────────────────────────────────────────────────────────
  if (p.businessType || p.primaryKpi || p.userNotes) {
    lines.push('\n=== CLIENT PROFILE ===')
    if (p.businessType) lines.push(`Business type: ${p.businessType}`)
    if (p.primaryKpi) lines.push(`Primary KPI: ${p.primaryKpi}`)
    if (p.funnelNotes) lines.push(`Funnel strategy: ${p.funnelNotes}`)
    if (p.userNotes) lines.push(`Important context: ${p.userNotes}`)
  }

  // ── Platform Data ──────────────────────────────────────────────────────────
  lines.push('\n=== COMPLETE ACCOUNT DATA ===')
  lines.push('(You have access to ALL data from ALL platforms. Use all of it to answer questions.)')

  if (intelligence.google) lines.push(buildPlatformSection(intelligence.google, 'Google'))
  if (intelligence.meta) lines.push(buildPlatformSection(intelligence.meta, 'Meta'))

  // ── Shopify ────────────────────────────────────────────────────────────────
  if (intelligence.shopify?.connected) {
    const s = intelligence.shopify
    lines.push('\n=== SHOPIFY ===')
    if (s.totalRevenue) lines.push(`Total Revenue: $${s.totalRevenue.toFixed(2)}`)
    if (s.totalOrders) lines.push(`Total Orders: ${s.totalOrders}`)
    if (s.avgOrderValue) lines.push(`Avg Order Value: $${s.avgOrderValue.toFixed(2)}`)
    if (s.newCustomers) lines.push(`New Customers: ${s.newCustomers}`)
    if (s.returningCustomers) lines.push(`Returning Customers: ${s.returningCustomers}`)
    if (s.topProducts?.length) {
      lines.push('Top Products:')
      s.topProducts.slice(0, 5).forEach(prod => {
        lines.push(`  • ${prod.name}: $${prod.revenue.toFixed(2)} revenue, ${prod.units} units`)
      })
    }
  }

  // ── Previous Conversations (full flat history) ─────────────────────────────
  if (p.conversations) lines.push(buildConversationContext(p.conversations))

  // ── Rules ──────────────────────────────────────────────────────────────────
  lines.push('\n=== ANALYSIS RULES ===')
  lines.push('CRITICAL: STANDING DIRECTIVES (above) override every other instruction. If the user said "ignore ROAS", do not mention ROAS as a problem, even in the insight banner. If they said "focus on lead volume", lead volume is your primary lens.')
  lines.push('Always respect campaign objectives. Never criticize a metric irrelevant to the objective.')
  lines.push('Be specific — use actual campaign names, ad names, and numbers.')
  lines.push('You are talking to an experienced agency professional. Skip basics.')
  lines.push('If you can see the data needed to answer a question, answer it directly without asking for more info.')

  return lines.join('\n')
}
