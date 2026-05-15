import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { totals, campaigns, platform, dateRange, clientName } = await request.json()

  if (!totals || !campaigns) return NextResponse.json({ error: 'Missing data' }, { status: 400 })

  const platformLabel = platform === 'google' ? 'Google Ads' : platform === 'meta' ? 'Meta Ads' : 'Google Ads + Meta Ads combined'
  const dateLabel = dateRange?.replace(/_/g, ' ').toLowerCase() || 'the selected period'

  // Build a concise data summary for Claude
  const topCampaigns = [...campaigns]
    .sort((a: any, b: any) => (b.spend || 0) - (a.spend || 0))
    .slice(0, 8)
    .map((c: any) => ({
      name: c.name,
      platform: c.platform,
      spend: c.spend?.toFixed(2),
      clicks: c.clicks,
      ctr: c.ctr?.toFixed(2),
      conversions: c.conversions?.toFixed(1),
      roas: c.roas?.toFixed(2) || null,
      costPerConv: c.costPerConv?.toFixed(2) || null,
      status: c.status,
    }))

  const prompt = `You are an expert digital advertising analyst reviewing ${clientName}'s ${platformLabel} performance for ${dateLabel}.

Account Summary:
- Total Spend: $${Number(totals.spend).toLocaleString()}
- Clicks: ${Number(totals.clicks).toLocaleString()}
- Impressions: ${Number(totals.impressions).toLocaleString()}
- Conversions: ${totals.conversions}
- ROAS: ${totals.roas ? totals.roas.toFixed(2) + 'x' : 'N/A'}
- Avg CTR: ${totals.avgCtr?.toFixed(2)}%
- Active Campaigns: ${totals.activeCampaigns}

Top Campaigns by Spend:
${topCampaigns.map((c: any) => `- ${c.name}${c.platform ? ' (' + c.platform + ')' : ''}: $${c.spend} spend, ${c.conversions} conv, ROAS ${c.roas || 'N/A'}x, CTR ${c.ctr}%, Status: ${c.status}`).join('\n')}

Write a 1-2 sentence insight for a busy agency owner. Be specific — mention actual campaign names and numbers. Focus on the single most important thing to know or act on. No markdown. No fluff. Direct and confident. Maximum 50 words.`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    })

    const insight = (response.content[0] as any).text?.trim() || ''
    return NextResponse.json({ insight })
  } catch (e: any) {
    console.error('Insight API error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
