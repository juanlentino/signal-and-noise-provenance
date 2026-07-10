#!/usr/bin/env node
// One-command provenance verifier — trust nothing. Recompute the content hash,
// verify the Ed25519 signature under the PUBLISHED key, and confirm the
// OpenTimestamps proof commits to a REAL Bitcoin block whose merkle root matches
// a public block explorer. No OTS CLI, no WordPress, no trust in this repo.
//
//   node verify.mjs <note_uid> [version]
//
// Everything but the final block-header lookup is offline.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { canonicalize } from "./normalize/canonical-json.mjs";
import { bitcoinAttestation, toHex } from "./verify/ots.mjs";

const b64 = (s) => Uint8Array.from(Buffer.from(String(s).trim(), "base64"));

/**
 * Offline half: recompute the content hash from `payload` and verify the Ed25519
 * signature under the given public key. `btc` is the block the proof claims
 * ({ height, merkleRoot }) or null when still pending.
 *
 * @returns {Promise<{hashOk:boolean, sigOk:boolean, recomputed:string, btc:object|null}>}
 */
export async function verifyRecord({ record, pubB64, otsBytes }) {
  const canonical   = new TextEncoder().encode(canonicalize(record.payload));
  const recomputed  = toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", canonical)));
  const hashOk      = recomputed === record.content_hash;
  const key         = await crypto.subtle.importKey("raw", b64(pubB64), { name: "Ed25519" }, false, ["verify"]);
  const sigOk       = await crypto.subtle.verify({ name: "Ed25519" }, key, b64(record.signature), canonical);
  const btc         = await bitcoinAttestation(otsBytes);
  return { hashOk, sigOk, recomputed, btc };
}

/**
 * Confirm the OTS-committed merkle root matches the real block at that height.
 * `fetchBlockMerkleRoot(height) => Promise<hex>` is injectable for tests.
 */
export async function confirmBitcoin(btc, fetchBlockMerkleRoot) {
  if (!btc) return { ok: false, reason: "no Bitcoin attestation yet (still awaiting confirmation)" };
  const actual = await fetchBlockMerkleRoot(btc.height);
  return { ok: actual === btc.merkleRoot, height: btc.height, expected: btc.merkleRoot, actual };
}

async function esploraMerkleRoot(height, base = "https://blockstream.info/api") {
  const hash = (await (await fetch(`${base}/block-height/${height}`)).text()).trim();
  const blk  = await (await fetch(`${base}/block/${hash}`)).json();
  return blk.merkle_root;
}

async function main() {
  const [uid, version = "1"] = process.argv.slice(2);
  if (!uid) { console.error("usage: node verify.mjs <note_uid> [version]"); process.exit(2); }
  const here     = dirname(fileURLToPath(import.meta.url));
  const dir      = join(here, "notes", uid);
  const record   = JSON.parse(readFileSync(join(dir, `v${version}.json`), "utf8"));
  const otsBytes = new Uint8Array(readFileSync(join(dir, `v${version}.ots`)));
  const pubB64   = readFileSync(join(here, "keys", `${record.pubkey_id}.pub`), "utf8");

  const { hashOk, sigOk, recomputed, btc } = await verifyRecord({ record, pubB64, otsBytes });
  const bc = await confirmBitcoin(btc, esploraMerkleRoot);

  console.log(`Note ${uid} v${version} — ${JSON.stringify(record.payload.title)}`);
  console.log(`  published_at:  ${record.payload.published_at}`);
  console.log(`  key:           ${record.pubkey_id}`);
  console.log(`  1) content hash  ${hashOk ? "✓ matches (canonical reproduced independently)" : "✗ MISMATCH → " + recomputed}`);
  console.log(`  2) signature     ${sigOk ? "✓ valid Ed25519 under the published key" : "✗ INVALID"}`);
  console.log(`  3) bitcoin       ${bc.ok ? `✓ merkle root matches block ${bc.height} on-chain` : "✗ " + (bc.reason || `merkle mismatch at block ${bc.height}`)}`);
  const ok = hashOk && sigOk && bc.ok;
  console.log(`\n${ok ? "VERIFIED — authentic, unmodified, and anchored in Bitcoin." : "NOT fully verified."}`);
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error("verify error:", e.message); process.exit(2); });
}
