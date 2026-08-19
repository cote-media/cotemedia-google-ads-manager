#!/usr/bin/env node
// LORAMER_NO_DANGLING_REFERENCE_V1 — A DELETED CONSTANT IS NOT DELETED UNTIL ITS READERS ARE.
//
// ⛔ THE DEFECT THIS EXISTS FOR, FOUND MINUTES BEFORE SPENDING VENDOR BUDGET ON IT. The completion-signal
// commit removed three sized constants from `scripts/drive-one-surface.mjs` — PASS_TIMEOUT_MS, QUIET_MS and
// FLOOR — and left TWO READS BEHIND:
//   · `AbortSignal.timeout(PASS_TIMEOUT_MS)` in the publish call. ReferenceError inside `call()`, swallowed
//     by the pass-1 try/catch, printed as "[drive] HALT — publish failed" — the instrument blaming the route
//     for its own defect, on pass 1, before publishing anything.
//   · `daysBetween(fAfter, FLOOR)` in the every-50-passes progress block. Outside every try, so it would
//     have CRASHED THE RUN AT PASS 50 — after ~50 passes of real spend — with no END line and no total.
//
// ⛔ AND EVERY GATE WAS GREEN OVER BOTH. `npm run build` does not typecheck `.mjs` scripts; the self-test
// exits before either line; and `drive-ceiling-pin.guard.mjs` — written in the same commit, specifically to
// police these three constants — asked only whether the DECLARATIONS were gone. THE GUARD MEASURED THE
// DELETION AND NOT THE PROPERTY, which is the proxy-versus-property class this repo has now paid for
// repeatedly. A constant is not removed when its `const` line is; it is removed when nothing reads it.
//
// ⛔ SO THIS CHECKS THE PROPERTY, WITH A REAL PARSER RATHER THAN A REGEX. It parses each subject with acorn
// (already in the tree via Next.js), collects every binding the module introduces — declarations, params,
// destructuring patterns, imports, catch clauses, class and function names — and then reports any identifier
// READ that resolves to neither a binding nor a known global. A regex could not have done this honestly:
// `${FLOOR}` sits inside a template literal and `'\\d{4}'` sits inside a regex literal, and a text scan gets
// one of those two wrong whichever way it is written.
//
// ⚠ THE LIMITS, STATED SO A GREEN IS NOT OVER-READ:
//   · Bindings are collected FILE-WIDE, not per-scope. A name declared in one function and read in another
//     resolves here and would still throw at runtime. This catches DANGLING, never MIS-SCOPED.
//   · A name that exists but holds the wrong value passes every leg. This is a spelling gate, not a logic one.
//   · Only the subjects listed below are parsed. `.ts`/`.tsx` are covered by `npm run build`; this exists
//     because plain `.mjs` operator scripts are covered by NOTHING ELSE IN THE REPO.
//
// USAGE: node tests/guards/no-dangling-reference.guard.mjs
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const require = createRequire(resolve(ROOT, 'package.json'))

// ⛔ THE SUBJECTS ARE THE OPERATOR SCRIPTS NO OTHER GATE PARSES. `scripts/*.mjs` reached by check:data run
// their own code and would surface a dangling read the moment they ran; the drive is the one whose failing
// line sits 50 passes and several hundred vendor requests deep, which is why it is named first.
const SUBJECTS = [
  'scripts/drive-one-surface.mjs',
]

const findings = []
let acorn
try { acorn = require('acorn') } catch (e) {
  console.error(`[no-dangling-reference] CANNOT RUN — acorn is not resolvable (${e.message}). A guard that cannot parse its subject FAILS rather than passing.`)
  process.exitCode = 2
  process.exit()
}

// Globals a module may read without declaring. Deliberately SHORT: an unknown name is a finding, and adding
// one here is a decision somebody makes on purpose rather than a silence.
const GLOBALS = new Set([
  'globalThis', 'undefined', 'NaN', 'Infinity', 'console', 'process', 'Buffer', 'fetch', 'Headers', 'Request',
  'Response', 'URL', 'URLSearchParams', 'AbortSignal', 'AbortController', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'setImmediate', 'queueMicrotask', 'structuredClone', 'TextEncoder',
  'TextDecoder', 'Promise', 'Date', 'Math', 'JSON', 'Number', 'String', 'Boolean', 'Array', 'Object', 'Set',
  'Map', 'WeakSet', 'WeakMap', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'RegExp',
  'Symbol', 'BigInt', 'Proxy', 'Reflect', 'Intl', 'isNaN', 'isFinite', 'parseInt', 'parseFloat',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI', 'require', 'module', 'exports',
  '__dirname', '__filename', 'arguments', 'crypto', 'performance', 'atob', 'btoa',
])

