// The ledger adapter: signed activity under one key, as events at the block
// heights their proofs attest. Read-only over files already in the
// repository; no network.
//
// A record becomes an event only if it passes the offline checks in
// record-checks.mjs, which are the ones verify-records.mjs runs. Note and page
// records must also sit on a commit chain that is contiguous from v1 and
// unbroken up to them (ledger-records.mjs). Chain soundness and key ownership
// are separate questions: a sound record signed under an earlier key keeps the
// chain whole and is listed as belonging to another key. Anything else is
// listed with its reason and contributes nothing.
//
// The clock is the block height, never published_at, commit times or the wall
// clock. Nothing below reads published_at.
//
// rights-signals/ is not read: those records hash and sign the captured file's
// raw bytes, not a canonical payload, so verifyRecord() cannot check them
// (verify-rights-signals.mjs says why). Retractions are read only to name
// withdrawn subjects: a retraction is never an event of its own (owner
// decision D3).

import { existsSync } from "node:fs";
import { join } from "node:path";
import { expectedParent, recordVersions } from "../ledger-records.mjs";
import { check, checkGenesis, GENESIS, listDirs, pickCopy, readJson } from "./record-checks.mjs";

const SUBJECT_DIRS = ["notes", "pages"];

/**
 * Events for one note or page from its counted records. Pure, and it reads
 * only class, version and height: a work is the earliest of the genesis leaf
 * and v1, a revision is each later version.
 */
export function subjectEvents(uid, genesisHeight, counted) {
  const events = [];
  const v1 = counted.find((c) => c.version === 1);
  const starts = [genesisHeight, v1?.height].filter((h) => h !== undefined && h !== null);
  if (starts.length) events.push({ class: "work", uid, version: 1, height: starts.reduce((a, b) => (b < a ? b : a)) });
  for (const c of counted) if (c.version > 1) events.push({ class: "revision", uid, version: c.version, height: c.height });
  return events;
}

/** Every record under these directories for one id, copies grouped by content_hash. */
function copiesOf(root, dirs, uid) {
  const byHash = new Map();
  for (const dir of dirs) {
    for (const version of recordVersions(join(root, dir), uid)) {
      const path = `${dir}/${uid}/v${version}.json`;
      const record = readJson(root, path);
      byHash.set(record.content_hash, [...(byHash.get(record.content_hash) ?? []), { path, record, version }]);
    }
  }
  return [...byHash.values()].sort((a, b) => a[0].version - b[0].version || (a[0].path < b[0].path ? -1 : 1));
}

export async function ledgerEvents(root) {
  const history = readJson(root, "keys/key-history.json");
  const keys = new Map(history.keys.map((key) => [key.id, key]));
  const keyId = history.current;
  const genesis = await checkGenesis(root, keys);
  const excluded = [];
  if (genesis.result.reason) excluded.push({ path: `${GENESIS}-root.json`, reason: genesis.result.reason });
  if (genesis.reason) excluded.push({ path: `${GENESIS}-leaves.json`, reason: genesis.reason });
  const genesisHeight = genesis.proven.size && genesis.record.pubkey_id === keyId ? genesis.result.height : null;
  const heights = genesis.record && !genesis.result.reason ? [genesis.result.height] : [];
  const events = [];

  /** List a record that does not count; return its height when it does. */
  const tally = (path, record, reason, height) => {
    if (reason) excluded.push({ path, reason });
    else {
      heights.push(height);
      if (record.pubkey_id === keyId) return height;
      excluded.push({ path, reason: `signed under ${record.pubkey_id}, not the key being weighed` });
    }
    return null;
  };

  const subjects = [...new Set(SUBJECT_DIRS.flatMap((dir) => listDirs(root, dir)))].sort();
  for (const uid of subjects) {
    const counted = [];
    let previous = null;
    let broken = false;
    for (const [index, copies] of copiesOf(root, SUBJECT_DIRS, uid).entries()) {
      const { path, record, version, result } = await pickCopy(root, keys, copies);
      const parent = expectedParent({ version, genesisLeaf: genesis.chainLeaves.get(uid) ?? null, previousContentHash: previous?.content_hash ?? null });
      let reason = result.reason;
      if (!reason && version !== index + 1) reason = "record versions are not contiguous from v1";
      if (!reason && (record.payload.version !== version || (record.payload.parent ?? null) !== parent)) reason = "not on an unbroken commit chain";
      // verify-records.mjs halts at the first failure, so nothing after one
      // has passed the check this adapter reuses.
      if (!reason && broken) reason = "its commit chain runs through an earlier record that did not pass";
      if (reason) broken = true;
      const height = tally(path, record, reason, result.height);
      if (height !== null) counted.push({ version, height });
      previous = record;
    }
    events.push(...subjectEvents(uid, genesis.proven.has(uid) ? genesisHeight : null, counted));
  }

  const retracted = new Set();
  const evidence = listDirs(root, "rights-evidence");
  for (const dir of ["rights-evidence", "retractions"]) {
    // One signed record copied under a second id is still one record.
    const groups = new Map();
    for (const uid of listDirs(root, dir)) {
      for (const [copy] of copiesOf(root, [dir], uid)) groups.set(copy.record.content_hash, [...(groups.get(copy.record.content_hash) ?? []), { ...copy, uid }]);
    }
    for (const copies of groups.values()) {
      const { path, record, version, uid, result } = await pickCopy(root, keys, copies);
      if (dir === "retractions") {
        if (!result.reason) { retracted.add(record.payload.note_uid); heights.push(result.height); } else excluded.push({ path, reason: result.reason });
        continue;
      }
      const height = tally(path, record, result.reason, result.height);
      if (height !== null) events.push({ class: "rights-evidence", uid, version, height });
    }
  }

  const retired = existsSync(join(root, "retired-subjects.json")) ? readJson(root, "retired-subjects.json").retired.map((r) => r.note_uid) : [];
  const ids = [...subjects, ...evidence].sort();
  return {
    key: { id: keyId, sha256_fingerprint: keys.get(keyId).sha256_fingerprint },
    events,
    excluded,
    highest: heights.reduce((a, b) => (b > a ? b : a), 0n),
    withdrawn: ids.filter((uid) => retracted.has(uid)),
    retired: subjects.filter((uid) => retired.includes(uid)),
  };
}
