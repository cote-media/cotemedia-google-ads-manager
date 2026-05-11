#!/usr/bin/env node
/**
 * Cote Media Google Ads MCP Server
 * Exposes Google Ads data as MCP tools callable by Claude
 * 
 * Run with: node mcp-server.js
 * Then add to Claude Desktop: { "mcpServers": { "cotemedia-ads": { "command": "node", "args": ["/path/to/mcp-server.js"] } } }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { getCampaigns, getKeywords, getSearchTerms, getAccountSummary, listAccessibleAccounts } from './src/lib/google-ads.js'

const server = new Server(
  { name: 'cotemedia-google-ads', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

// ─── Tool Definitions ────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_accounts',
      description: 'List all Google Ads accounts accessible via the Cote Media manager account',
      inputSchema: {
        type: 'object',
        properties: {
          access_token: { type: 'string', description: 'Google OAuth access token' },
        },
        required: ['access_token'],
      },
    },
    {
      name: 'get_account_summary',
      description: 'Get a high-level performance summary for a Google Ads account including total spend, clicks, impressions, conversions, and ROAS',
      inputSchema: {
        type: 'object',
        properties: {
          access_token: { type: 'string', description: 'Google OAuth access token' },
          account_id: { type: 'string', description: 'Google Ads account ID (without dashes)' },
          date_range: {
            type: 'string',
            description: 'Date range for data',
            enum: ['LAST_7_DAYS', 'LAST_14_DAYS', 'LAST_30_DAYS', 'LAST_90_DAYS', 'THIS_MONTH', 'LAST_MONTH'],
            default: 'LAST_30_DAYS',
          },
        },
        required: ['access_token', 'account_id'],
      },
    },
    {
      name: 'get_campaigns',
      description: 'Get detailed campaign performance data for a Google Ads account',
      inputSchema: {
        type: 'object',
        properties: {
          access_token: { type: 'string', description: 'Google OAuth access token' },
          account_id: { type: 'string', description: 'Google Ads account ID' },
          date_range: {
            type: 'string',
            enum: ['LAST_7_DAYS', 'LAST_14_DAYS', 'LAST_30_DAYS', 'LAST_90_DAYS', 'THIS_MONTH', 'LAST_MONTH'],
            default: 'LAST_30_DAYS',
          },
        },
        required: ['access_token', 'account_id'],
      },
    },
    {
      name: 'get_keywords',
      description: 'Get keyword performance data including quality scores, CTR, CPC, and conversions',
      inputSchema: {
        type: 'object',
        properties: {
          access_token: { type: 'string', description: 'Google OAuth access token' },
          account_id: { type: 'string', description: 'Google Ads account ID' },
          date_range: {
            type: 'string',
            enum: ['LAST_7_DAYS', 'LAST_14_DAYS', 'LAST_30_DAYS', 'LAST_90_DAYS', 'THIS_MONTH', 'LAST_MONTH'],
            default: 'LAST_30_DAYS',
          },
        },
        required: ['access_token', 'account_id'],
      },
    },
    {
      name: 'get_search_terms',
      description: 'Get search term report showing actual queries that triggered ads — useful for finding negative keyword opportunities and new keyword ideas',
      inputSchema: {
        type: 'object',
        properties: {
          access_token: { type: 'string', description: 'Google OAuth access token' },
          account_id: { type: 'string', description: 'Google Ads account ID' },
          date_range: {
            type: 'string',
            enum: ['LAST_7_DAYS', 'LAST_14_DAYS', 'LAST_30_DAYS', 'LAST_90_DAYS', 'THIS_MONTH', 'LAST_MONTH'],
            default: 'LAST_30_DAYS',
          },
        },
        required: ['access_token', 'account_id'],
      },
    },
  ],
}))

// ─── Tool Execution ──────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    switch (name) {
      case 'list_accounts': {
        const accounts = await listAccessibleAccounts(args.access_token)
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(accounts, null, 2),
          }],
        }
      }

      case 'get_account_summary': {
        const summary = await getAccountSummary(
          args.access_token,
          args.account_id,
          args.date_range || 'LAST_30_DAYS'
        )
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(summary, null, 2),
          }],
        }
      }

      case 'get_campaigns': {
        const campaigns = await getCampaigns(
          args.access_token,
          args.account_id,
          args.date_range || 'LAST_30_DAYS'
        )
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(campaigns, null, 2),
          }],
        }
      }

      case 'get_keywords': {
        const keywords = await getKeywords(
          args.access_token,
          args.account_id,
          args.date_range || 'LAST_30_DAYS'
        )
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(keywords, null, 2),
          }],
        }
      }

      case 'get_search_terms': {
        const terms = await getSearchTerms(
          args.access_token,
          args.account_id,
          args.date_range || 'LAST_30_DAYS'
        )
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(terms, null, 2),
          }],
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  } catch (error: any) {
    return {
      content: [{
        type: 'text',
        text: `Error: ${error.message}`,
      }],
      isError: true,
    }
  }
})

// ─── Start Server ────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('Cote Media Google Ads MCP Server running')
}

main().catch(console.error)
