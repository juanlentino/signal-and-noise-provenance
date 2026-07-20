#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize } from "./normalize/canonical-json.mjs";
import { verifyRecord } from "./verify.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const history = JSON.parse(readFileSync(join(root, "keys/key-history.json"), "utf8"));
const byId = new Map(history.keys.map((key) => [key.id, key]));
if (!byId.has(history.trust_root) || !byId.has(history.current)) throw new Error("history root/current is not declared");

for (const key of history.keys) {
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
  if (!verified.hashOk || !verified.sigOk) throw new Error(`invalid key-fingerprint anchor: ${key.id}`);
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
  const message = new TextEncoder().encode(canonicalize(transition.statement));
  const publicKey = await crypto.subtle.importKey("raw", Buffer.from(prior.public_key_base64, "base64"), { name: "Ed25519" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("Ed25519", publicKey, Buffer.from(transition.signature, "base64"), message);
  if (!ok) throw new Error(`invalid key transition: ${prior.id} -> ${next.id}`);
}

console.log(`${history.keys.length} key generation(s), ${history.transitions.length} signed transition(s); current ${history.current}`);
