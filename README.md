# Cote Media — Claude + Google Ads Manager

An internal agency tool that connects Google Ads to Claude AI, enabling natural language campaign management and reporting.

---

## Setup

### 1. Clone and install
```bash
git clone https://github.com/YOUR_USERNAME/cotemedia-ads-manager.git
cd cotemedia-ads-manager
npm install
```

### 2. Configure environment variables
Copy `.env.example` to `.env.local` and fill in your values:

```bash
cp .env.example .env.local
```

| Variable | Where to find it |
|---|---|
| `GOOGLE_CLIENT_ID` | Google Cloud Console → APIs & Services → Credentials |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console → APIs & Services → Credentials |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads → Tools → API Center |
| `GOOGLE_ADS_MANAGER_ACCOUNT_ID` | Your MCC account ID (numbers only, no dashes) |
| `NEXTAUTH_SECRET` | Run: `openssl rand -base64 32` |
| `NEXTAUTH_URL` | `http://localhost:3000` for local, your Vercel URL for production |

### 3. Run locally
```bash
npm run dev
```
Visit http://localhost:3000

### 4. Deploy to Vercel
1. Push this repo to GitHub
2. Go to vercel.com → Import Project → select this repo
3. Add all environment variables from `.env.local` in Vercel's dashboard
4. Add your Vercel URL to Google Cloud Console → Authorized redirect URIs:
   `https://your-app.vercel.app/api/auth/callback/google`
5. Deploy

---

## MCP Server (Claude Desktop)

To use this as an MCP server with Claude Desktop:

1. Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "cotemedia-ads": {
      "command": "node",
      "args": ["/absolute/path/to/cotemedia-ads-manager/mcp-server.js"],
      "env": {
        "GOOGLE_CLIENT_ID": "your_client_id",
        "GOOGLE_CLIENT_SECRET": "your_client_secret",
        "GOOGLE_ADS_DEVELOPER_TOKEN": "your_developer_token",
        "GOOGLE_ADS_MANAGER_ACCOUNT_ID": "your_mcc_id"
      }
    }
  }
}
```

2. Restart Claude Desktop
3. Claude can now call Google Ads tools directly in conversation

---

## Features

- **Overview dashboard** — spend, clicks, impressions, conversions, ROAS at a glance
- **Campaign table** — all campaigns with full performance metrics
- **Keywords** — top 200 keywords by spend with quality scores
- **Ask Claude** — chat interface to ask questions about account data in plain English
- **MCP Server** — expose all tools to Claude Desktop for direct integration

---

## Tech Stack

- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS
- NextAuth.js (Google OAuth)
- google-ads-api
- Anthropic MCP SDK
- Vercel (hosting)
