#!/usr/bin/env python3
"""
LoraMer popover->panel migration.

Replaces both popover components (AskClaudeButton, AskClaudeCardButton)
with thin buttons that open the existing RightPanel, passing along
suggested prompts. RightPanel is extended to render those prompts.

Atomic: validates ALL anchors and ranges before writing. Idempotent.

Usage:  python3 popover_to_panel.py
"""
import os
import sys

PATH = os.path.expanduser(
    "~/Downloads/cotemedia-ads-manager/src/app/dashboard/page.tsx"
)

MARKER = "LORAMER_PANEL_ONLY_V1"


def fatal(msg):
    print("FATAL:", msg)
    sys.exit(1)


# ===========================================================================
# Replacement strings
# ===========================================================================

# 1. New RightPanel function body. Replaces lines 634 through 774.
NEW_RIGHT_PANEL = '''function RightPanel({ open, onClose, onMinimize, title, context, messages, setMessages, input, setInput, loading, setLoading, clientId, clientName, platform, dateRange, quickPrompts }: {
  open: boolean; onClose: () => void; onMinimize: () => void
  title: string; context: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  setMessages: (msgs: { role: 'user' | 'assistant'; content: string }[]) => void
  input: string; setInput: (v: string) => void
  loading: boolean; setLoading: (v: boolean) => void
  clientId: string; clientName: string; platform: Platform; dateRange: string
  quickPrompts?: string[]  // LORAMER_PANEL_ONLY_V1
}) {
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function saveToClient(msgs: { role: 'user' | 'assistant'; content: string }[]) {
    if (!clientId) return
    try {
      const r = await fetch('/api/context?clientId=' + clientId)
      const d = await r.json()
      const existing = d.context?.conversations || {}
      const key = 'panel:' + title.toLowerCase().replace(/\\s+/g, '-') + ':' + platform
      await fetch('/api/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, updates: { conversations: { ...existing, [key]: msgs } } })
      })
      invalidateInsightCaches(clientId)
    } catch {}
  }

  async function send(forcedMessage?: string) {
    const userMsg = (forcedMessage || input).trim()
    if (!userMsg || loading) return
    if (!forcedMessage) setInput('')
    setLoading(true)
    const newMessages = [...messages, { role: 'user' as const, content: userMsg }]
    setMessages(newMessages)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          history: newMessages.slice(0, -1),
          platform, dateRange, clientId, clientName,
          rowContext: context,
        }),
      })
      const d = await res.json()
      const final = [...newMessages, { role: 'assistant' as const, content: d.response || 'Something went wrong.' }]
      setMessages(final)
      saveToClient(final)
    } catch {
      setMessages([...newMessages, { role: 'assistant' as const, content: 'Something went wrong.' }])
    } finally { setLoading(false) }
  }

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-40 pointer-events-none" />
      <div className="fixed right-0 top-0 bottom-0 w-full md:w-96 bg-white border-l border-border shadow-2xl z-50 flex flex-col">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-white flex-shrink-0">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-mono text-accent">\u2726 Ask Claude</p>
            <p className="text-sm font-medium text-ink truncate">{title}</p>
          </div>
          <div className="flex items-center gap-1 ml-3">
            <button onClick={onMinimize} title="Minimize"
              className="text-muted hover:text-ink transition-colors text-base leading-none px-1.5 py-0.5 hover:bg-surface rounded">
              \u2212
            </button>
            <button onClick={onClose} title="Close"
              className="text-muted hover:text-ink transition-colors text-base leading-none px-1.5 py-0.5 hover:bg-surface rounded">
              \u00d7
            </button>
          </div>
        </div>

        {context && (
          <div className="px-4 py-2 bg-surface border-b border-border flex-shrink-0">
            <p className="text-xs text-muted font-mono truncate">{context}</p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.length === 0 && (!quickPrompts || quickPrompts.length === 0) && (
            <div className="text-center py-8">
              <p className="text-sm text-muted font-mono">Ask anything about {title}</p>
            </div>
          )}
          {messages.length === 0 && quickPrompts && quickPrompts.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-mono text-muted uppercase tracking-wider mb-3">Try asking</p>
              {quickPrompts.map(q => (
                <button key={q} onClick={() => send(q)} disabled={loading}
                  className="w-full text-left text-sm text-ink bg-surface hover:bg-blue-50 hover:text-accent border border-border rounded-lg px-3 py-2.5 transition-colors disabled:opacity-50">
                  {q}
                </button>
              ))}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={'flex ' + (m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div className={'text-sm px-3 py-2.5 rounded-xl max-w-[90%] leading-relaxed ' + (m.role === 'user' ? 'bg-accent text-white' : 'bg-surface text-ink border border-border')}>
                {m.role === 'user'
                  ? m.content
                  : <div className="chat-response prose prose-sm max-w-none"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown></div>
                }
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-surface border border-border px-3 py-2.5 rounded-xl flex gap-1">
                <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="px-4 py-3 border-t border-border bg-white flex-shrink-0">
          <div className="flex gap-2">
            <input type="text" value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send()}
              placeholder="Ask anything..." disabled={loading}
              className="flex-1 text-sm border border-border rounded-lg px-3 py-2 bg-paper focus:outline-none focus:border-accent disabled:opacity-50" />
            <button onClick={() => send()} disabled={loading || !input.trim()}
              className="bg-accent text-white text-sm px-3 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">\u2191</button>
          </div>
          {messages.length > 0 && (
            <p className="text-xs text-muted font-mono mt-2 text-center">
              {messages.length} messages \u00b7 saved to client profile
            </p>
          )}
        </div>
      </div>
    </>
  )
}
'''

