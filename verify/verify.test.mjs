// Verifies verify.mjs against a REAL confirmed record already in this repo:
// Note a0f8393c v1, anchored in Bitcoin block 957,333. Offline — the only
// networked step (the block-header lookup) is injected.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { bitcoinAttestation } from "./ots.mjs";
import { verifyRecord, confirmBitcoin } from "../verify.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const UID  = "a0f8393c-9804-4780-9e77-f2d4f6b7d1ff";
const dir  = join(root, "notes", UID);

const record   = JSON.parse(readFileSync(join(dir, "v1.json"), "utf8"));
const otsBytes = new Uint8Array(readFileSync(join(dir, "v1.ots")));
const pubB64   = readFileSync(join(root, "keys", `${record.pubkey_id}.pub`), "utf8");

// Ground truth (Blockstream): block 957,333 merkle root.
const BLOCK  = 957333;
const MERKLE = "73d8e60edd6ff1aa1ff27bc86138b4f1127556e71552c3d180181cef4614d156";

describe("bitcoinAttestation (OTS reader)", () => {
  it("reads the committed block height and display merkle root", async () => {
    const btc = await bitcoinAttestation(otsBytes);
    expect(btc.height).toBe(BLOCK);
    expect(btc.merkleRoot).toBe(MERKLE); // internal LE reversed to explorer display order
  });
});

describe("verifyRecord (offline hash + signature)", () => {
  it("reproduces the canonical hash and verifies the Ed25519 signature", async () => {
    const r = await verifyRecord({ record, pubB64, otsBytes });
    expect(r.hashOk).toBe(true);
    expect(r.sigOk).toBe(true);
    expect(r.recomputed).toBe(record.content_hash);
    expect(r.btc.height).toBe(BLOCK);
  });

  it("rejects a tampered payload (hash no longer matches, signature invalid)", async () => {
    const tampered = { ...record, payload: { ...record.payload, title: record.payload.title + " (edited)" } };
    const r = await verifyRecord({ record: tampered, pubB64, otsBytes });
    expect(r.hashOk).toBe(false);
    expect(r.sigOk).toBe(false);
  });
});

describe("confirmBitcoin (merkle root vs the real block)", () => {
  it("passes when the explorer's merkle root matches the OTS commitment", async () => {
    const btc = await bitcoinAttestation(otsBytes);
    const res = await confirmBitcoin(btc, async () => MERKLE);
    expect(res.ok).toBe(true);
    expect(res.height).toBe(BLOCK);
  });

  it("fails on a merkle-root mismatch (proof doesn't commit to that block)", async () => {
    const btc = await bitcoinAttestation(otsBytes);
    const res = await confirmBitcoin(btc, async () => "00".repeat(32));
    expect(res.ok).toBe(false);
  });

  it("reports pending when the proof carries no Bitcoin attestation", async () => {
    const res = await confirmBitcoin(null, async () => MERKLE);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/pending|awaiting/i);
  });
});
