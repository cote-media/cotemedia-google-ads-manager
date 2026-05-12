import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function POST(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.refreshToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { message, accountId, summary } = await request.json()
  if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  console.log('API key present:', !!apiKey, 'length:', apiKey?.length)

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: `You are an expert Google Ads analyst for Cote Media. Account data: ${JSON.stringify(summary)}`,
        messages: [{ role: 'user', content: message }],
      }),
    })

    const data = await response.json()
    console.log('Anthropic response status:', response.status)
    console.log('Anthropic response:', JSON.stringify(data).substring(0, 200))
    
    const responseText = data.content?.[0]?.text || 'No response generated.'
    return NextResponse.json({ response: responseText })
  } catch (error: any) {
    console.error('Chat error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