# 2. Replacement for AskClaudeButton (row diamonds). Replaces 776 through 989.
NEW_ASK_CLAUDE_BUTTON = '''// \u2500\u2500\u2500 Ask Claude Button (row diamond) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// LORAMER_PANEL_ONLY_V1 - thin wrapper, opens RightPanel with row context and quick prompts
function AskClaudeButton({ row, level, platform, clientId, clientName, dateRange, openPanel }: {
  row: any; level: DrillLevel; platform: Platform
  clientId: string; clientName: string; dateRange: string
  openPanel: (title: string, context: string, messages: { role: 'user' | 'assistant'; content: string }[], quickPrompts?: string[]) => void
}) {
  const levelLabel = level === 'campaigns' ? 'Campaign' : level === 'adgroups' ? (platform === 'meta' ? 'Ad Set' : 'Ad Group') : 'Ad'
  const rowContext = [
    levelLabel + ': ' + row.name,
    row.platform ? 'Platform: ' + row.platform : null,
    row.status ? 'Status: ' + row.status : null,
    row.objective ? 'Objective: ' + row.objective : null,
    row.spend != null ? 'Spend: $' + Number(row.spend).toFixed(2) : null,
    row.budget != null ? 'Daily budget: $' + Number(row.budget).toFixed(2) : null,
    row.clicks != null ? 'Clicks: ' + Number(row.clicks).toLocaleString() : null,
    row.impressions != null ? 'Impressions: ' + Number(row.impressions).toLocaleString() : null,
    row.ctr != null ? 'CTR: ' + Number(row.ctr).toFixed(2) + '%' : null,
    row.avgCpc != null ? 'Avg CPC: $' + Number(row.avgCpc).toFixed(2) : null,
    row.cpm != null ? 'CPM: $' + Number(row.cpm).toFixed(2) : null,
    row.reach != null ? 'Reach: ' + Number(row.reach).toLocaleString() : null,
    row.frequency != null ? 'Frequency: ' + Number(row.frequency).toFixed(2) : null,
    row.conversions != null ? 'Conversions: ' + Number(row.conversions).toFixed(1) : null,
    row.conversionValue != null && row.conversionValue > 0 ? 'Conv value: $' + Number(row.conversionValue).toFixed(2) : null,
    row.roas != null ? 'ROAS: ' + Number(row.roas).toFixed(2) + 'x' : null,
    row.costPerConv != null ? 'Cost per conv: $' + Number(row.costPerConv).toFixed(2) : null,
    row.convRate != null ? 'Conv rate: ' + Number(row.convRate).toFixed(2) + '%' : null,
    row.purchases != null ? 'Purchases: ' + row.purchases : null,
    row.addToCart != null ? 'Add to cart: ' + row.addToCart : null,
    row.initiateCheckout != null ? 'Initiate checkout: ' + row.initiateCheckout : null,
    row.costPerPurchase != null ? 'Cost per purchase: $' + Number(row.costPerPurchase).toFixed(2) : null,
    row.description ? 'Ad copy: ' + row.description : null,
    row.body ? 'Ad body: ' + row.body : null,
  ].filter(Boolean).join(' \u00b7 ')

  const quickPrompts = [
    'Why is this underperforming?',
    'What should I do with this?',
    'How does this compare to account average?',
  ]

  return (
    <button
      onClick={e => { e.stopPropagation(); openPanel(row.name, rowContext, [], quickPrompts) }}
      title={'Ask Claude about this ' + levelLabel.toLowerCase()}
      className="text-xs text-accent hover:bg-blue-100 transition-colors rounded px-1 py-0.5"
    >
      \u2726
    </button>
  )
}
'''

