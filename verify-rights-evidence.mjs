#!/usr/bin/env node
// Verify the rights-evidence ledger: one record per crawler family per month,
// composed by the site from its edge sensor (plugin 17.0.0), signed and
// anchored through the ordinary webhook (worker 1.21.0). The envelope is a
// Note's (hash and signature over canonical(payload)), so verifyRecord()
// applies; the CLAIM is checked by rights-evidence-checks.mjs.
//
// DELIBERATELY OFFLINE, like verify:rights-signals: a record says "in this
// month this family read these files this many times", which nothing served
// today can confirm or refute. Internal soundness only.
//
// An absent directory is not a failure: the first record lands on the first
// pass after a month closes, and this script runs hourly before that.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyRecord } from "./verify.mjs";
import { contiguousFromV1, recordVersions } from "./ledger-records.mjs";
import { evidenceDivergences } from "./rights-evidence-checks.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const evidenceRoot = join(root, "rights-evidence");
const SITE_HOST = "juanlentino.com";

if (!existsSync(evidenceRoot)) {
  console.log("0 rights-evidence records (no rights-evidence/ directory yet)");
  process.exit(0);
}

const uids = readdirSync(evidenceRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
let checked = 0;
const months = new Map();

for (const uid of uids) {
  const versions = recordVersions(evidenceRoot, uid);
  if (!contiguousFromV1(versions)) throw new Error(`rights-evidence versions are not contiguous from v1 for ${uid}: ${versions.map((v) => `v${v}`).join(",") || "none"}`);
  for (const version of versions) {
    const base = join(evidenceRoot, uid, `v${version}`);
    for (const ext of ["json", "ots"]) {
      if (!existsSync(`${base}.${ext}`)) throw new Error(`rights-evidence ${uid} v${version} is missing its .${ext}`);
    }
    const record = JSON.parse(readFileSync(`${base}.json`, "utf8"));
    const otsBytes = new Uint8Array(readFileSync(`${base}.ots`));
    const pubPath = join(root, "keys", `${record.pubkey_id}.pub`);
    if (!existsSync(pubPath)) throw new Error(`rights-evidence ${uid} v${version} names unpublished key ${record.pubkey_id}`);
    const { hashOk, sigOk, otsHashOk, btc } = await verifyRecord({ record, pubB64: readFileSync(pubPath, "utf8"), otsBytes });
    if (!hashOk) throw new Error(`rights-evidence hash mismatch for ${uid} v${version}`);
    if (!sigOk) throw new Error(`rights-evidence signature does not verify for ${uid} v${version} under ${record.pubkey_id}`);
    if (!otsHashOk) throw new Error(`rights-evidence OTS proof does not commit to the content hash for ${uid} v${version}`);
    if (record.ots?.status === "confirmed" && (!btc || btc.height !== record.ots.bitcoin_block)) {
      throw new Error(`rights-evidence confirmed OTS block mismatch for ${uid} v${version}: proof attests height ${btc?.height ?? "none"}, record says ${record.ots.bitcoin_block}`);
    }
    const problems = await evidenceDivergences(record, { uid, version, host: SITE_HOST });
    if (problems.length) throw new Error(`rights-evidence ${uid} v${version}: ${problems.map(([k, d]) => `${k}: ${d}`).join("; ")}`);
    const key = `${record.payload.month}:${record.payload.family}`;
    if (months.has(key)) throw new Error(`rights-evidence ${uid} repeats ${key}, already filed under ${months.get(key)}`);
    months.set(key, uid);
    checked += 1;
  }
}

console.log(`${checked}/${checked} rights-evidence records (${[...months.keys()].sort().join(", ") || "none"}) pass offline hash, signature, OTS-digest and claim verification`);
