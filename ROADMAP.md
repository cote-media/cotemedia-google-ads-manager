# CMAM — Cote Media Ads Manager
## Product Roadmap & Feature Backlog
*Last updated: May 12, 2026*

---

## 🔥 Immediate (This Week)
- [ ] Fix Match type showing numbers (4=Broad, 3=Phrase, 2=Exact)
- [ ] Fix QS column — color code green/yellow/red, add tooltip explanation
- [ ] Verify Vercel auto-deploy triggering from GitHub pushes
- [ ] Fix Claude saying "Cote Media" instead of client name in chat

---

## 🛠 2-Week Beta Sprint
- [ ] localStorage to persist chat history across browser refreshes
- [ ] PDF and Word download options for chat transcripts
- [ ] Agency vs. business owner onboarding flow
- [ ] Mobile layout
- [ ] Apply for Google Ads Standard API access
- [ ] Add definition/legend key for metrics (Match type, QS, etc.)

---

## 🧠 AI & Chat Features
- [ ] Persistent memory across sessions (paid tier upsell)
- [ ] Pre-built prompt library
- [ ] Automated weekly client report — Claude writes it, exports to PDF/Word
- [ ] Anomaly detection with plain English alerts
- [ ] Claude remembers account-specific context permanently
- [ ] Claude voice wake word (when Anthropic supports it)

---

## 📊 Data & Reporting
- [ ] Ad group level data
- [ ] Device breakdown (mobile vs desktop)
- [ ] Time of day / day of week performance
- [ ] Audience performance data
- [ ] Conversion type segmentation (calls vs web signups)
- [ ] Cross-platform combined view
- [ ] Budget pacing alerts

---

## 🔌 Platform Integrations (Priority Order)
1. Meta Ads — full dashboard integration
2. Microsoft/Bing Ads
3. TikTok Ads
4. Amazon Ads
5. LinkedIn Ads
6. X/Twitter Ads
7. Pinterest Ads
8. Snapchat Ads
9. Reddit Ads

**Architecture note:** Consider Unified Advertising API (e.g. Unified.to) to scale to 8+ platforms without rebuilding each one.

---

## 👥 User Experience
- [ ] Platform selection onboarding
- [ ] Agency vs Business Owner onboarding (affects Claude tone, not platform access)
- [ ] Client portal — read-only view for clients
- [ ] White label option
- [ ] Team member access
- [ ] Custom domain support

---

## 💰 Pricing Tiers (Draft)
| Tier | Price | Key Features |
|------|-------|-------------|
| Basic | ~$49/mo | Reporting, 4-exchange memory, download transcript |
| Pro | ~$99/mo | Full session memory, search terms in chat, multi-account |
| Agency | ~$199/mo | Persistent memory, auto reports, client portal, white label |

---

## 🏗 Technical Debt
- [ ] Upgrade Next.js 14.2.3 (security vulnerability)
- [ ] Fix npm deprecation warnings
- [ ] Add error boundaries and user-friendly error messages
- [ ] Rate limiting on API routes

---

## 💡 Ideas & Notes
- CMAM = Cote Media Ads Manager
- Claude works for the agency, not Google — key differentiator vs Ads Advisor
- "AI that works for you, not for the platform" — potential tagline
- Business owners AND agencies both need multi-platform support
- Amazon + Google + Meta in one tool would be genuinely rare
- Siri Shortcut workaround available for voice prompting now
- Usage limit on Claude Pro resets per session (~every few hours for heavy use)

---

## ✅ Completed
- [x] Google Ads API connected
- [x] OAuth login with Google
- [x] Campaign, keyword, search term data
- [x] Date range picker
- [x] Account sticky on refresh (URL persistence)
- [x] Tab sticky on refresh
- [x] Claude chat with full account context
- [x] Markdown rendering in chat
- [x] 4-exchange memory system
- [x] Download chat transcript
- [x] Upload transcript to resume conversation
- [x] Auto-scroll to bottom on new message
- [x] Exchange counter resets after upload
- [x] Red warning banner before memory reset
- [x] Hard stop after 4 exchanges with download prompt
- [x] Campaign status labels (Active/Paused/Removed)
- [x] Campaign type labels (Search/Display/etc)
