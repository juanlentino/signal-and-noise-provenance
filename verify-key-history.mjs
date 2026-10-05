#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize } from "./normalize/canonical-json.mjs";
import { verifyRecord } from "./verify.mjs";
import { authorKeyDivergences } from "./countersign-checks.mjs";
import { pendingProblem } from "./countersign-ledger.mjs";
import { bitcoinAttestation, stampedDigest, toHex } from "./verify/ots.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const history = JSON.parse(readFileSync(join(root, "keys/key-history.json"), "utf8"));
const byId = new Map(history.keys.map((key) => [key.id, key]));
if (!byId.has(history.trust_root) || !byId.has(history.current)) throw new Error("history root/current is not declared");

// An author key (role "author") is the author's own SSH key. It never
// becomes current: the publisher key keeps signing at publish, and the author
// key countersigns. Its fingerprint record is SSH-signed, so it is checked by
// countersign-checks.mjs instead of verifyRecord's raw Ed25519 path.
const publishers = history.keys.filter((k) => k.role !== "author");
let authorKeys = 0;
for (const key of history.keys.filter((k) => k.role === "author")) {
  if (key.id === history.current || key.id === history.trust_root) throw new Error(`an author key cannot be current or the trust root: ${key.id}`);
  const published = readFileSync(join(root, `keys/${key.id}.pub`), "utf8").trim();
  if (published !== key.public_key_base64) throw new Error(`published key mismatch: ${key.id}`);
  const anchorPath = key.introduction?.bitcoin_anchor;
  if (anchorPath !== `keys/anchors/${key.id}.json`) throw new Error(`missing author-key fingerprint record: ${key.id}`);
  const anchor = JSON.parse(readFileSync(join(root, anchorPath), "utf8"));
  // The publisher an anchor names when it was signed, not whichever key is
  // current now: a later publisher rotation leaves it true.
  const publisher = publishers.find((k) => k.id === anchor.payload?.attests_publisher?.pubkey_id);
  if (!publisher) throw new Error(`author key ${key.id}: its fingerprint record names no publisher key in the history`);
  const problems = await authorKeyDivergences(key, anchor, publisher, publishers);
  if (problems.length) throw new Error(`author key ${key.id}: ${problems.map(([k, d]) => `${k}: ${d}`).join("; ")}`);
  const otsPath = join(root, anchorPath.replace(/\.json$/, ".ots"));
  if (existsSync(otsPath)) {
    const ots = new Uint8Array(readFileSync(otsPath));
    if (toHex(stampedDigest(ots)) !== anchor.content_hash) throw new Error(`author-key anchor proof commits to another digest: ${key.id}`);
    const btc = await bitcoinAttestation(ots, anchor.ots?.bitcoin_block ?? null);
    if (anchor.ots?.status === "confirmed" && (!btc || btc.height !== anchor.ots.bitcoin_block)) throw new Error(`confirmed author-key anchor has no matching Bitcoin attestation: ${key.id}`);
  } else if (anchor.ots?.status === "confirmed") {
    throw new Error(`author-key anchor says confirmed but has no proof: ${key.id}`);
  }
  const waiting = pendingProblem(root, anchor, anchorPath.replace(/\.json$/, ""));
  if (waiting) throw new Error(`author-key anchor ${key.id}: ${waiting}`);
  authorKeys += 1;
}

for (const key of history.keys.filter((k) => k.role !== "author")) {
  const published = readFileSync(join(root, `keys/${key.id}.pub`), "utf8").trim();
  if (published !== key.public_key_base64) throw new Error(`published key mismatch: ${key.id}`);
  const fingerprint = createHash("sha256").update(Buffer.from(published, "base64")).digest("hex");
  if (fingerprint !== key.sha256_fingerprint) throw new Error(`fingerprint mismatch: ${key.id}`);

  const anchorPath = key.introduction?.bitcoin_anchor;
  if (typeof anchorPath !== "string" || !anchorPath.startsWith("keys/anchors/") || !anchorPath.endsWith(".json")) {
    throw new Error(`missing key-fingerprint anchor: ${key.id}`);
  }
  const anchor = JSON.parse(readFileSync(join(root, anchorPath), "utf8"));
  const anchorOts = new Uint8Array(readFileSync(join(root, anchorPath.replace(/\.json$/, ".ots"))));
  const verified = await verifyRecord({ record: anchor, pubB64: published, otsBytes: anchorOts });
  if (!verified.hashOk || !verified.sigOk || !verified.otsHashOk) throw new Error(`invalid key-fingerprint anchor: ${key.id}`);
  if (anchor.pubkey_id !== key.id
    || anchor.payload?.kind !== "key-fingerprint"
    || anchor.payload?.pubkey_id !== key.id
    || anchor.payload?.public_key_base64 !== published
    || anchor.payload?.sha256_fingerprint !== fingerprint) {
    throw new Error(`key-fingerprint anchor payload mismatch: ${key.id}`);
  }
  if (anchor.ots?.status === "confirmed" && !verified.btc) throw new Error(`confirmed key anchor has no Bitcoin attestation: ${key.id}`);
}

for (const transition of history.transitions) {
  const prior = byId.get(transition.signed_by);
  const next = byId.get(transition.introduces);
  if (!prior || !next) throw new Error("transition references an unknown key");
  if (prior.role === "author" || next.role === "author") throw new Error(`an author key takes no part in publisher transitions: ${prior.id} -> ${next.id}`);
  const message = new TextEncoder().encode(canonicalize(transition.statement));
  const publicKey = await crypto.subtle.importKey("raw", Buffer.from(prior.public_key_base64, "base64"), { name: "Ed25519" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("Ed25519", publicKey, Buffer.from(transition.signature, "base64"), message);
  if (!ok) throw new Error(`invalid key transition: ${prior.id} -> ${next.id}`);
}

console.log(`${history.keys.length - authorKeys} key generation(s), ${history.transitions.length} signed transition(s); current ${history.current}; ${authorKeys} author key(s)`);
