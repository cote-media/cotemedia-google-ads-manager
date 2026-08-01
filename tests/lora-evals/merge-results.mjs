#!/usr/bin/env node
// Merge the run-2 subset into run 1. Run 1's 82 answers STAND — this only replaces the 18 that never
// got an answer. A merge that silently overwrote a good answer with a newer one would destroy the thing
// we paid $20.51 for, so the merge REFUSES to replace any run-1 row that has httpStatus 200.
import { readFileSync, writeFileSync } from 'node:fs'

const DIR = '/Users/russcote2/Downloads/cotemedia-google-ads-manager/tests/lora-evals/results'
const r1 = JSON.parse(readFileSync(`${DIR}/results-v2-run1.json`, 'utf8'))
const r2 = JSON.parse(readFileSync(`${DIR}/results-v2-run2-subset.json`, 'utf8'))

const byId = new Map(r1.results.map((x) => [x.id, x]))
const replaced = [], refused = []
for (const nw of r2.results) {
  const old = byId.get(nw.id)
  if (!old) { byId.set(nw.id, nw); replaced.push(nw.id); continue }
  if (old.httpStatus === 200) { refused.push(nw.id); continue }   // run 1 already had a real answer
  byId.set(nw.id, { ...nw, mergedFrom: 'run2-subset', run1HttpStatus: old.httpStatus })
  replaced.push(nw.id)
}
const merged = r1.results.map((x) => byId.get(x.id))
const out = {
  ...r1,
  merged: {
    run1: 'results-v2-run1.json (82 answered)',
    run2: 'results-v2-run2-subset.json (the 18 that never answered)',
    replacedIds: replaced,
    refusedIds: refused,
    note: 'Run 1 answers are authoritative where present. The merge REFUSES to overwrite any run-1 row with httpStatus 200.',
  },
  results: merged,
}
writeFileSync(`${DIR}/results-v2-merged.json`, JSON.stringify(out, null, 2))
console.log(`replaced ${replaced.length}: ${replaced.join(', ')}`)
if (refused.length) console.log(`REFUSED to overwrite ${refused.length} good run-1 answers: ${refused.join(', ')}`)
console.log(`merged total: ${merged.length}`)