# 3. Replacement for AskClaudeCardButton (card diamonds). Replaces 1510 through 1675.
NEW_ASK_CLAUDE_CARD_BUTTON = '''function AskClaudeCardButton({ cardTitle, cardData, clientId, clientName, platform, dateRange, openPanel }: {
  cardTitle: string; cardData: string
  clientId: string; clientName: string; platform: Platform; dateRange: string
  openPanel: (title: string, context: string, messages: { role: 'user' | 'assistant'; content: string }[], quickPrompts?: string[]) => void
}) {
  // LORAMER_PANEL_ONLY_V1 - thin wrapper, opens RightPanel with card context and quick prompts
  const quickPromptsByCard: Record<string, string[]> = {
    'Campaign Performance': ['Which campaign should get more budget?', "What's underperforming here?", 'Any quick wins?'],
    'Conversion Leaders': ['Why is the top campaign converting so well?', 'How do I replicate this?', 'Is my CPA healthy?'],
    'Budget Utilization': ['Am I overspending anywhere?', 'Should I adjust any budgets?', 'Where should I reallocate?'],
    'Top Keywords': ['Any wasted spend here?', 'Which keywords should I pause?', "What's my best keyword?"],
    'Top Keywords by Spend': ['Any wasted spend here?', 'Which keywords should I pause?', "What's my best keyword?"],
  }
  const quickPrompts = quickPromptsByCard[cardTitle] || ['Tell me more about this', 'Any recommendations?', 'What should I do next?']
  const cardContext = 'Overview page \u2014 ' + cardTitle + ' card:\\n' + cardData

  return (
    <button
      onClick={() => openPanel(cardTitle, cardContext, [], quickPrompts)}
      title={'Ask Claude about ' + cardTitle}
      className="text-xs text-accent hover:bg-blue-100 transition-colors px-1.5 py-0.5 rounded"
    >
      \u2726
    </button>
  )
}
'''


