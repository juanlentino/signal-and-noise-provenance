// The rules for author countersignatures and the author key, as pure
// functions over parsed records: what verify-countersignatures.mjs and
// verify-key-history.mjs enforce, and what countersign.mjs checks before it
// writes anything.
//
// A countersignature batch is an ordinary ledger record signed by the
// author's own SSH key. Its payload lists notes and pages by path and
// content hash; the author's signature over the canonical payload says the
// author attests those records. The anchor dates the countersignature, not
// the notes: it adds no earlier witness.

import { createHash } from "node:crypto";
import { canonicalize } from "./normalize/canonical-json.mjs";
import { SSHSIG_NAMESPACE, verifySshSig } from "./sshsig.mjs";

export const SCHEMA = "sn-countersignature-v1";
export const STATEMENT = "The author of juanlentino.com attests each listed record, identified by its content hash.";
export const BATCH_ID = /^\d{4}-\d{2}-\d{2}-[1-9]\d*$/;
const RECORD_PATH = /^(notes|pages)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/v[1-9]\d*\.json$/;
const HEX64 = /^[0-9a-f]{64}$/;

export const contentHash = (payload) => createHash("sha256").update(canonicalize(payload)).digest("hex");
const b64 = (s) => Uint8Array.from(Buffer.from(String(s), "base64"));

/** The payload of a new batch, records sorted by path. */
export function batchPayload(id, keyId, records) {
  return {
    kind: "countersignature",
    schema: SCHEMA,
    batch: id,
    signer: keyId,
    statement: STATEMENT,
    records: [...records].map(({ path, content_hash }) => ({ path, content_hash })).sort((a, b) => (a.path < b.path ? -1 : 1)),
  };
}

/**
 * Everything wrong with one batch, as [rule, detail] pairs; empty means it
 * holds. `lookup(path)` answers { content_hash } for a ledger record that
 * passes the offline checks, or { reason } when it does not.
 */
export async function countersignatureDivergences(record, { id, authorKeys, lookup }) {
  const out = [];
  const p = record?.payload ?? {};
  if (p.kind !== "countersignature" || p.schema !== SCHEMA) return [["kind", `expected a ${SCHEMA} countersignature`]];
  if (p.batch !== id || !BATCH_ID.test(id)) out.push(["batch", `payload names batch ${JSON.stringify(p.batch)}, filed as ${JSON.stringify(id)}`]);
  if (p.statement !== STATEMENT) out.push(["statement", "the attestation statement is not the fixed one"]);
  if (p.signer !== record.pubkey_id) out.push(["signer", "payload signer and pubkey_id disagree"]);
  const key = authorKeys.get(record.pubkey_id);
  if (!key) out.push(["key", `${JSON.stringify(record.pubkey_id)} is not an author key in the history`]);
  if (record.signature_format !== "sshsig") out.push(["format", "an author countersignature is an SSH signature"]);
  if (record.content_hash !== contentHash(p)) out.push(["hash", "content_hash does not recompute from the payload"]);
  if (key && record.signature_format === "sshsig") {
    const sig = await verifySshSig({ message: Buffer.from(canonicalize(p)), sig: record.signature, publicKey: b64(key.public_key_base64), namespace: SSHSIG_NAMESPACE });
    if (!sig.ok) out.push(["signature", sig.reason]);
  }
  const records = Array.isArray(p.records) ? p.records : [];
  if (records.length === 0) out.push(["records", "a batch lists at least one record"]);
  const paths = records.map((r) => r?.path);
  if (paths.some((x, i) => i > 0 && !(paths[i - 1] < x))) out.push(["records", "records are not sorted by path, or a path repeats"]);
  for (const r of records) {
    if (!RECORD_PATH.test(String(r?.path)) || !HEX64.test(String(r?.content_hash))) { out.push(["records", `malformed entry ${JSON.stringify(r)}`]); continue; }
    const found = lookup(r.path);
    if (found.reason) out.push(["records", `${r.path}: ${found.reason}`]);
    else if (found.content_hash !== r.content_hash) out.push(["records", `${r.path}: content hash differs from the ledger record`]);
  }
  return out;
}

/**
 * Everything wrong with an author key's history entry and its self-signed
 * fingerprint record. The anchor also names the publisher key's fingerprint,
 * so the author key's signature binds the two.
 */
export async function authorKeyDivergences(key, anchor, publisher) {
  const out = [];
  const raw = b64(key.public_key_base64);
  const fingerprint = createHash("sha256").update(raw).digest("hex");
  if (key.role !== "author") out.push(["role", "an author key carries role \"author\""]);
  if (raw.length !== 32 || fingerprint !== key.sha256_fingerprint) out.push(["fingerprint", "public key and fingerprint disagree"]);
  if (key.introduction?.type !== "author-key") out.push(["introduction", "an author key is introduced as type \"author-key\""]);
  const a = anchor?.payload ?? {};
  if (a.kind !== "key-fingerprint" || a.pubkey_id !== key.id || a.public_key_base64 !== key.public_key_base64 || a.sha256_fingerprint !== fingerprint || a.role !== "author") {
    out.push(["anchor", "the fingerprint record does not describe this key"]);
  }
  if (a.attests_publisher?.pubkey_id !== publisher.id || a.attests_publisher?.sha256_fingerprint !== publisher.sha256_fingerprint) {
    out.push(["binding", "the fingerprint record does not name the publisher key"]);
  }
  if (anchor?.pubkey_id !== key.id || anchor?.signature_format !== "sshsig") out.push(["anchor", "the fingerprint record is not signed by this key"]);
  if (anchor?.content_hash !== contentHash(a)) out.push(["anchor", "content_hash does not recompute"]);
  const sig = await verifySshSig({ message: Buffer.from(canonicalize(a)), sig: anchor?.signature, publicKey: raw });
  if (!sig.ok) out.push(["anchor", `signature: ${sig.reason}`]);
  return out;
}
