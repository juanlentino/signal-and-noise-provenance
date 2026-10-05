// The offline checks one record must pass before weigh.mjs counts it, and the
// genesis root with its derivations. The same checks verify-records.mjs and
// verify-genesis.mjs run, read here without their side effects.
//
// The height a passing record reports is the block its .ots proof attests.
// Offline, that is the block the proof names: matching it to the real chain's
// merkle root is the network step (`node verify.mjs <note_uid>`), which this
// tool never makes.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalize } from "../normalize/canonical-json.mjs";
import { auditPath, leafHash, rootFromLeafHashes, verifyAuditPath } from "../normalize/merkle-v1.mjs";
import { verifyRecord } from "../verify.mjs";
import { bitcoinAttestations } from "../verify/ots.mjs";

export const GENESIS = "genesis/2026-07-09";
export const readJson = (root, path) => JSON.parse(readFileSync(join(root, path), "utf8"));
export const listDirs = (root, dir) => (existsSync(join(root, dir)) ? readdirSync(join(root, dir)).filter((name) => !name.includes(".")).sort() : []);

/**
 * Run the offline checks on one record. Returns { height } or { reason }. A
 * proof that cannot be read is a reason, not a crash: one damaged file must
 * not stop the rest of the ledger from being weighed.
 */
export async function check(root, keys, path, record) {
  try {
    return await checkOrThrow(root, keys, path, record);
  } catch (error) {
    return { reason: `cannot be checked (${error.message})` };
  }
}

async function checkOrThrow(root, keys, path, record) {
  const key = keys.get(record.pubkey_id);
  if (!key) return { reason: `signed under ${JSON.stringify(record.pubkey_id)}, a key outside the history` };
  if (key.role === "author") return { reason: `signed by the author key ${record.pubkey_id}, which only countersigns` };
  const ots = new Uint8Array(readFileSync(join(root, path.replace(/\.json$/, ".ots"))));
  const r = await verifyRecord({ record, pubB64: key.public_key_base64, otsBytes: ots });
  if (!r.hashOk || !r.sigOk || !r.otsHashOk) return { reason: `fails offline checks (hash=${r.hashOk}, signature=${r.sigOk}, otsDigest=${r.otsHashOk})` };
  if (record.ots?.status !== "confirmed") return { reason: `anchor is ${JSON.stringify(record.ots?.status ?? null)}, not confirmed` };
  if (!r.btc || r.btc.height !== record.ots.bitcoin_block) return { reason: "proof does not attest the Bitcoin block the record names" };
  // A forked proof attests several blocks, and which one the record names
  // sits outside the signed payload. The clock is the earliest the proof
  // attests: the strongest "existed by" claim, and one no edit can move.
  return { height: BigInt((await bitcoinAttestations(ots))[0].height) };
}

/**
 * Byte-identical copies of one signed record (the About page's v2 sits in
 * both notes/ and pages/) are one record. Check each copy in path order and
 * keep the first that passes, so a damaged copy cannot hide a sound one.
 */
export async function pickCopy(root, keys, copies) {
  let first = null;
  for (const copy of copies) {
    const result = await check(root, keys, copy.path, copy.record);
    if (!result.reason) return { ...copy, result };
    first ??= { ...copy, result };
  }
  return first;
}

/**
 * The genesis root, and which of its leaves are proven. `chainLeaves` are the
 * leaf hashes the signed root names, the parents its notes' v1 records must
 * carry. `proven` holds a leaf's subject only when the whole derivation set
 * reproduces the root, as verify-genesis.mjs requires: a truncated or altered
 * set proves nothing, and the reason is listed.
 */
/**
 * As verify-genesis.mjs: the record is a genesis root, and the leaves it names
 * rebuild the very root its anchor commits to. Pure, because a signed root
 * that breaks this cannot be built without the key, and a rule nobody can
 * exercise end to end is tested directly instead.
 */
/** The root's note list, or [] when any entry is not a { note_uid, leaf_hash } pair. */
function genesisNotes(record) {
  const notes = record?.payload?.notes;
  const sound = Array.isArray(notes) && notes.every((n) => n !== null && typeof n === "object" && typeof n.note_uid === "string" && typeof n.leaf_hash === "string");
  return sound ? notes : [];
}

export function genesisRootHolds(record) {
  const notes = genesisNotes(record);
  return record.payload.kind === "genesis" && notes.length > 0
    && rootFromLeafHashes(notes.map((note) => note.leaf_hash)) === record.payload.root
    && record.payload.root === record.content_hash;
}

export async function checkGenesis(root, keys) {
  const none = { record: null, result: { reason: null }, chainLeaves: new Map(), proven: new Set(), reason: null };
  if (!existsSync(join(root, `${GENESIS}-root.json`))) return none;
  const record = readJson(root, `${GENESIS}-root.json`);
  const result = await check(root, keys, `${GENESIS}-root.json`, record);
  // The leaves the root names stay the parents its notes' v1 records must
  // carry even when the root itself fails, as verify-records.mjs reads them;
  // a failed root only withholds the genesis events.
  const notes = genesisNotes(record);
  const chainLeaves = new Map(notes.map((note) => [note.note_uid, note.leaf_hash]));
  if (result.reason) return { ...none, record, result, chainLeaves };
  const hashes = notes.map((note) => note.leaf_hash);
  const derivations = existsSync(join(root, `${GENESIS}-leaves.json`)) ? readJson(root, `${GENESIS}-leaves.json`) : [];
  const rootOk = genesisRootHolds(record);
  const complete = rootOk && Array.isArray(derivations) && derivations.length === notes.length && derivations.every((entry, index) => {
    if (entry === null || typeof entry !== "object" || entry.payload === null || typeof entry.payload !== "object") return false;
    const leaf = leafHash(canonicalize(entry.payload));
    return entry.note_uid === notes[index].note_uid && leaf === hashes[index]
      && verifyAuditPath(leaf, auditPath(hashes, index), record.payload.root);
  });
  if (!complete) return { record, result, chainLeaves, proven: new Set(), reason: `the derivations do not reproduce all ${notes.length} genesis leaves` };
  return { record, result, chainLeaves, proven: new Set(chainLeaves.keys()), reason: null };
}
