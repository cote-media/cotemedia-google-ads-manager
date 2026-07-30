// LORAMER_COMPLETION_CLAIM_GATE_V1 — BASELINE (data, NOT a code exemption).
//
// The 51 completion claims that were NOT covered by rows on the gate's FIRST live run, 2026-07-30. Recorded so the
// gate FAILS on anything NEW; every entry here is owed triage, and the gate's own output carries the numbers.
//
// ⛔ ANTI-ROT: an entry that no longer matches a live violation FAILS the gate. Fixing a claim therefore makes
// check:data fail until its entry is deleted — the queue can only shrink.
//
// ⚠ THESE ARE NOT ALL DEFECTS, AND THE GATE CANNOT TELL WHICH ARE. Two shapes dominate, and they need opposite
// responses (the honest limit in the gate's header, made concrete):
//   · meta_video x 8 clients — `video` rows only exist on days a VIDEO ad ran. This is the CONDITIONAL-family
//     sparsity class from the 2026-07-30 fleet measurement, where a sparse day is CORRECT. Most or all of these
//     eight are probably honest. PROBE THE VENDOR BEFORE TREATING ANY OF THEM AS A DEFECT.
//   · google breadth (adgroup_ad 11 · geo 7 · user_geo 7 · hour 7 · device 6 · dimensional 5) — claims at
//     2023-06-28..07-02 (the 36-month floor36 clamp) against rows starting months or years later, several clients
//     sharing a 2026-03-26 row-start. That is the run-backfill.ts:~268 shape the audit predicted: completion
//     asserted from WINDOW POSITION rather than rows written. These are the likely real defects.
//   · 11 FALSE_COMPLETE_EMPTY, of which 5 are Glenn Stearns google (device/geo/user_geo/hour/dimensional) —
//     complete=true with ZERO rows on a platform that delivered from 2023-04-18. Glenn Stearns is NOT on the
//     golden list (deprioritised 2026-07-29), which changes the urgency and not the fact.
// ⚠ BOTH "Influential Drones" CLIENTS APPEAR BELOW — 5bb9b2ff and 2617b163 are DIFFERENT clients with the same
// name, and src/lib/clients/canonical.ts records which is which (resolve by id via resolveClientById, never by
// name). They are listed separately because they hold separate cursors and separate rows; two entries with one name
// is correct here, not a duplicate.
export const KNOWN_COMPLETION_CLAIM_VIOLATIONS = [
  { clientId: '07aa6cdb-d57e-4c17-8d74-3e6a2235c379', client: "BusyBee Bookkeeping", platform: 'google', step: 'google_adgroup_ad', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: '366afedc-c6e5-4863-bc7b-6a3146ea5115', client: "Champion Cleaning Systems", platform: 'google', step: 'google_adgroup_ad', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: '1b7b073f-6f21-4850-b8e3-fdd061b91fc2', client: "Ennis Exterminating", platform: 'google', step: 'google_adgroup_ad', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: '957d484e-d0c4-4dd0-b382-d8499d556252', client: "Foam OH", platform: 'google', step: 'google_adgroup_ad', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: '7d90cce7-3fb5-41d7-ab2b-5678bd71614e', client: "Glass Plus, Inc.", platform: 'google', step: 'google_adgroup_ad', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: '3111c7e1-bc4a-486b-8a0f-9d05a7689be8', client: "Glenn Stearns", platform: 'google', step: 'google_adgroup_ad', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: '2617b163-f392-427e-9a29-f134acc51406', client: "Influential Drones", platform: 'google', step: 'google_adgroup_ad', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: '5bb9b2ff-a1df-4d46-ac6b-0471ef543e15', client: "Influential Drones", platform: 'google', step: 'google_adgroup_ad', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: 'dff5c5c9-e270-4e91-8023-4334ed753e85', client: "Marathon Roofing and Contracting, Inc.", platform: 'google', step: 'google_adgroup_ad', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: '965c77ff-3ad5-44b2-8d45-ee8ab1c97966', client: "My Vacation Network", platform: 'google', step: 'google_adgroup_ad', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: 'fe71cd89-8525-4ebe-b3ba-5fa2a3eb6a4d', client: "skinregimen.com", platform: 'google', step: 'google_adgroup_ad', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: '07aa6cdb-d57e-4c17-8d74-3e6a2235c379', client: "BusyBee Bookkeeping", platform: 'google', step: 'google_device', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: '7d90cce7-3fb5-41d7-ab2b-5678bd71614e', client: "Glass Plus, Inc.", platform: 'google', step: 'google_device', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: '3111c7e1-bc4a-486b-8a0f-9d05a7689be8', client: "Glenn Stearns", platform: 'google', step: 'google_device', verdict: 'FALSE_COMPLETE_EMPTY' },
  { clientId: '2617b163-f392-427e-9a29-f134acc51406', client: "Influential Drones", platform: 'google', step: 'google_device', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: '5bb9b2ff-a1df-4d46-ac6b-0471ef543e15', client: "Influential Drones", platform: 'google', step: 'google_device', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: 'fe71cd89-8525-4ebe-b3ba-5fa2a3eb6a4d', client: "skinregimen.com", platform: 'google', step: 'google_device', verdict: 'FALSE_COMPLETE_EMPTY' },
  { clientId: '07aa6cdb-d57e-4c17-8d74-3e6a2235c379', client: "BusyBee Bookkeeping", platform: 'google', step: 'google_dimensional', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: '3111c7e1-bc4a-486b-8a0f-9d05a7689be8', client: "Glenn Stearns", platform: 'google', step: 'google_dimensional', verdict: 'FALSE_COMPLETE_EMPTY' },
  { clientId: '5bb9b2ff-a1df-4d46-ac6b-0471ef543e15', client: "Influential Drones", platform: 'google', step: 'google_dimensional', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: 'f5fbe7e5-7b22-4a17-9681-6fab7fbeddb2', client: "Veterinary mastermind", platform: 'google', step: 'google_dimensional', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: 'fe71cd89-8525-4ebe-b3ba-5fa2a3eb6a4d', client: "skinregimen.com", platform: 'google', step: 'google_dimensional', verdict: 'FALSE_COMPLETE_EMPTY' },
  { clientId: '60e6dd99-fd42-466f-870f-48eb407835e8', client: "Bath Fitter | O'Gorman Bros", platform: 'google', step: 'google_geo', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: '07aa6cdb-d57e-4c17-8d74-3e6a2235c379', client: "BusyBee Bookkeeping", platform: 'google', step: 'google_geo', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: '7d90cce7-3fb5-41d7-ab2b-5678bd71614e', client: "Glass Plus, Inc.", platform: 'google', step: 'google_geo', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: '3111c7e1-bc4a-486b-8a0f-9d05a7689be8', client: "Glenn Stearns", platform: 'google', step: 'google_geo', verdict: 'FALSE_COMPLETE_EMPTY' },
  { clientId: '2617b163-f392-427e-9a29-f134acc51406', client: "Influential Drones", platform: 'google', step: 'google_geo', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: '5bb9b2ff-a1df-4d46-ac6b-0471ef543e15', client: "Influential Drones", platform: 'google', step: 'google_geo', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: 'fe71cd89-8525-4ebe-b3ba-5fa2a3eb6a4d', client: "skinregimen.com", platform: 'google', step: 'google_geo', verdict: 'FALSE_COMPLETE_EMPTY' },
  { clientId: '60e6dd99-fd42-466f-870f-48eb407835e8', client: "Bath Fitter | O'Gorman Bros", platform: 'google', step: 'google_hour', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: '07aa6cdb-d57e-4c17-8d74-3e6a2235c379', client: "BusyBee Bookkeeping", platform: 'google', step: 'google_hour', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: '7d90cce7-3fb5-41d7-ab2b-5678bd71614e', client: "Glass Plus, Inc.", platform: 'google', step: 'google_hour', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: '3111c7e1-bc4a-486b-8a0f-9d05a7689be8', client: "Glenn Stearns", platform: 'google', step: 'google_hour', verdict: 'FALSE_COMPLETE_EMPTY' },
  { clientId: '2617b163-f392-427e-9a29-f134acc51406', client: "Influential Drones", platform: 'google', step: 'google_hour', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: '5bb9b2ff-a1df-4d46-ac6b-0471ef543e15', client: "Influential Drones", platform: 'google', step: 'google_hour', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: 'fe71cd89-8525-4ebe-b3ba-5fa2a3eb6a4d', client: "skinregimen.com", platform: 'google', step: 'google_hour', verdict: 'FALSE_COMPLETE_EMPTY' },
  { clientId: '60e6dd99-fd42-466f-870f-48eb407835e8', client: "Bath Fitter | O'Gorman Bros", platform: 'google', step: 'google_user_geo', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: '07aa6cdb-d57e-4c17-8d74-3e6a2235c379', client: "BusyBee Bookkeeping", platform: 'google', step: 'google_user_geo', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: '7d90cce7-3fb5-41d7-ab2b-5678bd71614e', client: "Glass Plus, Inc.", platform: 'google', step: 'google_user_geo', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: '3111c7e1-bc4a-486b-8a0f-9d05a7689be8', client: "Glenn Stearns", platform: 'google', step: 'google_user_geo', verdict: 'FALSE_COMPLETE_EMPTY' },
  { clientId: '2617b163-f392-427e-9a29-f134acc51406', client: "Influential Drones", platform: 'google', step: 'google_user_geo', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: '5bb9b2ff-a1df-4d46-ac6b-0471ef543e15', client: "Influential Drones", platform: 'google', step: 'google_user_geo', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: 'fe71cd89-8525-4ebe-b3ba-5fa2a3eb6a4d', client: "skinregimen.com", platform: 'google', step: 'google_user_geo', verdict: 'FALSE_COMPLETE_EMPTY' },
  { clientId: '07aa6cdb-d57e-4c17-8d74-3e6a2235c379', client: "BusyBee Bookkeeping", platform: 'meta', step: 'meta_video', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: '957d484e-d0c4-4dd0-b382-d8499d556252', client: "Foam OH", platform: 'meta', step: 'meta_video', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: '7d90cce7-3fb5-41d7-ab2b-5678bd71614e', client: "Glass Plus, Inc.", platform: 'meta', step: 'meta_video', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: '2617b163-f392-427e-9a29-f134acc51406', client: "Influential Drones", platform: 'meta', step: 'meta_video', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: '5bb9b2ff-a1df-4d46-ac6b-0471ef543e15', client: "Influential Drones", platform: 'meta', step: 'meta_video', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: '4a7faf0a-25d7-4f91-b977-6a796ec13b8b', client: "Inside", platform: 'meta', step: 'meta_video', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: '965c77ff-3ad5-44b2-8d45-ee8ab1c97966', client: "My Vacation Network", platform: 'meta', step: 'meta_video', verdict: 'CLAIM_EXCEEDS_ROWS' },
  { clientId: '23c697bb-5255-4289-9329-659544ba8e6e', client: "Shelley Kyle", platform: 'meta', step: 'meta_video', verdict: 'CLAIM_EXCEEDS_ROWS' },
]