/** Every name a pattern introduces — plain, destructured, defaulted, rest, nested. */
function bindPattern(node, out) {
  if (!node || typeof node !== 'object') return
  switch (node.type) {
    case 'Identifier': out.add(node.name); return
    case 'ObjectPattern': for (const p of node.properties) bindPattern(p.type === 'RestElement' ? p.argument : p.value, out); return
    case 'ArrayPattern': for (const e of node.elements) bindPattern(e, out); return
    case 'AssignmentPattern': bindPattern(node.left, out); return
    case 'RestElement': bindPattern(node.argument, out); return
    default: return
  }
}

/** Walk any acorn AST node, calling visit(node, parent). No acorn-walk in the tree; the AST is plain objects. */
function walk(node, visit, parent = null) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const n of node) walk(n, visit, parent); return }
  if (typeof node.type !== 'string') return
  visit(node, parent)
  for (const k of Object.keys(node)) {
    if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'range') continue
    walk(node[k], visit, node)
  }
}

for (const rel of SUBJECTS) {
  let src = ''
  try { src = readFileSync(resolve(ROOT, rel), 'utf8') } catch (e) {
    findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`)
    continue
  }
  let ast
  try {
    ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowAwaitOutsideFunction: true })
  } catch (e) {
    findings.push(`${rel} DOES NOT PARSE — ${e.message}. A syntax error here is a defect the build cannot see, because \`npm run build\` never touches .mjs.`)
    continue
  }

  const declared = new Set()
  walk(ast, (n) => {
    switch (n.type) {
      case 'VariableDeclarator': bindPattern(n.id, declared); break
      case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression':
        if (n.id) declared.add(n.id.name)
        for (const p of n.params) bindPattern(p, declared)
        break
      case 'ClassDeclaration': case 'ClassExpression': if (n.id) declared.add(n.id.name); break
      case 'CatchClause': if (n.param) bindPattern(n.param, declared); break
      case 'ImportDefaultSpecifier': case 'ImportNamespaceSpecifier': case 'ImportSpecifier':
        declared.add(n.local.name); break
      default: break
    }
  })

  // Reads only: skip non-computed member properties, non-computed object keys, labels, and every position
  // that is a BINDING rather than a reference (those are collected above and would double-count).
  const unresolved = new Map()
  walk(ast, (n, parent) => {
    if (n.type !== 'Identifier') return
    if (!parent) return
    const p = parent
    if (p.type === 'MemberExpression' && p.property === n && !p.computed) return
    if (p.type === 'Property' && p.key === n && !p.computed && p.value !== n) return
    if (p.type === 'PropertyDefinition' && p.key === n && !p.computed) return
    if (p.type === 'MethodDefinition' && p.key === n && !p.computed) return
    if (p.type === 'LabeledStatement' || p.type === 'BreakStatement' || p.type === 'ContinueStatement') return
    if (p.type === 'ImportSpecifier' || p.type === 'ImportDefaultSpecifier' || p.type === 'ImportNamespaceSpecifier') return
    if (p.type === 'ExportSpecifier') return
    if (p.type === 'VariableDeclarator' && p.id === n) return
    if ((p.type === 'FunctionDeclaration' || p.type === 'FunctionExpression' || p.type === 'ArrowFunctionExpression' ||
         p.type === 'ClassDeclaration' || p.type === 'ClassExpression') && (p.id === n || p.params?.includes(n))) return
    if (p.type === 'ObjectPattern' || p.type === 'ArrayPattern' || p.type === 'RestElement') return
    if (p.type === 'AssignmentPattern' && p.left === n) return
    if (p.type === 'CatchClause' && p.param === n) return
    if (declared.has(n.name) || GLOBALS.has(n.name)) return
    if (!unresolved.has(n.name)) unresolved.set(n.name, n.loc.start.line)
  })

  for (const [name, line] of unresolved) {
    findings.push(`${rel}:${line} reads \`${name}\`, which this module never declares, imports, or receives as a parameter — and which is not a known global. At runtime that line throws ReferenceError. If \`${name}\` was a constant deleted on purpose, its READERS are part of the deletion.`)
  }
}

if (findings.length) {
  console.error(`[no-dangling-reference] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  console.error(`  ⇒ A deleted constant is not deleted until nothing reads it. \`npm run build\` does not parse .mjs, so for these files this guard is the ONLY thing between a dangling read and a run that dies 50 passes deep.`)
  process.exitCode = 1
} else {
  console.log(`[no-dangling-reference] PASS — ${SUBJECTS.length} operator script(s) parse, and every identifier read resolves to a binding the module introduces or to a named global. ⛔ LIMIT: bindings are collected FILE-WIDE, so this catches DANGLING references and never MIS-SCOPED ones, and a name holding the wrong value passes every leg.`)
}
