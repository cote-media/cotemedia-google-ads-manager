import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../auth/[...nextauth]/route'
import { listAccessibleAccounts } from '@/lib/google-ads'

export async function GET() {
  const session = await getServerSession(authOptions) as any
  if (!session?.refreshToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const accounts = await listAccessibleAccounts(session.refreshToken)
    return NextResponse.json({ accounts })
  } catch (error: any) {
    console.error('Accounts error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}