// Is the served page TAMPERED WITH, or merely STALE?
//
// verify:pages fetches the bare URL on purpose — that is what a stranger sees,
// and verifying a cache-busted URL would prove the origin honest while readers
// were served something else. But the bare URL conflates two very different
// failures under one verdict, `served-page drift`:
//
//   1. The content genuinely changed and no longer matches the signed record.
//      This is the accusation the ledger exists to make.
//   2. A cache layer is serving an older render. The origin is correct, the
//      record is correct, and nobody tampered with anything.
//
// Measured 2026-08-15: the-master-never-moves reported drift for 50 minutes.
// The bare URL carried `last-modified: Fri, 14 Aug 16:25:36 GMT` — 27 hours
// old — and a sentence the signed record did not have. The same URL with a
// cache-busting query returned `Sat, 15 Aug 19:10:36 GMT` and reproduced the
// record exactly, as did the .json twin. Three per-post purges had already
// fired. Only a zone purge cleared it.
//
// Both outcomes stay RED. This is not tolerance — a page stale for a day is a
// real problem, and readers really were served the wrong text. It is precision:
// "stale edge cache" sends you to the purge path, "drift" sends you to the
// content. Reporting the second when it is the first burns the alarm.

/**
 * Decide which failure a page mismatch actually is.
 *
 * `freshMatches` must come from a cache-busted fetch of the SAME url. When the
 * origin reproduces the signed record and the bare URL does not, the ledger is
 * intact and a cache is lying.
 *
 * A cache-busted fetch that ALSO fails to reproduce the record is the honest
 * "drift" case — deliberately the default, so an inconclusive probe never
 * downgrades a real accusation into a cache excuse.
 *
 * @param {{bareMatches: boolean, freshMatches: boolean}} observed
 * @returns {"stale-edge"|"drift"}
 */
export function classifyPageFailure({ bareMatches, freshMatches }) {
  if (freshMatches === true && bareMatches === false) return "stale-edge";
  return "drift";
}

/**
 * Summarize the cache headers that make a staleness verdict checkable by a
 * human reading the CI log — without them the verdict is an assertion.
 *
 * Absent headers print as `(none)` rather than being dropped: a CDN that
 * reports NO cache status is itself worth seeing.
 *
 * @param {Headers|null|undefined} headers
 * @returns {string}
 */
export function describeEdge(headers) {
  const read = (name) => headers?.get?.(name) ?? null;
  const parts = ["cf-cache-status", "age", "last-modified", "cf-ray"]
    .map((name) => `${name}=${read(name) ?? "(none)"}`);
  return parts.join(", ");
}
