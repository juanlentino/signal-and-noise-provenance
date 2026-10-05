// The ledger adapter: signed activity under one key, as events at witnessed
// heights. Read-only over files already in the repository; no network.
//
// A record becomes an event only if it passes the same offline checks
// verify-records.mjs runs: the content hash recomputes, the Ed25519 signature
// holds under a key in keys/key-history.json, the .ots proof commits to the
// content hash, the anchor is confirmed, and the proof's Bitcoin block is the
// one the record names. Note and page records must also sit on an unbroken
// commit chain (ledger-records.mjs). Anything else is listed with its reason
// and contributes nothing.
//
// The clock is the confirmed block height. published_at, commit times and the
// wall clock are self-reported; the height is the block the .ots proof
// attests. Offline, that is the block the proof names: matching it to the real
// chain's merkle root is the network step (`node verify.mjs <note_uid>`), which
// this tool never makes. Nothing below reads published_at.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalize } from "../normalize/canonical-json.mjs";
import { auditPath, leafHash, verifyAuditPath } from "../normalize/merkle-v1.mjs";
import { verifyRecord } from "../verify.mjs";
import { expectedParent, recordVersions } from "../ledger-records.mjs";

const GENESIS = "genesis/2026-07-09";
const SUBJECT_DIRS = ["notes", "pages"];
// rights-signals/ is not read: those records hash and sign the captured file's
// raw bytes, not a canonical payload, so verifyRecord() cannot check them
// (verify-rights-signals.mjs says why). A class this adapter cannot check is a
// class it does not offer. Retractions are read only to name withdrawn
// subjects: a retraction is never an event of its own (owner decision D3).
const readJson = (root, path) => JSON.parse(readFileSync(join(root, path), "utf8"));
const listDirs = (root, dir) => (existsSync(join(root, dir)) ? readdirSync(join(root, dir)).filter((name) => !name.includes(".")).sort() : []);

/** Run the offline checks on one record. Returns { height } or { reason }. */
async function check(root, keys, path, record) {
  const key = keys.get(record.pubkey_id);
  if (!key) return { reason: `signed under ${JSON.stringify(record.pubkey_id)}, a key outside the history` };
  const ots = new Uint8Array(readFileSync(join(root, path.replace(/\.json$/, ".ots"))));
  const r = await verifyRecord({ record, pubB64: key.public_key_base64, otsBytes: ots });
  if (!r.hashOk || !r.sigOk || !r.otsHashOk) return { reason: `fails offline checks (hash=${r.hashOk}, signature=${r.sigOk}, otsDigest=${r.otsHashOk})` };
  if (record.ots?.status !== "confirmed") return { reason: `anchor is ${JSON.stringify(record.ots?.status ?? null)}, not confirmed` };
  if (!r.btc || r.btc.height !== record.ots.bitcoin_block) return { reason: "proof does not attest the Bitcoin block the record names" };
  return { height: BigInt(r.btc.height) };
}

/** Genesis root and its leaves: each leaf proven by its audit path. */
async function checkGenesis(root, keys) {
  if (!existsSync(join(root, `${GENESIS}-root.json`))) return { record: null, result: { reason: null }, leaves: new Map() };
  const record = readJson(root, `${GENESIS}-root.json`);
  const result = await check(root, keys, `${GENESIS}-root.json`, record);
  const leaves = new Map();
  if (result.reason) return { record, result, leaves };
  const hashes = record.payload.notes.map((note) => note.leaf_hash);
  readJson(root, `${GENESIS}-leaves.json`).forEach((entry, index) => {
    const leaf = leafHash(canonicalize(entry.payload));
    if (entry.note_uid === record.payload.notes[index]?.note_uid && leaf === hashes[index]
      && verifyAuditPath(leaf, auditPath(hashes, index), record.payload.root)) leaves.set(entry.note_uid, leaf);
  });
  return { record, result, leaves };
}

/**
 * Events for one note or page from its checked records. Pure, and it reads
 * only class, version and height: a work is the earliest of the genesis leaf
 * and v1, a revision is each later version.
 */
