#!/usr/bin/env node
// LORAMER_UI_INVENTORY_HTML_V1 — generate docs/ui-inventory.html BY PARSING docs/LORAMER_UI_INVENTORY.md.
//
// ⛔ WHY A GENERATOR AND NOT A HAND-WRITTEN PAGE: two copies of one list drift, and this repo has measured
// that cost repeatedly (the DOC-OWNERSHIP gate exists for it). The .md is the SOURCE. This script is the
// only thing that may write the .html, and the .html states the SHA it was built from on its own face, so a
// stale page announces itself instead of quietly disagreeing with the file it came from.
//
// ⛔ NO NETWORK IN THE OUTPUT, BY REQUIREMENT: the page must open from the filesystem on a phone with no
// signal. That rules out Google Fonts, so the type is the device's own stack — which is the right answer
// rather than a compromise here: it is an iPhone tool, so it is set in the iPhone's typeface.
//
// ⚠ THE DANGEROUS FIVE ARE A HUMAN RANKING, NOT A FIELD IN THE .md. They are matched below by a distinctive
// substring of each item. If an item's wording changes, the match FAILS THE BUILD rather than silently
// emitting four — a pinned "top 5" that quietly becomes four is exactly the adjacent-number class this repo
// keeps paying for.

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const SRC = resolve(ROOT, 'docs/LORAMER_UI_INVENTORY.md')
const OUT = resolve(ROOT, 'docs/ui-inventory.html')

const md = readFileSync(SRC, 'utf8')
let sha = 'unknown'
try { sha = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim() } catch { /* not a repo */ }
let srcSha = 'unknown'
try { srcSha = execSync('git hash-object docs/LORAMER_UI_INVENTORY.md', { cwd: ROOT }).toString().trim().slice(0, 12) } catch { /* untracked */ }

// ── PARSE ─────────────────────────────────────────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
// Inline markdown the .md actually uses: **bold** and `code`. Everything else is left as literal text.
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>')

