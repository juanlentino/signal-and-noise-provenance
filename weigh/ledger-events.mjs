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
import { retractionDivergences } from "../retraction-checks.mjs";
import { evidenceDivergences } from "../rights-evidence-checks.mjs";
import { check, checkGenesis, GENESIS, listDirs, pickCopy, readJson } from "./record-checks.mjs";

const SUBJECT_DIRS = ["notes", "pages"];
const SITE_HOST = "juanlentino.com"; // as verify-rights-evidence.mjs pins it

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

/**
 * Every record under these directories for one id, grouped by version. The
 * group is keyed by the filename, not by the record's own content_hash: that
 * field is unchecked until a copy passes, so a damaged copy cannot split from
 * the sound one and take its place in the sequence.
 */
function copiesOf(root, dirs, uid) {
  const byVersion = new Map();
  for (const dir of dirs) {
    for (const version of recordVersions(join(root, dir), uid)) {
      const path = `${dir}/${uid}/v${version}.json`;
      byVersion.set(version, [...(byVersion.get(version) ?? []), { path, record: readJson(root, path), version }]);
    }
  }
  return [...byVersion.entries()].sort(([a], [b]) => a - b).map(([, copies]) => copies);
}

export async function ledgerEvents(root) {
  const history = readJson(root, "keys/key-history.json");
  const keys = new Map(history.keys.map((key) => [key.id, key]));
  const keyId = history.current;
  const genesis = await checkGenesis(root, keys);
  const excluded = [];
  if (genesis.result.reason) excluded.push({ path: `${GENESIS}-root.json`, reason: genesis.result.reason });
  if (genesis.reason) excluded.push({ path: `${GENESIS}-leaves.json`, reason: genesis.reason, height: genesis.result.height });
  const genesisHeight = genesis.proven.size && genesis.record.pubkey_id === keyId ? genesis.result.height : null;
  // A root whose derivations fail is rejected, and its height sets no clock.
  const heights = genesis.record && !genesis.result.reason && !genesis.reason ? [genesis.result.height] : [];
  const events = [];

  /**
   * List a record that does not count; return its height when it does. An
   * exclusion keeps the height its proof attests, when the checks got that
   * far, so a report at an earlier --at does not list a record not yet there.
   */
  const tally = (path, record, reason, height) => {
    if (reason) excluded.push({ path, reason, height });
    else {
      heights.push(height);
      if (record.pubkey_id === keyId) return height;
      excluded.push({ path, reason: `signed under ${record.pubkey_id}, not the key being weighed`, height });
    }
    return null;
  };

  // A subject the genesis root proves is visited even with no file of its own.
  const subjects = [...new Set([...SUBJECT_DIRS.flatMap((dir) => listDirs(root, dir)), ...genesis.proven])].sort();
  for (const uid of subjects) {
    const counted = [];
    let previous = null;
    let broken = false;
    for (const [index, copies] of copiesOf(root, SUBJECT_DIRS, uid).entries()) {
      const { path, record, version, result } = await pickCopy(root, keys, copies);
      const parent = expectedParent({ version, genesisLeaf: genesis.chainLeaves.get(uid) ?? null, previousContentHash: previous?.content_hash ?? null });
      let reason = result.reason;
      // The signed payload names its subject; a path cannot rename it, so a
      // record copied under another id is not a second history.
      // A note or page payload carries no kind; a signed retraction, rights
      // record or genesis root moved into notes/ or pages/ is not a work.
      if (!reason && (record.payload.kind !== undefined || typeof record.payload.content !== "string")) reason = `a ${JSON.stringify(record.payload.kind ?? "malformed")} record is not a note or page`;
      if (!reason && record.payload.note_uid !== uid) reason = `payload names subject ${record.payload.note_uid}, filed under ${uid}`;
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

  // Rights evidence and retractions also pass their own claim rules, the ones
  // verify-rights-evidence.mjs and verify-retractions.mjs apply, so a record
  // their verifiers reject neither counts nor withdraws anything.
  const months = new Map();
  for (const uid of listDirs(root, "rights-evidence")) {
    for (const version of recordVersions(join(root, "rights-evidence"), uid)) {
      const path = `rights-evidence/${uid}/v${version}.json`;
      const record = readJson(root, path);
      const result = await check(root, keys, path, record);
      let reason = result.reason;
      if (!reason) {
        const problems = await evidenceDivergences(record, { uid, version, host: SITE_HOST });
        if (problems.length) reason = `fails the rights-evidence rules (${problems.map(([k]) => k).join(", ")})`;
        else {
          const month = `${record.payload.month}:${record.payload.family}`;
          if (months.has(month)) reason = `repeats ${month}, already filed under ${months.get(month)}`;
          else months.set(month, uid);
        }
      }
      const height = tally(path, record, reason, result.height);
      if (height !== null) events.push({ class: "rights-evidence", uid, version, height });
    }
  }
  const withdrawals = new Map();
  for (const uid of listDirs(root, "retractions")) {
    for (const version of recordVersions(join(root, "retractions"), uid)) {
      const path = `retractions/${uid}/v${version}.json`;
      const record = readJson(root, path);
      const result = await check(root, keys, path, record);
      const problems = result.reason ? [] : retractionDivergences(record, { uid, file: `v${version}.json`, exists: (rel) => existsSync(join(root, rel)), publishedKeyIds: [...keys.keys()] });
      const reason = result.reason ?? (problems.length ? `fails the retraction rules (${problems.map(([k]) => k).join(", ")})` : null);
      if (reason) { excluded.push({ path, reason, height: result.height }); continue; }
      heights.push(result.height);
      const target = record.payload.note_uid;
      if (!withdrawals.has(target) || result.height < withdrawals.get(target)) withdrawals.set(target, result.height);
    }
  }

  const retired = existsSync(join(root, "retired-subjects.json")) ? readJson(root, "retired-subjects.json").retired.map((r) => r.note_uid) : [];
  return {
    key: { id: keyId, sha256_fingerprint: keys.get(keyId).sha256_fingerprint },
    events,
    excluded,
    highest: heights.reduce((a, b) => (b > a ? b : a), 0n),
    // Each with the height its retraction was anchored at, so a report at an
    // earlier --at does not show a withdrawal the record did not yet hold.
    withdrawn: [...withdrawals].map(([uid, height]) => ({ uid, height })).sort((a, b) => (a.uid < b.uid ? -1 : 1)),
    retired: subjects.filter((uid) => retired.includes(uid)),
  };
}
