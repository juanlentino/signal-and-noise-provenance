// Does an index row still describe the anchor state of the record it names?
//
// index.json is a DERIVED mirror of the committed records. Three places compare
// a row against its record: the note standalone row, the note per-note anchor
// row, and the page row. All three ask the identical question, and for a while
// all three answered it slightly differently.
//
// The bug this module exists to end: a record written before worker v1.10.1
// OMITS `bitcoin_block` entirely, while the index always writes an explicit
// `null`. A comparison that normalizes only one side reads `null !== undefined`
// and throws. That reddened CI on 2026-08-11; the fix was applied to the PAGE
// row, where it had been noticed, and the two note rows kept the old shape —
// so the identical failure returned on 2026-08-14 as
// `record says pending/null, index says pending/undefined`.
//
// Extracted so the rule is stated ONCE and every call site inherits it. The
// asymmetry was never a typo at one line; it was a missing shared answer.

/**
 * Compare a record's OTS state against the index row that claims to mirror it.
 *
 * Absent and explicit-null are the SAME answer on EITHER side — the worker may
 * omit the key, the index always writes it. Everything else must differ loudly:
 * a row advertising a confirmed block the record does not carry is precisely
 * the corruption this check exists to catch, so the absent/null equivalence is
 * deliberately narrow.
 *
 * `??` and not `||`: block 0 is not a real height, but collapsing it to null
 * would hide a corrupt row rather than report it.
 *
 * @param {{status?: string, bitcoin_block?: number|null}} recordOts
 *        The record's `ots` object.
 * @param {{ots_status?: string, bitcoin_block?: number|null}} row
 *        The index row, in index.json's own key naming.
 * @returns {boolean} true when the row faithfully mirrors the record.
 */
export function otsMatches(recordOts, row) {
  const recordStatus = recordOts?.status ?? null;
  const rowStatus = row?.ots_status ?? null;
  if (recordStatus !== rowStatus) return false;
  return (recordOts?.bitcoin_block ?? null) === (row?.bitcoin_block ?? null);
}

/**
 * Render a record/row anchor pair the way every "index is stale" message does,
 * so the three call sites cannot drift in how they REPORT a mismatch either.
 *
 * @param {{status?: string, bitcoin_block?: number|null}} recordOts
 * @param {{ots_status?: string, bitcoin_block?: number|null}} row
 * @returns {string} e.g. `record says pending/null, index says confirmed/860123`
 */
export function describeMismatch(recordOts, row) {
  const left = `${recordOts?.status ?? null}/${recordOts?.bitcoin_block ?? null}`;
  const right = `${row?.ots_status ?? null}/${row?.bitcoin_block ?? null}`;
  return `record says ${left}, index says ${right}`;
}