const categories = []
let cur = null
for (const raw of md.split('\n')) {
  const head = raw.match(/^##\s+(?:(\d+)\.\s*)?(.+?)\s*$/)
  if (head) {
    const title = head[2]
    // Only the numbered sections carry items; the prose sections (COUNTS, DEDUPE LEDGER, …) are skipped.
    if (head[1]) {
      const m = title.match(/^(.+?)\s+—\s+(.+?)\s*\((\d+)\)\s*$/) || title.match(/^(.+?)\s+\((\d+)\)\s*$/)
      cur = m
        ? { name: m[1].trim(), blurb: (m.length === 4 ? m[2] : '').trim(), declared: Number(m[m.length - 1]), items: [] }
        : { name: title, blurb: '', declared: null, items: [] }
      categories.push(cur)
    } else { cur = null }
    continue
  }
  if (!cur) continue
  const item = raw.match(/^-\s+\[([A-Z-]+)\]\s+(.*)$/)
  if (!item) continue
  const fields = item[2].split(' · ')
  const kindAt = fields.findIndex((f) => /^\**(CORRECTNESS|EXPERIENCE)\**$/.test(f.trim()))
  if (kindAt < 0) { console.error(`[ui-inventory] FAIL — item has no CORRECTNESS/EXPERIENCE field:\n  ${raw}`); process.exit(1) }
  const kind = /CORRECTNESS/.test(fields[kindAt]) ? 'CORRECTNESS' : 'EXPERIENCE'
  const desc = (kindAt >= 2 ? fields.slice(0, kindAt - 1).join(' · ') : fields[0]).trim()
  const surface = kindAt >= 2 ? fields[kindAt - 1].trim() : ''
  const prov = fields.slice(kindAt + 1).join(' · ').trim()
  cur.items.push({ tag: item[1], desc, surface, kind, prov, unbanked: /UNBANKED/.test(item[2]) })
}

const all = categories.flatMap((c) => c.items)
for (const c of categories) {
  if (c.declared !== null && c.declared !== c.items.length) {
    console.error(`[ui-inventory] FAIL — "${c.name}" header says (${c.declared}) but ${c.items.length} item(s) parsed. The heading and the list disagree.`)
    process.exit(1)
  }
}

// ── THE DANGEROUS FIVE — matched by distinctive substring; the order IS the ranking ──────────────────────
const DANGEROUS = [
  ['Lora reports missing data as ZERO', 'She does not invent numbers — she reports absence as $0, with full confidence. 13 eval failures: 8 false-zero, 5 fabricated.'],
  ['CLOSED 2026-08-23 — the Team page showed one client', '⚠ NO LONGER DANGEROUS — CLOSED. It was fixed and guard-held before the audit ran; the queue entry was merely stale. Kept here because a reader who saw the earlier list needs to know what happened to it, not to find it silently gone.'],
  ['completeness meter shows CONNECTED platforms as NOT_CONNECTED', 'The one screen built to prove capture is real is the screen that lies when the query behind it times out.'],
  ["legacy dashboard's Shopify chart counts cancelled orders", '⚠ RESTATED 2026-08-23 and SMALLER than first reported: revenue AGREES on both paths — a cancelled order\u2019s subtotal is $0, measured. What diverges is the order count, so the chart understates average order value. Still a number an owner acts on.'],
  ['Stale intelligence cache can serve an EMPTY Meta payload', 'It reads as "no spend", not as "no data" — a confident answer over a window we did not have.'],
]
const danger = DANGEROUS.map(([key, why]) => {
  const hits = all.filter((i) => i.desc.includes(key))
  if (hits.length !== 1) {
    console.error(`[ui-inventory] FAIL — the pinned-danger key "${key}" matched ${hits.length} item(s), expected exactly 1. The .md wording changed; fix the key rather than dropping the item.`)
    process.exit(1)
  }
  return { ...hits[0], why }
})
const dangerKeys = new Set(danger.map((d) => d.desc))

const corr = all.filter((i) => i.kind === 'CORRECTNESS').length
const stamp = new Date().toISOString().slice(0, 10)

// ── RENDER ────────────────────────────────────────────────────────────────────────────────────────────────
// PALETTE, derived from the product's OWN stylesheet rather than invented: src/components/redesign/
// redesign.module.css health chips — hReconnect #b45309/#fdeccc is the accent, hDisconnected #b91c1c/#fde2e1
// carries CORRECTNESS, and the ink/muted/border greys (#0f172a / #64748b / #e2e8f0) are the app's own.
// The neutrals are cool (slate-biased), matching the accent's warmth against a cool ground.
// ⛔ A CONTENT HASH, NOT A TRUNCATED PREFIX. The first version keyed on the first 24 base64 chars of the
// description and TWO PAIRS COLLIDED — "Switching clients …" (scroll position vs data refresh) and
// "The value-model gate …" (z-index vs non-dismissable). Colliding ids mean one label binds to the wrong
// checkbox and two items share one tick. Caught by the duplicate-id check below, not by reading.
const idOf = (i) => 'i' + createHash('sha256').update(i.desc).digest('hex').slice(0, 16)

const ids = new Map()
for (const i of all) {
  const id = idOf(i)
  if (ids.has(id)) { console.error(`[ui-inventory] FAIL — id collision ${id}:\n  A: ${ids.get(id)}\n  B: ${i.desc}\nTwo items would share one checkbox.`); process.exit(1) }
  ids.set(id, i.desc)
}

const itemHtml = (i, pinned = false) => `
      <li class="item${pinned ? ' pinned' : ''}">
        <input type="checkbox" id="${pinned ? 'p' : ''}${idOf(i)}" class="tick" data-key="${idOf(i)}" />
        <label for="${pinned ? 'p' : ''}${idOf(i)}" class="body">
          <span class="desc">${inline(i.desc)}</span>
          ${pinned ? `<span class="why">${esc(i.why)}</span>` : ''}
          <span class="meta">
            <span class="pill ${i.kind === 'CORRECTNESS' ? 'c' : 'e'}">${i.kind === 'CORRECTNESS' ? 'shows something untrue' : 'experience'}</span>
            ${i.unbanked ? '<span class="pill u">unbanked</span>' : ''}
            ${i.surface ? `<span class="surface">${inline(i.surface)}</span>` : ''}
          </span>
          <span class="prov">${inline(i.prov)}</span>
        </label>
      </li>`

const catHtml = (c, n) => {
  const cc = c.items.filter((i) => i.kind === 'CORRECTNESS').length
  const pct = c.items.length ? Math.round((cc / c.items.length) * 100) : 0
  return `
    <section class="cat">
      <button class="cathead" aria-expanded="false" aria-controls="cat${n}">
        <span class="chev" aria-hidden="true"></span>
        <span class="catname">${esc(c.name)}</span>
        <span class="count">${c.items.length}</span>
        <span class="split"><span class="splitc" style="width:${pct}%"></span></span>
        <span class="splitlabel">${cc} untrue · ${c.items.length - cc} experience</span>
      </button>
      <div class="catbody" id="cat${n}" hidden>
        ${c.blurb ? `<p class="blurb">${inline(c.blurb)}</p>` : ''}
        <ul class="items">${c.items.map((i) => itemHtml(i)).join('')}</ul>
      </div>
    </section>`
}

const inner = `<title>LoraMer UI Punch List</title>
<style>
  :root{
    --ground:#f7f8f9; --card:#ffffff; --ink:#0f172a; --muted:#64748b; --border:#e2e8f0;
    --accent:#b45309; --accent-bg:#fdeccc; --crit:#b91c1c; --crit-bg:#fde2e1;
    --exp:#475569; --exp-bg:#eef1f5; --done:#94a3b8;
    --shadow:0 1px 2px rgba(15,23,42,.06),0 1px 3px rgba(15,23,42,.04);
  }
  @media (prefers-color-scheme: dark){
    :root:not([data-theme="light"]){
      --ground:#0b1120; --card:#131c2e; --ink:#e8edf5; --muted:#94a3b8; --border:#243149;
      --accent:#f0a35e; --accent-bg:#3a2510; --crit:#f28b82; --crit-bg:#3d1a1a;
      --exp:#a8b6c8; --exp-bg:#1c2740; --done:#5a6b83;
      --shadow:0 1px 2px rgba(0,0,0,.4);
    }
  }
  :root[data-theme="dark"]{
    --ground:#0b1120; --card:#131c2e; --ink:#e8edf5; --muted:#94a3b8; --border:#243149;
    --accent:#f0a35e; --accent-bg:#3a2510; --crit:#f28b82; --crit-bg:#3d1a1a;
    --exp:#a8b6c8; --exp-bg:#1c2740; --done:#5a6b83;
    --shadow:0 1px 2px rgba(0,0,0,.4);
  }
  *{box-sizing:border-box}
  html{-webkit-text-size-adjust:100%}
  body{
    margin:0; background:var(--ground); color:var(--ink);
    font:16px/1.45 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,system-ui,sans-serif;
    padding:0 0 env(safe-area-inset-bottom); overflow-x:hidden;
  }
  .wrap{max-width:640px;margin:0 auto;padding:0 12px 48px}
  header.top{
    position:sticky;top:0;z-index:10;background:var(--ground);
    padding:14px 12px 10px;margin:0 -12px;border-bottom:1px solid var(--border);
  }
  h1{margin:0;font-size:19px;line-height:1.2;letter-spacing:-.01em;font-weight:650;text-wrap:balance}
  .totals{margin-top:5px;font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}
  .totals b{color:var(--ink);font-weight:600}
  .prog{margin-top:8px;height:4px;border-radius:99px;background:var(--border);overflow:hidden}
  .prog span{display:block;height:100%;width:0;background:var(--accent);transition:width .18s ease}
  .progtext{margin-top:5px;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}

  .note{margin:14px 0 0;padding:11px 13px;background:var(--card);border:1px solid var(--border);
        border-radius:10px;font-size:13px;line-height:1.5;color:var(--muted)}
  .note b{color:var(--ink)}

  h2.sec{margin:22px 0 8px;font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);font-weight:650}

  .danger{background:var(--card);border:1px solid var(--border);border-left:4px solid var(--crit);
          border-radius:10px;padding:4px 12px 8px;box-shadow:var(--shadow)}
  .danger .items{margin:0}

  .cat{background:var(--card);border:1px solid var(--border);border-radius:10px;margin-bottom:8px;
       box-shadow:var(--shadow);overflow:hidden}
  .cathead{
    display:grid;grid-template-columns:16px 1fr auto;grid-template-areas:"chev name count" ". split split" ". lbl lbl";
    gap:2px 8px;width:100%;padding:13px 13px;background:none;border:0;color:inherit;text-align:left;
    font:inherit;font-size:16px;cursor:pointer;
  }
  .cathead:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
  .chev{grid-area:chev;align-self:center;width:0;height:0;border-left:6px solid currentColor;
        border-top:5px solid transparent;border-bottom:5px solid transparent;color:var(--muted);
        transition:transform .16s ease}
  .cathead[aria-expanded="true"] .chev{transform:rotate(90deg)}
  .catname{grid-area:name;font-weight:600;letter-spacing:-.01em;line-height:1.25}
  .count{grid-area:count;align-self:center;font-size:13px;font-weight:650;color:var(--accent);
         background:var(--accent-bg);padding:2px 8px;border-radius:99px;font-variant-numeric:tabular-nums}
  .split{grid-area:split;display:block;height:3px;border-radius:99px;background:var(--exp-bg);overflow:hidden;margin-top:6px}
  .splitc{display:block;height:100%;background:var(--crit)}
  .splitlabel{grid-area:lbl;font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums;margin-top:3px}

  .blurb{margin:0 13px 4px;font-size:13px;color:var(--muted);line-height:1.45}
  .items{list-style:none;margin:0;padding:0}
  .item{display:grid;grid-template-columns:26px 1fr;gap:10px;padding:11px 13px;border-top:1px solid var(--border)}
  .danger .item:first-child{border-top:0}
  .tick{
    appearance:none;-webkit-appearance:none;margin:2px 0 0;width:22px;height:22px;flex:0 0 22px;
    border:1.5px solid var(--muted);border-radius:6px;background:var(--card);cursor:pointer;position:relative;
  }
  .tick:checked{background:var(--accent);border-color:var(--accent)}
  .tick:checked::after{content:"";position:absolute;left:7px;top:3px;width:5px;height:10px;
    border:solid var(--card);border-width:0 2px 2px 0;transform:rotate(45deg)}
  .tick:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .body{display:flex;flex-direction:column;gap:5px;min-width:0;cursor:pointer}
  .desc{font-size:15px;line-height:1.4;overflow-wrap:anywhere}
  .why{font-size:13px;line-height:1.45;color:var(--crit)}
  .tick:checked + .body .desc,.tick:checked + .body .why{color:var(--done);text-decoration:line-through}
  .meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
  .pill{font-size:11px;font-weight:650;letter-spacing:.02em;padding:2px 7px;border-radius:99px;white-space:nowrap}
  .pill.c{color:var(--crit);background:var(--crit-bg)}
  .pill.e{color:var(--exp);background:var(--exp-bg)}
  .pill.u{color:var(--accent);background:var(--accent-bg)}
  .surface{font-size:12px;color:var(--muted);overflow-wrap:anywhere}
  .prov{font:12px/1.4 ui-monospace,"SF Mono",SFMono-Regular,Menlo,monospace;color:var(--muted);overflow-wrap:anywhere}
  code{font:12.5px/1.3 ui-monospace,"SF Mono",SFMono-Regular,Menlo,monospace;background:var(--exp-bg);
       padding:1px 4px;border-radius:4px}

  .tools{display:flex;gap:8px;margin:14px 0 0}
  .tools button{flex:1;font:inherit;font-size:16px;padding:11px 8px;border-radius:9px;border:1px solid var(--border);
    background:var(--card);color:var(--ink);cursor:pointer}
  .tools button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

  footer{margin-top:26px;font:12px/1.6 ui-monospace,"SF Mono",SFMono-Regular,Menlo,monospace;color:var(--muted);
    border-top:1px solid var(--border);padding-top:12px;overflow-wrap:anywhere}
  @media (prefers-reduced-motion: reduce){*{transition:none!important}}
</style>
<div class="wrap">
  <header class="top">
    <h1>LoraMer UI punch list</h1>
    <div class="totals"><b>${all.length}</b> items · <b>${corr}</b> show something untrue · <b>${all.length - corr}</b> experience · <b>${categories.length}</b> categories</div>
    <div class="prog"><span id="bar"></span></div>
    <div class="progtext" id="ptext">0 ticked</div>
  </header>

  <p class="note"><b>Rank the categories, not the items.</b> Everything is collapsed. Tap a category to open it.
  Ticking is yours alone — it is stored on this device only and survives a reload; it changes nothing in the repo.</p>

  <h2 class="sec">Dangerous — a customer acts and is wrong, with no signal · 3 stand, 2 corrected on diagnosis</h2>
  <div class="danger"><ul class="items">${danger.map((d) => itemHtml(d, true)).join('')}</ul></div>

  <h2 class="sec">All ${all.length} items by category</h2>
  ${categories.map((c, n) => catHtml(c, n)).join('')}

  <div class="tools">
    <button type="button" id="expand">Open all</button>
    <button type="button" id="collapse">Close all</button>
    <button type="button" id="clear">Clear ticks</button>
  </div>

  <footer>
    generated ${stamp} from docs/LORAMER_UI_INVENTORY.md<br />
    source blob ${srcSha} · repo HEAD ${sha}<br />
    built by scripts/build-ui-inventory-html.mjs — do not hand-edit this file; edit the .md and re-run.<br />
    the .md remains the source; the QUEUE and DECISIONS remain the owners of open/closed.
  </footer>
</div>
<script>
(function(){
  var KEY='loramer-ui-punchlist-v1';
  var store={};
  try{ store=JSON.parse(localStorage.getItem(KEY)||'{}')||{}; }catch(e){ store={}; }
  var ticks=[].slice.call(document.querySelectorAll('.tick'));
  // The five pinned items also appear inside their own category, so two inputs share ONE item key.
  // Count UNIQUE keys, never inputs, or a 129-item list reports 134.
  var keys={}; ticks.forEach(function(t){ keys[t.getAttribute('data-key')]=1; });
  var total=Object.keys(keys).length||1;
  var bar=document.getElementById('bar'), ptext=document.getElementById('ptext');
  function paint(){
    var seen={},n=0;
    ticks.forEach(function(t){ var k=t.getAttribute('data-key'); if(t.checked&&!seen[k]){ seen[k]=1; n++; } });
    bar.style.width=Math.round(n/total*100)+'%';
    ptext.textContent=n+' of '+total+' ticked';
  }
  function save(){
    var out={};
    ticks.forEach(function(t){ if(t.checked) out[t.getAttribute('data-key')]=1; });
    try{ localStorage.setItem(KEY,JSON.stringify(out)); }catch(e){ /* private mode: ticks just do not persist */ }
  }
  ticks.forEach(function(t){
    if(store[t.getAttribute('data-key')]) t.checked=true;
    t.addEventListener('change',function(){
      var k=t.getAttribute('data-key');
      ticks.forEach(function(o){ if(o!==t&&o.getAttribute('data-key')===k) o.checked=t.checked; });
      save(); paint();
    });
  });
  paint();
  function toggle(btn,force){
    var panel=document.getElementById(btn.getAttribute('aria-controls'));
    var open=(force===undefined)?btn.getAttribute('aria-expanded')!=='true':force;
    btn.setAttribute('aria-expanded',String(open));
    panel.hidden=!open;
  }
  var heads=[].slice.call(document.querySelectorAll('.cathead'));
  heads.forEach(function(b){ b.addEventListener('click',function(){ toggle(b); }); });
  document.getElementById('expand').addEventListener('click',function(){ heads.forEach(function(b){ toggle(b,true); }); });
  document.getElementById('collapse').addEventListener('click',function(){ heads.forEach(function(b){ toggle(b,false); }); });
  document.getElementById('clear').addEventListener('click',function(){
    ticks.forEach(function(t){ t.checked=false; }); save(); paint();
  });
})();
</script>
`

// TWO OUTPUTS FROM ONE RENDER, so the offline file and the hosted page cannot say different things.
// ⛔ THE OFFLINE FILE IS NOT THE DELIVERABLE ON A PHONE — a path on a laptop is not a viewable thing, which
// is the whole reason this script exists. The fragment is what gets published somewhere a phone can reach.
const standalone = `<!doctype html>
<html lang="en" data-src-sha="${srcSha}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
${inner.replace('<div class="wrap">', '</head>\n<body>\n<div class="wrap">')}
</body>
</html>
`
writeFileSync(OUT, standalone, 'utf8')
const artifactOut = process.argv.includes('--artifact-out') ? process.argv[process.argv.indexOf('--artifact-out') + 1] : null
if (artifactOut) { writeFileSync(artifactOut, inner, 'utf8'); console.log(`[ui-inventory] wrote artifact fragment ${artifactOut}`) }
console.log(`[ui-inventory] wrote docs/ui-inventory.html — ${all.length} items in ${categories.length} categories (${corr} correctness), 5 pinned dangerous, from blob ${srcSha} at HEAD ${sha}.`)
console.log(`[ui-inventory] per-category header counts all agree with the parsed lists; the pinned five all matched exactly one item each.`)
