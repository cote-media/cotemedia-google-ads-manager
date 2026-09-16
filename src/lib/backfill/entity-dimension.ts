// LORAMER_ENTITY_DIMENSION_V1 — THE CURRENT NAME AND THE REAL PARENT, RECORDED ONCE.
//
// ⛔ THE TWO DEFECTS THIS CLOSES, both measured 2026-09-16 on Foam OH:
//   · the walk writes `entity_name: null` on every row — 0 named entities across 98,060 walk rows
//   · it writes `parent_entity_id: ctx.customerId` on every row, so campaign → ad_group → ad is FLAT:
//     41,825 ad_group_ad rows, ONE distinct parent value, and that value is the account
//
// ⛔ WHY THE PARENT COSTS NOTHING TO LEARN, AND THIS IS THE VENDOR'S OWN DESIGN RATHER THAN A TRICK WE FOUND.
// Google's resource-name doc gives the formats:
//     campaign      customers/1234567890/campaigns/8765432109
//     ad_group      customers/1234567890/adGroups/54321098765
//     ad_group_ad   customers/1234567890/adGroupAds/54321098765~2109876543210
// and states plainly that *"parsing the individual IDs lets you derive new resource names to reference the ad
// group ad's customer or its ad group."* The tilde form carries its parent ad group INSIDE the id we already
// store. MEASURED on live rows: entity_id reads
// `customers/7688521852/adGroupAds/195408186860~801802996686` today. So the ad → ad_group link needs NO
// request at all; it is already in the warehouse and was being thrown away at read time.
//
// ⛔ AND THE ONE LINK THAT IS **NOT** DERIVABLE, NAMED RATHER THAN GLOSSED: ad_group → campaign. An ad group's
// resource name contains the CUSTOMER, not the campaign — its PATH parent and its LOGICAL parent differ. A
// generic path-parse would confidently return the account and be wrong, which is worse than returning nothing.
// That link, and every name, comes from the vendor's own fields on a dimension read.
//
// ⛔ WHY A SEPARATE DIMENSION READ RATHER THAN WIDER CAPTURE QUERIES. The write path is the measured ceiling
// (7,521 rows/s at width 12) and this flight may not slow it. Adding name and parent fields to the 349
// per-surface capture queries would touch every one of them and put the cost inside the loop that is already
// the bottleneck. A dimension read is 3 UN-SEGMENTED queries per client per day, outside the capture loop
// entirely: it cannot slow a fire because it does not run inside one.
//
// ⛔ TYPE 1, AND THE ADVERSARY'S TYPE 2 IS REFUSED ON OWNERSHIP, NOT ON TASTE. `entity_state_history`
// (migration 048, LORAMER_ENTITY_STATE_SCD2_V1) already owns name HISTORY — it carries entityName and it
// already has the transition invariant that keeps it from inflating. Recording history here too would be a
// second owner of one fact. See migration 095's header for the governing-law half of that argument.
//
// PURE BY CONSTRUCTION: every function below is input → output with no database and no network, so the guard
// can prove the parent chain and the rename behaviour without spending a request.

/** One entity as the vendor described it on a dimension read. */
export type ObservedEntity = {
  entityLevel: string
  entityId: string
  entityName: string | null
  parentEntityId: string | null
}

/** A row ready for the SCD-1 upsert. */
export type DimensionRow = ObservedEntity & { clientId: string; platform: string; customerId: string }

/**
 * ⛔ THE PARENT THAT IS ALREADY IN THE ID. Returns the parent resource name for the forms whose id genuinely
 * encodes it, and NULL for every other shape — including shapes that merely LOOK parseable.
 *
 * `customers/{cid}/adGroupAds/{adGroupId}~{adId}` → `customers/{cid}/adGroups/{adGroupId}`
 *
 * ⚠ IT RETURNS NULL FOR ad_group AND campaign ON PURPOSE. Their path parent is the customer and their logical
 * parent is not, so a path-parse there would produce a confident wrong answer. Null means "ask the vendor",
 * which is what the dimension read does.
 */
export function parentFromResourceName(entityId: string): string | null {
  const m = /^customers\/(\d+)\/adGroupAds\/(\d+)~(\d+)$/.exec(entityId)
  if (!m) return null
  return `customers/${m[1]}/adGroups/${m[2]}`
}

/**
 * Fold a dimension read into upsert rows. The vendor's own parent field wins; the id-derived parent is the
 * fallback for the tilde form, so an ad row still chains even if the read did not carry ad_group explicitly.
 */
export function planDimensionRows(a: {
  clientId: string
  platform: string
  customerId: string
  observed: ObservedEntity[]
}): DimensionRow[] {
  const byKey = new Map<string, DimensionRow>()
  for (const o of a.observed) {
    if (!o.entityId || !o.entityLevel) continue
    const parent = o.parentEntityId ?? parentFromResourceName(o.entityId)
    const key = `${o.entityLevel}|${o.entityId}`
    const prior = byKey.get(key)
    // ⛔ LAST WRITE WINS WITHIN ONE READ, BUT A NAME NEVER LOSES TO A NULL. Two rows for one entity inside a
    // single read is normal (an ad group appears once per ad); the named one is the informative one.
    if (prior) {
      byKey.set(key, {
        ...prior,
        entityName: o.entityName ?? prior.entityName,
        parentEntityId: parent ?? prior.parentEntityId,
      })
      continue
    }
    byKey.set(key, {
      clientId: a.clientId, platform: a.platform, customerId: a.customerId,
      entityLevel: o.entityLevel, entityId: o.entityId,
      entityName: o.entityName ?? null,
      parentEntityId: parent,
    })
  }
  return [...byKey.values()]
}

