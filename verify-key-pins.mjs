#!/usr/bin/env node
import { resolveTxt } from "node:dns/promises";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { captureEvidence, fetchSite, installEvidenceReport } from "./fetch-site.mjs";
installEvidenceReport("verify:key-pins");

const root = dirname(fileURLToPath(import.meta.url));
const history = JSON.parse(readFileSync(join(root, "keys/key-history.json"), "utf8"));
const current = history.keys.find((key) => key.id === history.current);
if (!current) throw new Error("current key is absent from key history");

const expectedTxt = `v=sn-prov1; id=${current.id}; alg=${current.algorithm}; key=${current.public_key_base64}; sha256=${current.sha256_fingerprint}`;
const txtAnswers = (await resolveTxt("_provenance.juanlentino.com")).map((chunks) => chunks.join(""));
if (txtAnswers.length !== 1 || txtAnswers[0] !== expectedTxt) {
  throw new Error(`DNS key pin mismatch: ${JSON.stringify(txtAnswers)}`);
}

// Named UA + Accept + bounded retry originated here (2026-07-29), after the
// edge answered a bare default-UA fetch from a GitHub runner with HTTP 415.
// That fix stayed local to this file; on 2026-08-02 the same edge behaviour
// resurfaced as a 200 carrying HTML on an unhardened leg. The pattern now
// lives in fetch-site.mjs so every leg gets it — including the payload-shape
// assertion the original lacked.
const { body: document, raw } = await fetchSite("https://juanlentino.com/.well-known/provenance-keys.json", { expect: "json" });
// An 8-way `||` throwing one opaque string told you a mismatch existed but not
// WHICH field or what arrived — so when a runner hit this on 2026-08-03 while
// the same document verified perfectly from a residential IP, the log could not
// say whether the mirror was wrong or the edge had served something else.
// Compare field by field and report the divergence with the bytes kept.
const mirrored = document?.keys?.find((key) => key.id === current.id);
const divergences = [
  ["schema", document?.schema, "sn-provenance-keys-v1"],
  ["domain", document?.domain, "juanlentino.com"],
  [`keys[id=${current.id}]`, mirrored ? "present" : "ABSENT", "present"],
  ...(mirrored ? [
    ["algorithm", mirrored.algorithm, current.algorithm],
    ["public_key_base64", mirrored.public_key_base64, current.public_key_base64],
    ["sha256_fingerprint", mirrored.sha256_fingerprint, current.sha256_fingerprint],
    ["status", mirrored.status, current.status],
    ["introduced_at", mirrored.introduced_at, current.introduced_at],
  ] : []),
].filter(([, actual, expected]) => actual !== expected);

if (divergences.length) {
  captureEvidence("key-mirror-mismatch", "provenance-keys.json", raw, "json");
  const detail = divergences.map(([field, actual, expected]) => `${field}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`).join("; ");
  throw new Error(`HTTPS key mirror does not match key history — ${detail}. Document had keys [${Object.keys(document ?? {}).join(",")}], ${raw.length} bytes.`);
}

console.log(`DNS and HTTPS key pins agree on ${current.id} (${current.sha256_fingerprint})`);
