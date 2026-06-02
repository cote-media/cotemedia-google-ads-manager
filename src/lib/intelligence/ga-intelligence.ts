// LORAMER_GA_INTELLIGENCE_V1
// ─── Google Analytics 4 Intelligence Adapter ─────────────────────────────────
// Fetches seven GA4 Data API runReport buckets for a property.
// Output conforms to IntelligenceGa schema.

import { resolveDateWindow } from '@/lib/date-range'
import type {
  IntelligenceGa,
  IntelligenceGaCampaign,
  IntelligenceGaConversionEvent,
  IntelligenceGaCountry,
  IntelligenceGaDevice,
  IntelligenceGaLandingPage,
  IntelligenceGaProduct,
  IntelligenceGaTrafficSource,
  IntelligenceGaTransactionSource,
} from './intelligence-types'

const GA_DATA_API = 'https://analyticsdata.googleapis.com/v1beta'

type GaReportRow = {
  dimensionValues?: Array<{ value?: string }>
  metricValues?: Array<{ value?: string }>
}

type GaRunReportResponse = {
  rows?: GaReportRow[]
  error?: { message?: string }
}

function normalizePropertyId(propertyId: string): string {
  if (propertyId.startsWith('properties/')) return propertyId
  return `properties/${propertyId}`
}

function metricNum(row: GaReportRow, index: number): number {
  const raw = row.metricValues?.[index]?.value
  if (raw === undefined || raw === '') return 0
  const n = parseFloat(raw)
  return Number.isFinite(n) ? n : 0
}

function dimensionStr(row: GaReportRow, index: number): string {
  return row.dimensionValues?.[index]?.value || '(not set)'
}

async function runGaReport(
  propertyId: string,
  accessToken: string,
  body: Record<string, unknown>
): Promise<GaReportRow[]> {
  const url = `${GA_DATA_API}/${normalizePropertyId(propertyId)}:runReport`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const json = (await res.json()) as GaRunReportResponse & { message?: string }
  if (!res.ok) {
    throw new Error(json.error?.message || json.message || `GA runReport HTTP ${res.status}`)
  }
  return json.rows || []
}

function dateRanges(
  startDate: string,
  endDate: string
): Array<{ startDate: string; endDate: string }> {
  return [{ startDate, endDate }]
}

function orderByMetric(metricName: string, desc = true) {
  return [{ metric: { metricName }, desc }]
}

// LORAMER_GA_INTELLIGENCE_V1 — bucket 1: account totals
async function fetchAccountTotals(
  propertyId: string,
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<Partial<IntelligenceGa>> {
  try {
    const rows = await runGaReport(propertyId, accessToken, {
      dateRanges: dateRanges(startDate, endDate),
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'newUsers' },
        { name: 'engagementRate' },
        { name: 'conversions' },
        { name: 'totalRevenue' },
        { name: 'transactions' },
      ],
    })
    const row = rows[0]
    if (!row) {
      return {
        sessions: 0,
        totalUsers: 0,
        newUsers: 0,
        engagementRate: 0,
        conversions: 0,
        totalRevenue: 0,
        transactions: 0,
      }
    }
    return {
      sessions: metricNum(row, 0),
      totalUsers: metricNum(row, 1),
      newUsers: metricNum(row, 2),
      engagementRate: metricNum(row, 3),
      conversions: metricNum(row, 4),
      totalRevenue: metricNum(row, 5),
      transactions: metricNum(row, 6),
    }
  } catch (e) {
    console.error('[ga-intelligence] account totals failed:', e)
    return {
      sessions: 0,
      totalUsers: 0,
      newUsers: 0,
      engagementRate: 0,
      conversions: 0,
      totalRevenue: 0,
      transactions: 0,
    }
  }
}

