// LORAMER_ENGINE_KEYED_INSTRUMENTS_V1 (2026-09-23) — THE ONE PREDICATE FOR "WHICH ROW IS THE GOOGLE ACCOUNT ROW".
//
// A LEAF ON PURPOSE: nothing in the walk (writer, resumer, worker, pump, run step) imports this module, so an instrument
// can learn the engine's keys without a deploy touching a file the walk loads mid-run. The mirror for the .mjs
// instruments is scripts/lib/engine-keys.mjs; tests/guards/proof-instruments-read-engine.guard.mjs compiles this file
// and compares both outputs byte for byte.
//
// WHY: a legacy-marked connection's account row is the '' row the old crons plant (entity_level 'account', breakdown_type
// '', breakdown_value ''). A walk-marked connection never receives one — LORAMER_ONE_ENGINE_V1 makes every old writer
// refuse it — so its account row is the walk's own customer surface, spelled customer/customer (universe-surfaces.ts:95:
// a surface with no segment takes its resource as its breakdown_type). check:data's capture-landing read only the
// legacy key and reported Tri-Copy's first walk-marked days as 590 false violations (2026-09-23).
// An unknown engine THROWS. Defaulting is how a third spelling would be born.

export type GoogleAccountKey = { entity_level: string; breakdown_type: string; breakdown_value: string }

export function googleAccountKeyFor(engine: string | null | undefined): GoogleAccountKey {
  if (engine === 'legacy') return { entity_level: 'account', breakdown_type: '', breakdown_value: '' }
  if (engine === 'walk') return { entity_level: 'customer', breakdown_type: 'customer', breakdown_value: '' }
  throw new Error(`googleAccountKeyFor: unknown engine ${JSON.stringify(engine)} — legacy or walk only; an unknown engine is refused, never defaulted`)
}
