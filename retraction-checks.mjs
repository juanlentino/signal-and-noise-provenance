// The retraction rules, in a module of its own so they can be tested offline.
//
// verify-retractions.mjs is a runner: it walks the directory, reads files and
// verifies signatures, then hands each record here. Splitting them follows the
// same lesson key-pins.mjs records — a check reachable only through filesystem
// walking and Ed25519 verification is a check with no test, and this one will
// spend most of its life looking at zero retractions. A verifier nobody has
// watched fail is not evidence.

/**
 * Everything wrong with one retraction record, as [problem, detail] pairs.
 * Empty means it holds.
 *
 * @param {object} record  The parsed retraction record.
 * @param {{uid: string, file: string, exists: (path: string) => boolean, publishedKeyIds: string[]}} ctx
 * @returns {Array<[string, string]>}
 */
export function retractionDivergences(record, ctx) {
  const p = (record && record.payload) || {};
  const out = [];

  if (p.kind !== "retraction") {
    out.push(["kind", `expected "retraction", got ${JSON.stringify(p.kind)}`]);
    return out; // nothing else is meaningful about a non-retraction.
  }

  // The payload must agree with where the file sits, or a retraction could be
  // filed against one record while pointing its evidence at another.
  if (p.note_uid !== ctx.uid || ctx.file !== `v${p.version}.json`) {
    out.push(["path", `payload names ${p.note_uid}/v${p.version}, filed at ${ctx.uid}/${ctx.file}`]);
  }

  // THE PROPERTY THAT MATTERS MOST. Retracting is not deleting: the original
  // stays exactly where it was published, because anyone who fetched, cited or
  // compared against it must still be able to find what we actually said. An
  // absent subject means either it was never published (nothing to retract) or
  // it was removed — an erasure with paperwork.
  if (!p.retracted_path || !ctx.exists(p.retracted_path)) {
    out.push(["retracted_path", `${p.retracted_path} is absent: a retraction never removes its subject`]);
  }

  // A withdrawal with no stated reason is the same erasure, quieter.
  if (!String(p.what_was_wrong || "").trim()) {
    out.push(["what_was_wrong", "a retraction with no stated reason is an erasure"]);
  }

  if (!ctx.publishedKeyIds.includes(String(record.pubkey_id || ""))) {
    out.push(["pubkey_id", `signed by ${record.pubkey_id}, which the key history does not publish`]);
  }

  return out;
}