def main():
    if not os.path.exists(PATH):
        fatal(f"file not found: {PATH}")

    with open(PATH) as f:
        text = f.read()

    if MARKER in text:
        print("Already applied. No-op.")
        return

    lines = text.split("\n")

    # ===================================================================
    # Locate the function boundaries dynamically
    # ===================================================================

    # RightPanel: line containing "function RightPanel({" through the line
    # right BEFORE "// ─── Ask Claude Button + Popover"
    rp_start = None
    rp_end = None
    acb_start = None
    acb_end = None
    accb_start = None
    accb_end = None

    for i, line in enumerate(lines):
        if line.startswith("function RightPanel({") and rp_start is None:
            rp_start = i
        if line.startswith("// \u2500\u2500\u2500 Ask Claude Button") and rp_end is None:
            rp_end = i  # exclusive of this line
        if line.startswith("function AskClaudeButton({") and acb_start is None:
            # acb_start is BEFORE this — start at the comment header above
            acb_start = i - 1  # include the // ─── comment
            # but we want the comment line itself if it's there
            if "Ask Claude Button" in lines[i - 1] and "\u2500" in lines[i - 1]:
                acb_start = i - 1
            else:
                acb_start = i
        if line.startswith("function DrillTable({") and acb_end is None:
            acb_end = i  # exclusive — DrillTable stays
        if line.startswith("function AskClaudeCardButton({") and accb_start is None:
            accb_start = i
        if line.startswith("// \u2500\u2500\u2500 Overview Tab") and accb_end is None:
            accb_end = i  # exclusive

    if rp_start is None: fatal("RightPanel start not found")
    if rp_end is None: fatal("RightPanel end (Ask Claude Button header) not found")
    if acb_start is None: fatal("AskClaudeButton start not found")
    if acb_end is None: fatal("AskClaudeButton end (DrillTable) not found")
    if accb_start is None: fatal("AskClaudeCardButton start not found")
    if accb_end is None: fatal("AskClaudeCardButton end (Overview Tab comment) not found")

    print(f"RightPanel: lines {rp_start+1}-{rp_end} ({rp_end - rp_start} lines)")
    print(f"AskClaudeButton: lines {acb_start+1}-{acb_end} ({acb_end - acb_start} lines)")
    print(f"AskClaudeCardButton: lines {accb_start+1}-{accb_end} ({accb_end - accb_start} lines)")

    # Sanity: ranges must be in order and non-overlapping
    if not (rp_start < rp_end <= acb_start < acb_end <= accb_start < accb_end):
        fatal(f"Range ordering wrong: {rp_start}/{rp_end}/{acb_start}/{acb_end}/{accb_start}/{accb_end}")

    # ===================================================================
    # Build the new file content by replacing each range
    # ===================================================================
    # Work backwards so earlier indices stay valid.

    new_lines = list(lines)

    # 3rd replacement (highest indices): AskClaudeCardButton
    new_block = NEW_ASK_CLAUDE_CARD_BUTTON.rstrip("\n").split("\n")
    new_lines = new_lines[:accb_start] + new_block + new_lines[accb_end:]

    # Recompute boundaries after this replacement
    # (Above this point indices haven't shifted)

    # 2nd replacement: AskClaudeButton
    new_block = NEW_ASK_CLAUDE_BUTTON.rstrip("\n").split("\n")
    new_lines = new_lines[:acb_start] + new_block + new_lines[acb_end:]

    # 1st replacement: RightPanel
    new_block = NEW_RIGHT_PANEL.rstrip("\n").split("\n")
    new_lines = new_lines[:rp_start] + new_block + new_lines[rp_end:]

    new_text = "\n".join(new_lines)

    # ===================================================================
    # Patch openPanel signature and its caller (the panel render block)
    # ===================================================================
    # 4a. Function signature
    old_sig = "  function openPanel(title: string, context: string, existingMessages: { role: 'user' | 'assistant'; content: string }[] = []) {"
    new_sig = "  function openPanel(title: string, context: string, existingMessages: { role: 'user' | 'assistant'; content: string }[] = [], quickPrompts: string[] = []) {  // LORAMER_PANEL_ONLY_V1"

    if old_sig not in new_text:
        fatal("openPanel signature anchor missing")
    new_text = new_text.replace(old_sig, new_sig, 1)
    print("openPanel signature patched")

    # 4b. Body — add a state setter for quickPrompts.
    # Anchor is the existing setter cascade inside openPanel.
    old_body = (
        "    setPanelTitle(title); lsSet('loramer-panel-title', title)\n"
        "    setPanelContext(context); lsSet('loramer-panel-context', context)\n"
        "    setPanelMessages(existingMessages); lsSet('loramer-panel-messages', JSON.stringify(existingMessages))\n"
        "    setPanelOpen(true); lsSet('loramer-panel-open', 'true')\n"
        "    setPanelMinimized(false); lsSet('loramer-panel-minimized', 'false')"
    )
    new_body = (
        "    setPanelTitle(title); lsSet('loramer-panel-title', title)\n"
        "    setPanelContext(context); lsSet('loramer-panel-context', context)\n"
        "    setPanelMessages(existingMessages); lsSet('loramer-panel-messages', JSON.stringify(existingMessages))\n"
        "    setPanelQuickPrompts(quickPrompts)  // LORAMER_PANEL_ONLY_V1\n"
        "    setPanelOpen(true); lsSet('loramer-panel-open', 'true')\n"
        "    setPanelMinimized(false); lsSet('loramer-panel-minimized', 'false')"
    )
    if old_body not in new_text:
        fatal("openPanel body anchor missing")
    new_text = new_text.replace(old_body, new_body, 1)
    print("openPanel body patched (quickPrompts setter)")

    # 4c. Add the state declaration alongside the others
    old_state = "  const [panelLoading, setPanelLoading] = useState(false)"
    new_state = (
        "  const [panelLoading, setPanelLoading] = useState(false)\n"
        "  const [panelQuickPrompts, setPanelQuickPrompts] = useState<string[]>([])  // LORAMER_PANEL_ONLY_V1"
    )
    if old_state not in new_text:
        fatal("panel state anchor missing")
    new_text = new_text.replace(old_state, new_state, 1)
    print("Panel state declaration added")

    # 4d. Pass quickPrompts to RightPanel in the render
    old_render = (
        "              dateRange={dateRange}\n"
        "            />\n"
        "          )}"
    )
    new_render = (
        "              dateRange={dateRange}\n"
        "              quickPrompts={panelQuickPrompts}\n"
        "            />\n"
        "          )}"
    )
    if old_render not in new_text:
        fatal("RightPanel render anchor missing")
    new_text = new_text.replace(old_render, new_render, 1)
    print("RightPanel render patched (passes quickPrompts)")

    # ===================================================================
    # Write back
    # ===================================================================
    with open(PATH, "w") as f:
        f.write(new_text)

    print()
    print("=" * 50)
    print("All replacements applied.")
    print("Popover components removed, RightPanel extended.")
    print("File written:", PATH)
    print("=" * 50)


if __name__ == "__main__":
    main()
