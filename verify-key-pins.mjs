#!/usr/bin/env node
import { resolveTxt } from "node:dns/promises";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { captureEvidence, fetchSite, installEvidenceReport } from "./fetch-site.mjs";
import { keyPinDivergences } from "./key-pins.mjs";
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
// The comparison itself lives in key-pins.mjs so it can be tested without DNS
// or a network fetch — see verify/key-pins.test.mjs. It was inline and
// untestable here until 2026-08-11, which is precisely why a schema bump on the
// producing side sat unnoticed until it reached the live mirror.
const divergences = keyPinDivergences(document, current);

if (divergences.length) {
  captureEvidence("key-mirror-mismatch", "provenance-keys.json", raw, "json");
  const detail = divergences.map(([field, actual, expected]) => `${field}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`).join("; ");
  throw new Error(`HTTPS key mirror does not match key history — ${detail}. Document had keys [${Object.keys(document ?? {}).join(",")}], ${raw.length} bytes.`);
}

console.log(`DNS and HTTPS key pins agree on ${current.id} (${current.sha256_fingerprint})`);
