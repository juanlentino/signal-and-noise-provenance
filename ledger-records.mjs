// Which record is a Note's current one?
//
// A Note's directory accumulates one signed record per published state:
// notes/<uid>/v1.json, v2.json, … each committing to its predecessor via
// payload.parent. Nothing is ever rewritten — an edit appends.
//
// Every consumer used to hardcode v1.json, which was correct only because no
// Note had ever been edited. The first edit (start-here, 2026-08-04) pinned the
// index to the superseded record, so verify:pages compared the live page
// against v1 and reported permanent "served-page drift" — the ledger accusing
// the site of tampering when it was the index that was stale. Both readings
// live here now so they cannot drift apart again.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const RECORD = /^v(\d+)\.json$/;

/**
 * Every committed record version for a Note, ascending.
 *
 * Sorts numerically: a lexicographic sort puts v10 before v2 and silently
 * reports v9 as the newest record of a ten-version Note.
 *
 * @param {string} notesRoot Directory holding one subdirectory per note UID.
 * @param {string} uid       The note UID.
 * @returns {number[]} Ascending versions; [] when the Note has no records
 *                     (or no directory — an absent Note is not an error here,
 *                     it is what the reverse-coverage guard is looking for).
 */
export function recordVersions(notesRoot, uid) {
  const dir = join(notesRoot, uid);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => name.match(RECORD)?.[1])
    .filter((version) => version !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
}

/**
 * The Note's current record version — the one its served page must reproduce.
 *
 * @param {string} notesRoot Directory holding one subdirectory per note UID.
 * @param {string} uid       The note UID.
 * @returns {number} Highest committed version, or 0 when there are none.
 */
export function latestRecordVersion(notesRoot, uid) {
  return recordVersions(notesRoot, uid).at(-1) ?? 0;
}

/**
 * The hash a record must name as its parent — the chain rule, stated once.
 *
 * The chain runs genesis leaf → v1 → v2 → …: a Note in the genesis Merkle tree
 * carries its leaf as v1's parent, one anchored on its own has no predecessor,
 * and every later record commits to the content_hash of the record it
 * supersedes. Nothing verified this until a Note was first edited, because with
 * one record per Note the link was always null-or-genesis and never
 * load-bearing.
 *
 * Kept as a pure function on purpose: `parent` sits INSIDE the signed payload,
 * so a tampered link fails the hash and signature checks long before it reaches
 * the chain comparison. The only way this rule fires in the wild is a validly
 * signed record naming the wrong predecessor — which cannot be constructed
 * without the signing key, and so cannot be exercised end-to-end in a test.
 * Testing the rule directly is what keeps it from being an unfalsifiable claim.
 *
 * @param {object}      args
 * @param {number}      args.version             The record's own version.
 * @param {string|null} [args.genesisLeaf]       This Note's genesis leaf hash,
 *                                               or null when it is anchored on
 *                                               its own.
 * @param {string|null} [args.previousContentHash] content_hash of v(version-1).
 * @returns {string|null} The required parent hash, or null when there is none.
 */
export function expectedParent({ version, genesisLeaf = null, previousContentHash = null }) {
  return version > 1 ? previousContentHash : genesisLeaf;
}
