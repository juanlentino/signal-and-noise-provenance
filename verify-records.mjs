#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyRecord } from "./verify.mjs";
import { contiguousFromV1, expectedParent, recordVersions } from "./ledger-records.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const notesRoot = join(root, "notes");
const index = JSON.parse(readFileSync(join(root, "index.json"), "utf8"));
const genesisRecord = JSON.parse(readFileSync(join(root, "genesis/2026-07-09-root.json"), "utf8"));
const genesisLeaf = new Map(genesisRecord.payload.notes.map((note) => [note.note_uid, note.leaf_hash]));
let checked = 0;

// The commit chain (genesis leaf → v1 → v2 → …) is what makes an EDIT
// auditable rather than merely recorded, and it went unverified until a Note
// was first edited (start-here, 2026-08-04). The rule itself lives in
// ledger-records.mjs, where it is unit-tested.
for (const entry of index.entries) {
  if (!Number.isInteger(entry.version) || entry.version < 1) throw new Error(`standalone version missing for ${entry.slug}`);
  // Every version, not just the indexed one. The index names the CURRENT
  // record; a superseded one is still a signed, publicly anchored claim and
  // stays verifiable forever. Checking only entry.version would have silently
  // dropped v1 from verification the moment a Note was edited.
  const versions = recordVersions(notesRoot, entry.note_uid);
  if (!versions.includes(entry.version)) throw new Error(`indexed record missing on disk for ${entry.slug} (index says v${entry.version}, on disk: ${versions.map((v) => `v${v}`).join(",") || "none"})`);
  if (!contiguousFromV1(versions)) throw new Error(`record versions are not contiguous from v1 for ${entry.slug}: ${versions.map((v) => `v${v}`).join(",")}`);

  let previous = null;
  for (const version of versions) {
    const base = join(notesRoot, entry.note_uid, `v${version}`);
    const record = JSON.parse(readFileSync(`${base}.json`, "utf8"));
    const otsBytes = new Uint8Array(readFileSync(`${base}.ots`));
    const pubB64 = readFileSync(join(root, "keys", `${record.pubkey_id}.pub`), "utf8");
    const result = await verifyRecord({ record, pubB64, otsBytes });
    if (!result.hashOk || !result.sigOk || !result.otsHashOk) {
      throw new Error(`offline record verification failed for ${entry.slug} v${version} (hash=${result.hashOk}, signature=${result.sigOk}, otsDigest=${result.otsHashOk})`);
    }
    if (record.payload.version !== version) throw new Error(`record filename disagrees with its payload for ${entry.slug}: v${version}.json declares version ${record.payload.version}`);
    const parent = expectedParent({
      version,
      genesisLeaf: genesisLeaf.get(entry.note_uid) ?? null,
      previousContentHash: previous?.content_hash ?? null,
    });
    if ((record.payload.parent ?? null) !== parent) {
      throw new Error(`broken commit chain for ${entry.slug} v${version}: record names parent ${JSON.stringify(record.payload.parent ?? null)}, expected ${JSON.stringify(parent)}`);
    }
    if (record.ots?.status === "confirmed"
      && (!result.btc || result.btc.height !== record.ots.bitcoin_block)) {
      throw new Error(`confirmed OTS block mismatch for ${entry.slug} v${version}`);
    }
    previous = record;
    checked += 1;
  }
}

console.log(`${checked}/${checked} note records across ${index.entries.length} notes pass offline hash, signature, OTS-digest, and commit-chain verification`);