/**
 * ⛔ THE SCD-1 MERGE, AS A PURE DECISION SO IT IS PROVABLE. Given what the table holds and what was just
 * observed, say which rows actually need writing.
 *
 * AN UNCHANGED ENTITY WRITES NOTHING. Re-reading a dimension daily and upserting regardless would rewrite
 * every entity every day — the row-churn `entity_state_history` was built to avoid, applied here to write
 * VOLUME rather than row count. A rename writes exactly one row.
 *
 * ⛔ AND A NULL NEVER OVERWRITES A KNOWN NAME. "The read did not carry a name" and "the vendor says the name
 * is gone" are different facts and only one of them is in our hands. Treating the first as the second would
 * blank a working name the moment a dimension read came back thin.
 */
export function decideDimensionWrites(
  held: Map<string, { entityName: string | null; parentEntityId: string | null }>,
  planned: DimensionRow[],
): DimensionRow[] {
  const out: DimensionRow[] = []
  for (const p of planned) {
    const prior = held.get(`${p.entityLevel}|${p.entityId}`)
    if (!prior) { out.push(p); continue }
    const name = p.entityName ?? prior.entityName
    const parent = p.parentEntityId ?? prior.parentEntityId
    if (name === prior.entityName && parent === prior.parentEntityId) continue
    out.push({ ...p, entityName: name, parentEntityId: parent })
  }
  return out
}

/**
 * ⛔ THE CHAIN, RESOLVED FROM THE DIMENSION ALONE. Walks up from an entity to the account, returning each
 * link's id and current name. Used by the guard to prove an ad names its ad group, an ad group its campaign,
 * and a campaign its account — and by any future reader that wants the breadcrumb.
 *
 * ⚠ IT IS CYCLE-SAFE AND SAYS SO. A dimension is a tree by construction, but a bad write could make it a
 * cycle, and a resolver that loops forever on bad data is a worse defect than the bad data.
 */
export function resolveChain(
  dimension: Map<string, { entityLevel: string; entityName: string | null; parentEntityId: string | null }>,
  startLevel: string,
  startId: string,
  maxDepth = 8,
): Array<{ entityLevel: string; entityId: string; entityName: string | null }> {
  const chain: Array<{ entityLevel: string; entityId: string; entityName: string | null }> = []
  const seen = new Set<string>()
  let level = startLevel, id: string | null = startId
  for (let i = 0; i < maxDepth && id; i++) {
    const key = `${level}|${id}`
    if (seen.has(key)) break // a cycle — stop, do not hang
    seen.add(key)
    const row = dimension.get(key)
    if (!row) { chain.push({ entityLevel: level, entityId: id, entityName: null }); break }
    chain.push({ entityLevel: row.entityLevel, entityId: id, entityName: row.entityName })
    if (!row.parentEntityId) break
    // The parent's level is read from the dimension rather than assumed, so a new resource shape needs no
    // change here — the same reason the writer refuses `if (resource === …)`.
    const parentKey = [...dimension.keys()].find((k) => k.endsWith(`|${row.parentEntityId}`))
    if (!parentKey) { chain.push({ entityLevel: 'unknown', entityId: row.parentEntityId, entityName: null }); break }
    level = parentKey.slice(0, parentKey.indexOf('|'))
    id = row.parentEntityId
  }
  return chain
}

/**
 * The three dimension reads. UN-SEGMENTED — no `segments.date`, so each is one cheap query over the account's
 * current entities rather than a report. The parent field is the vendor's own, which is why ad_group → campaign
 * is answerable at all.
 * ⛔ NO `if (resource === …)` AND NO NEW GOOGLE CONSTANT IN CODE: this is DATA, the same posture
 * `universe-surfaces.ts` takes for every other per-resource fact.
 */
export const DIMENSION_READS: Array<{ entityLevel: string; gaql: string; idField: string; nameField: string; parentField: string | null }> = [
  {
    entityLevel: 'campaign',
    gaql: 'SELECT campaign.resource_name, campaign.name FROM campaign',
    idField: 'campaign.resource_name', nameField: 'campaign.name', parentField: null,
  },
  {
    entityLevel: 'ad_group',
    gaql: 'SELECT ad_group.resource_name, ad_group.name, campaign.resource_name FROM ad_group',
    idField: 'ad_group.resource_name', nameField: 'ad_group.name', parentField: 'campaign.resource_name',
  },
  {
    entityLevel: 'ad_group_ad',
    gaql: 'SELECT ad_group_ad.resource_name, ad_group_ad.ad.name, ad_group.resource_name FROM ad_group_ad',
    idField: 'ad_group_ad.resource_name', nameField: 'ad_group_ad.ad.name', parentField: 'ad_group.resource_name',
  },
]

/** Read a dotted path off a vendor row without knowing which resource it is. */
export function pluck(row: any, path: string): string | null {
  let v: any = row
  for (const part of path.split('.')) {
    if (v == null) return null
    // the library returns camelCase for some fields and snake_case for others; try both, never branch on resource
    v = v[part] ?? v[part.replace(/_([a-z])/g, (_m, c) => c.toUpperCase())]
  }
  return v == null || v === '' ? null : String(v)
}

/** Turn one dimension read's rows into ObservedEntity, generically. */
export function observedFromRows(read: (typeof DIMENSION_READS)[number], rows: any[]): ObservedEntity[] {
  const out: ObservedEntity[] = []
  for (const r of rows) {
    const id = pluck(r, read.idField)
    if (!id) continue
    out.push({
      entityLevel: read.entityLevel,
      entityId: id,
      entityName: pluck(r, read.nameField),
      parentEntityId: read.parentField ? pluck(r, read.parentField) : null,
    })
  }
  return out
}
