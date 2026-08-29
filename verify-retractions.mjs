#!/usr/bin/env node
// Verify every RETRACTION: the records that say an earlier record was false.
//
// A retraction is signed and Bitcoin-anchored like any other record, because the
// thing it corrects is. Publishing a mutable correction beside a permanent
// falsehood leaves the lie outliving its retraction, which is the asymmetry the
// whole arrangement exists to remove.
//
// The properties, in the order they matter:
//
//   1. THE RETRACTED RECORD IS STILL THERE. This is the one that would be
//      tempting to break. Retracting is not deleting: the original stays exactly
//      where it was published, because anyone who fetched it, cited it, or
//      compared against it must still be able to find what we actually said.
//      A retraction whose subject has vanished is an erasure with paperwork.
//   2. It names a record that WAS published. You cannot withdraw what was never
//      said, and a retraction naming a record nobody can fetch is itself a false
//      published claim — anchored as permanently as a true one.
//   3. Its own hash, signature and timestamp verify, under the key it names.
//   4. Its payload agrees with its path, so a retraction cannot be filed against
//      one record while pointing its evidence at another.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyRecord } from "./verify.mjs";
import { retractionDivergences } from "./retraction-checks.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const dir = join(root, "retractions");
const history = JSON.parse(readFileSync(join(root, "keys/key-history.json"), "utf8"));
const keyById = new Map(history.keys.map((k) => [k.id, k.public_key_base64]));

const subjects = existsSync(dir) ? readdirSync(dir).filter((d) => !d.startsWith(".")) : [];
let checked = 0;

for (const uid of subjects) {
  for (const file of readdirSync(join(dir, uid)).filter((f) => f.endsWith(".json"))) {
    const path = `retractions/${uid}/${file}`;
    const record = JSON.parse(readFileSync(join(dir, uid, file), "utf8"));
    const p = record.payload || {};

    // Shape, path agreement, subject-still-present and reason all live in
    // retraction-checks.mjs so they are exercised by vitest rather than only by
    // a corpus that is empty today. One implementation, two callers.
    const problems = retractionDivergences(record, {
      uid,
      file,
      exists: (rel) => existsSync(join(root, rel)),
      publishedKeyIds: [...keyById.keys()],
    });
    if (problems.length) {
      throw new Error(`${path}: ` + problems.map(([k, d]) => `${k}: ${d}`).join("; "));
    }

    // (3) cryptography, under the key the retraction NAMES
    const pubB64 = keyById.get(record.pubkey_id);
    const otsPath = join(dir, uid, file.replace(/\.json$/, ".ots"));
    if (!existsSync(otsPath)) throw new Error(`${path}: no .ots timestamp`);
    const verified = await verifyRecord({
      record,
      pubB64,
      otsBytes: new Uint8Array(readFileSync(otsPath)),
    });
    if (!verified.hashOk) throw new Error(`${path}: content_hash does not match the payload`);
    if (!verified.sigOk) throw new Error(`${path}: signature does not verify`);
    if (!verified.otsHashOk) throw new Error(`${path}: the timestamp is over different bytes`);

    checked++;
  }
}

console.log(`verify-retractions: ${checked} retraction(s) verified across ${subjects.length} subject(s).`);