export function subjectEvents(uid, genesisHeight, checked) {
  const events = [];
  const v1 = checked.find((c) => c.version === 1);
  const starts = [genesisHeight, v1?.height].filter((h) => h !== undefined && h !== null);
  if (starts.length) events.push({ class: "work", uid, version: 1, height: starts.reduce((a, b) => (b < a ? b : a)) });
  for (const c of checked) if (c.version > 1) events.push({ class: "revision", uid, version: c.version, height: c.height });
  return events;
}

export async function ledgerEvents(root) {
  const history = readJson(root, "keys/key-history.json");
  const keys = new Map(history.keys.map((key) => [key.id, key]));
  const keyId = history.current;
  const genesis = await checkGenesis(root, keys);
  const genesisOk = genesis.record !== null && !genesis.result.reason && genesis.record.pubkey_id === keyId;
  const genesisHeight = genesisOk ? genesis.result.height : null;
  const excluded = genesis.result.reason ? [{ path: `${GENESIS}-root.json`, reason: genesis.result.reason }] : [];
  const heights = genesisOk ? [genesisHeight] : [];
  const events = [];
  const counted = (path, record, result) => {
    if (result.reason) excluded.push({ path, reason: result.reason });
    else if (record.pubkey_id !== keyId) excluded.push({ path, reason: `signed under ${record.pubkey_id}, not the key being weighed` });
    else { heights.push(result.height); return result.height; }
    return null;
  };

  const uids = [...new Set(SUBJECT_DIRS.flatMap((dir) => listDirs(root, dir)))].sort();
  for (const uid of uids) {
    const byHash = new Map();
    for (const dir of SUBJECT_DIRS) {
      for (const version of recordVersions(join(root, dir), uid)) {
        const path = `${dir}/${uid}/v${version}.json`;
        const record = readJson(root, path);
        if (!byHash.has(record.content_hash)) byHash.set(record.content_hash, { path, record, version });
      }
    }
    const checked = [];
    let previous = null;
    let broken = false;
    for (const { path, record, version } of [...byHash.values()].sort((a, b) => a.version - b.version || a.path.localeCompare(b.path))) {
      const result = await check(root, keys, path, record);
      const parent = expectedParent({ version, genesisLeaf: genesis.leaves.get(uid) ?? null, previousContentHash: previous?.content_hash ?? null });
      if (!result.reason && (record.payload.version !== version || (record.payload.parent ?? null) !== parent)) result.reason = "not on an unbroken commit chain";
      // verify-records.mjs halts at the first failure, so nothing after one
      // has passed the check this adapter reuses.
      if (!result.reason && broken) result.reason = "its commit chain runs through an earlier record that did not pass";
      const height = counted(path, record, result);
      if (height !== null) checked.push({ version, height });
      else broken = true;
      previous = record;
    }
    const fromGenesis = genesisOk && genesis.leaves.has(uid) ? genesisHeight : null;
    events.push(...subjectEvents(uid, fromGenesis, checked));
  }

  const retracted = new Set();
  const seen = new Set();
  for (const dir of ["rights-evidence", "retractions"]) {
    for (const uid of listDirs(root, dir)) {
      for (const version of recordVersions(join(root, dir), uid)) {
        const path = `${dir}/${uid}/v${version}.json`;
        const record = readJson(root, path);
        // One signed record copied under a second id is still one record.
        if (seen.has(record.content_hash)) continue;
        seen.add(record.content_hash);
        const height = counted(path, record, await check(root, keys, path, record));
        if (height === null) continue;
        if (dir === "retractions") retracted.add(record.payload.note_uid);
        else events.push({ class: "rights-evidence", uid, version, height });
      }
    }
  }

  const retiredPath = join(root, "retired-subjects.json");
  const retired = existsSync(retiredPath) ? readJson(root, "retired-subjects.json").retired.map((r) => r.note_uid) : [];
  const key = keys.get(keyId);
  return {
    key: { id: keyId, sha256_fingerprint: key.sha256_fingerprint },
    events,
    excluded,
    highest: heights.reduce((a, b) => (b > a ? b : a), 0n),
    withdrawn: uids.filter((uid) => retracted.has(uid)),
    retired: uids.filter((uid) => retired.includes(uid)),
  };
}