// LORAMER_GA_INTELLIGENCE_V1 — bucket 2: top traffic sources
async function fetchTopTrafficSources(
  propertyId: string,
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<IntelligenceGaTrafficSource[]> {
  try {
    const rows = await runGaReport(propertyId, accessToken, {
      dateRanges: dateRanges(startDate, endDate),
      dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
      metrics: [
        { name: 'sessions' },
        { name: 'conversions' },
        { name: 'totalRevenue' },
      ],
      limit: 20,
      orderBys: orderByMetric('sessions'),
    })
    return rows.map((row) => ({
      source: dimensionStr(row, 0),
      medium: dimensionStr(row, 1),
      sessions: metricNum(row, 0),
      conversions: metricNum(row, 1),
      totalRevenue: metricNum(row, 2),
    }))
  } catch (e) {
    console.error('[ga-intelligence] top traffic sources failed:', e)
    return []
  }
}

// LORAMER_GA_INTELLIGENCE_V1 — bucket 3: top campaigns
async function fetchTopCampaigns(
  propertyId: string,
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<IntelligenceGaCampaign[]> {
  try {
    const rows = await runGaReport(propertyId, accessToken, {
      dateRanges: dateRanges(startDate, endDate),
      dimensions: [{ name: 'sessionCampaignName' }],
      metrics: [
        { name: 'sessions' },
        { name: 'conversions' },
        { name: 'totalRevenue' },
      ],
      limit: 20,
      orderBys: orderByMetric('sessions'),
    })
    return rows.map((row) => ({
      campaignName: dimensionStr(row, 0),
      sessions: metricNum(row, 0),
      conversions: metricNum(row, 1),
      totalRevenue: metricNum(row, 2),
    }))
  } catch (e) {
    console.error('[ga-intelligence] top campaigns failed:', e)
    return []
  }
}

// LORAMER_GA_INTELLIGENCE_V1 — bucket 4: top landing pages
async function fetchTopLandingPages(
  propertyId: string,
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<IntelligenceGaLandingPage[]> {
  try {
    const rows = await runGaReport(propertyId, accessToken, {
      dateRanges: dateRanges(startDate, endDate),
      dimensions: [{ name: 'landingPagePlusQueryString' }],
      metrics: [{ name: 'sessions' }, { name: 'sessionConversionRate' }],
      limit: 20,
      orderBys: orderByMetric('sessions'),
    })
    return rows.map((row) => ({
      landingPage: dimensionStr(row, 0),
      sessions: metricNum(row, 0),
      sessionConversionRate: metricNum(row, 1),
    }))
  } catch (e) {
    console.error('[ga-intelligence] top landing pages failed:', e)
    return []
  }
}

// LORAMER_GA_INTELLIGENCE_V1 — bucket 5: conversion events
async function fetchConversionEvents(
  propertyId: string,
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<IntelligenceGaConversionEvent[]> {
  try {
    const rows = await runGaReport(propertyId, accessToken, {
      dateRanges: dateRanges(startDate, endDate),
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'eventCount' }, { name: 'eventValue' }],
      dimensionFilter: {
        filter: {
          fieldName: 'isConversionEvent',
          stringFilter: { matchType: 'EXACT', value: 'true' },
        },
      },
      limit: 20,
      orderBys: orderByMetric('eventCount'),
    })
    return rows.map((row) => ({
      eventName: dimensionStr(row, 0),
      eventCount: metricNum(row, 0),
      eventValue: metricNum(row, 1),
    }))
  } catch (e) {
    console.error('[ga-intelligence] conversion events failed:', e)
    return []
  }
}

// LORAMER_GA_INTELLIGENCE_V1 — bucket 6: geo + device
async function fetchGeoAndDevice(
  propertyId: string,
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<{ topCountries: IntelligenceGaCountry[]; deviceSplit: IntelligenceGaDevice[] }> {
  let topCountries: IntelligenceGaCountry[] = []
  let deviceSplit: IntelligenceGaDevice[] = []

  try {
    const countryRows = await runGaReport(propertyId, accessToken, {
      dateRanges: dateRanges(startDate, endDate),
      dimensions: [{ name: 'country' }],
      metrics: [{ name: 'sessions' }],
      limit: 10,
      orderBys: orderByMetric('sessions'),
    })
    topCountries = countryRows.map((row) => ({
      country: dimensionStr(row, 0),
      sessions: metricNum(row, 0),
    }))
  } catch (e) {
    console.error('[ga-intelligence] geo (countries) failed:', e)
  }

  try {
    const deviceRows = await runGaReport(propertyId, accessToken, {
      dateRanges: dateRanges(startDate, endDate),
      dimensions: [{ name: 'deviceCategory' }],
      metrics: [{ name: 'sessions' }],
      orderBys: orderByMetric('sessions'),
    })
    deviceSplit = deviceRows.map((row) => ({
      deviceCategory: dimensionStr(row, 0),
      sessions: metricNum(row, 0),
    }))
  } catch (e) {
    console.error('[ga-intelligence] device split failed:', e)
  }

  return { topCountries, deviceSplit }
}

// LORAMER_GA_INTELLIGENCE_V1 — bucket 7: e-commerce
async function fetchEcommerce(
  propertyId: string,
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<{
  topProducts: IntelligenceGaProduct[]
  transactionsBySource: IntelligenceGaTransactionSource[]
  cartToPurchaseRate: number
  purchaserConversionRate: number
  refundAmount: number
}> {
  let topProducts: IntelligenceGaProduct[] = []
  let transactionsBySource: IntelligenceGaTransactionSource[] = []
  let cartToPurchaseRate = 0
  let purchaserConversionRate = 0
  let refundAmount = 0

  try {
    const productRows = await runGaReport(propertyId, accessToken, {
      dateRanges: dateRanges(startDate, endDate),
      dimensions: [{ name: 'itemName' }],
      metrics: [{ name: 'itemsPurchased' }, { name: 'itemRevenue' }],
      limit: 20,
      orderBys: orderByMetric('itemRevenue'),
    })
    topProducts = productRows.map((row) => ({
      itemName: dimensionStr(row, 0),
      itemsPurchased: metricNum(row, 0),
      itemRevenue: metricNum(row, 1),
    }))
  } catch (e) {
    console.error('[ga-intelligence] e-commerce top products failed:', e)
  }

  try {
    const txnRows = await runGaReport(propertyId, accessToken, {
      dateRanges: dateRanges(startDate, endDate),
      dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
      metrics: [{ name: 'transactions' }],
      limit: 20,
      orderBys: orderByMetric('transactions'),
    })
    transactionsBySource = txnRows.map((row) => ({
      source: dimensionStr(row, 0),
      medium: dimensionStr(row, 1),
      transactions: metricNum(row, 0),
    }))
  } catch (e) {
    console.error('[ga-intelligence] e-commerce transactions by source failed:', e)
  }

  try {
    const rateRows = await runGaReport(propertyId, accessToken, {
      dateRanges: dateRanges(startDate, endDate),
      metrics: [
        { name: 'addToCarts' },
        { name: 'transactions' },
        { name: 'purchaserConversionRate' },
      ],
    })
    const rateRow = rateRows[0]
    if (rateRow) {
      const addToCarts = metricNum(rateRow, 0)
      const txns = metricNum(rateRow, 1)
      cartToPurchaseRate = addToCarts > 0 ? txns / addToCarts : 0
      purchaserConversionRate = metricNum(rateRow, 2)
    }
  } catch (e) {
    console.error('[ga-intelligence] e-commerce conversion rates failed:', e)
  }

  try {
    const refundRows = await runGaReport(propertyId, accessToken, {
      dateRanges: dateRanges(startDate, endDate),
      metrics: [{ name: 'refundAmount' }],
    })
    refundAmount = metricNum(refundRows[0] || {}, 0)
  } catch (e) {
    console.error('[ga-intelligence] e-commerce refunds failed:', e)
  }

  return {
    topProducts,
    transactionsBySource,
    cartToPurchaseRate,
    purchaserConversionRate,
    refundAmount,
  }
}

export async function fetchGaIntelligence(
  propertyId: string,
  accessToken: string,
  dateRange: string,
  propertyName?: string,
  customStart?: string,
  customEnd?: string
): Promise<IntelligenceGa> {
  // LORAMER_DATE_RANGE_CANONICAL_V1
  const { startDate, endDate } = resolveDateWindow(dateRange, customStart, customEnd)

  const [
    totals,
    topTrafficSources,
    topCampaigns,
    topLandingPages,
    conversionEvents,
    geoDevice,
    ecommerce,
  ] = await Promise.all([
    fetchAccountTotals(propertyId, accessToken, startDate, endDate),
    fetchTopTrafficSources(propertyId, accessToken, startDate, endDate),
    fetchTopCampaigns(propertyId, accessToken, startDate, endDate),
    fetchTopLandingPages(propertyId, accessToken, startDate, endDate),
    fetchConversionEvents(propertyId, accessToken, startDate, endDate),
    fetchGeoAndDevice(propertyId, accessToken, startDate, endDate),
    fetchEcommerce(propertyId, accessToken, startDate, endDate),
  ])

  return {
    connected: true,
    propertyId: normalizePropertyId(propertyId),
    propertyName: propertyName || propertyId,
    ...totals,
    topTrafficSources,
    topCampaigns,
    topLandingPages,
    conversionEvents,
    topCountries: geoDevice.topCountries,
    deviceSplit: geoDevice.deviceSplit,
    topProducts: ecommerce.topProducts,
    transactionsBySource: ecommerce.transactionsBySource,
    cartToPurchaseRate: ecommerce.cartToPurchaseRate,
    purchaserConversionRate: ecommerce.purchaserConversionRate,
    refundAmount: ecommerce.refundAmount,
  }
}
