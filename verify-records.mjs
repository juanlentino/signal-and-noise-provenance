#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyRecord } from "./verify.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const index = JSON.parse(readFileSync(join(root, "index.json"), "utf8"));
let checked = 0;

for (const entry of index.entries) {
  if (!Number.isInteger(entry.version) || entry.version < 1) throw new Error(`standalone version missing for ${entry.slug}`);
  const base = join(root, "notes", entry.note_uid, `v${entry.version}`);
  const record = JSON.parse(readFileSync(`${base}.json`, "utf8"));
  const otsBytes = new Uint8Array(readFileSync(`${base}.ots`));
  const pubB64 = readFileSync(join(root, "keys", `${record.pubkey_id}.pub`), "utf8");
  const result = await verifyRecord({ record, pubB64, otsBytes });
  if (!result.hashOk || !result.sigOk || !result.otsHashOk) {
    throw new Error(`offline record verification failed for ${entry.slug} (hash=${result.hashOk}, signature=${result.sigOk}, otsDigest=${result.otsHashOk})`);
  }
  if (record.ots?.status === "confirmed"
    && (!result.btc || result.btc.height !== record.ots.bitcoin_block)) {
    throw new Error(`confirmed OTS block mismatch for ${entry.slug}`);
  }
  checked += 1;
}

console.log(`${checked}/${checked} note records pass offline hash, signature, and OTS-digest verification`);
