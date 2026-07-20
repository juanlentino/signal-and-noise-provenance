#!/usr/bin/env node
import { resolveTxt } from "node:dns/promises";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const history = JSON.parse(readFileSync(join(root, "keys/key-history.json"), "utf8"));
const current = history.keys.find((key) => key.id === history.current);
if (!current) throw new Error("current key is absent from key history");

const expectedTxt = `v=sn-prov1; id=${current.id}; alg=${current.algorithm}; key=${current.public_key_base64}; sha256=${current.sha256_fingerprint}`;
const txtAnswers = (await resolveTxt("_provenance.juanlentino.com")).map((chunks) => chunks.join(""));
if (txtAnswers.length !== 1 || txtAnswers[0] !== expectedTxt) {
  throw new Error(`DNS key pin mismatch: ${JSON.stringify(txtAnswers)}`);
}

const response = await fetch("https://juanlentino.com/.well-known/provenance-keys.json");
if (!response.ok) throw new Error(`HTTPS key mirror failed: HTTP ${response.status}`);
const document = await response.json();
const mirrored = document?.keys?.find((key) => key.id === current.id);
if (document?.schema !== "sn-provenance-keys-v1"
  || document?.domain !== "juanlentino.com"
  || !mirrored
  || mirrored.algorithm !== current.algorithm
  || mirrored.public_key_base64 !== current.public_key_base64
  || mirrored.sha256_fingerprint !== current.sha256_fingerprint
  || mirrored.status !== current.status
  || mirrored.introduced_at !== current.introduced_at) {
  throw new Error("HTTPS key mirror does not match key history");
}

console.log(`DNS and HTTPS key pins agree on ${current.id} (${current.sha256_fingerprint})`);
