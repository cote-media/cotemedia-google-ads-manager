// LORAMER_ENGINE_KEYED_INSTRUMENTS_V1 — MIRROR of src/lib/backfill/engine-keys.ts for the .mjs instruments.
// tests/guards/proof-instruments-read-engine.guard.mjs compiles the .ts and compares both outputs; edit them together.
export function googleAccountKeyFor(engine) {
  if (engine === 'legacy') return { entity_level: 'account', breakdown_type: '', breakdown_value: '' }
  if (engine === 'walk') return { entity_level: 'customer', breakdown_type: 'customer', breakdown_value: '' }
  throw new Error(`googleAccountKeyFor: unknown engine ${JSON.stringify(engine)} — legacy or walk only; an unknown engine is refused, never defaulted`)
}
/** The SQL fragment an instrument appends to a metrics_daily read, from constants this module owns (never from input). */
export function googleAccountKeySql(engine, alias = 'm') {
  const k = googleAccountKeyFor(engine)
  return `and ${alias}.entity_level = '${k.entity_level}' and ${alias}.breakdown_type = '${k.breakdown_type}' and ${alias}.breakdown_value = '${k.breakdown_value}'`
}
