#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize } from "./normalize/canonical-json.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const history = JSON.parse(readFileSync(join(root, "keys/key-history.json"), "utf8"));
const byId = new Map(history.keys.map((key) => [key.id, key]));
if (!byId.has(history.trust_root) || !byId.has(history.current)) throw new Error("history root/current is not declared");

for (const key of history.keys) {
  const published = readFileSync(join(root, `keys/${key.id}.pub`), "utf8").trim();
  if (published !== key.public_key_base64) throw new Error(`published key mismatch: ${key.id}`);
  const fingerprint = createHash("sha256").update(Buffer.from(published, "base64")).digest("hex");
  if (fingerprint !== key.sha256_fingerprint) throw new Error(`fingerprint mismatch: ${key.id}`);
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
