#!/usr/bin/env node
// Verify the rights-signals ledger — the second ledger in this repo, and until
// 2026-08-04 the one nothing checked.
//
// Four machine-readable rights surfaces (robots.txt, the RSL licence XML, the
// TDM reservation policy, the TDMRep JSON) are captured, hashed, signed with
// the SAME production key as the Notes, and anchored in Bitcoin — five records
// across four surfaces, one of which (robots-txt) already had a v2. None of it
// appeared in any verify:* script or workflow step. A signed public claim that
// nothing re-checks is a claim nobody would notice breaking.
//
// The record shape differs from a Note's and the difference is the point:
//
//   Note           content_hash = SHA-256(canonical JSON of payload)
//                  signature    over those same canonical bytes
//                  payload.parent chains v1 → v2 → …
//
//   Rights signal  content_hash = SHA-256(the served file's RAW BYTES)
//                  signature    over those same raw bytes
//                  no chain — each record is an independent dated snapshot,
//                  and vN.raw is the captured file itself
//
// So this cannot reuse verifyRecord(); it recomputes over vN.raw directly.
//
// DELIBERATELY OFFLINE — this checks the LEDGER, not the live site.
// A Note's record claims "this IS the Note's content", so verify:pages holds
// the served page to it. A rights-signal record claims "on this date the
// surface served these bytes", which a later edit does not falsify. The worker
// re-anchors hourly on change, so a live comparison would red CI for the gap
// between an edit and the next sweep — turning worker latency into a ledger
// integrity failure. Freshness belongs in the worker's monitoring; this script
// answers only "is every anchored claim internally sound and well-formed?"

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bitcoinAttestation, stampedDigest, toHex } from "./verify/ots.mjs";
import { contiguousFromV1, recordVersions } from "./ledger-records.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const signalsRoot = join(root, "rights-signals");
const b64 = (s) => Uint8Array.from(Buffer.from(String(s).trim(), "base64"));
const sha256Hex = async (bytes) => toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));

// This script discovers its own scope by listing the ledger, so a surface that
// DISAPPEARS is invisible to it: drop a directory and it reports "4/4 across 3
// surfaces" and stays green. Verified by deleting one — it did exactly that.
// A floor is the only thing that can notice, so it is pinned here, to the
// writer's own list (sn-provenance-worker, src/rights-signals.mjs
// RIGHTS_SIGNALS). Additive by design: a FIFTH surface is picked up and fully
// verified by the loop below without appearing here, but none of these four may
// vanish silently.
const REQUIRED_SURFACES = ["license-xml", "robots-txt", "tdm-policy", "tdmrep-json"];
// Records keep the URL that was captured, and a surface may legitimately move
// (a path change makes old records carry the old path), so the PATH is not
// pinned — only the host, which catches a record attesting to somewhere else
// entirely while everything else about it verifies.
const SIGNAL_HOST = "juanlentino.com";

const slugs = readdirSync(signalsRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
if (!slugs.length) throw new Error("no rights-signal directories found — the ledger cannot be empty");
const missingSurfaces = REQUIRED_SURFACES.filter((slug) => !slugs.includes(slug));
if (missingSurfaces.length) throw new Error(`rights-signal surfaces missing from the ledger: ${missingSurfaces.join(", ")} (found: ${slugs.join(", ") || "none"})`);

let checked = 0;

for (const slug of slugs) {
  const versions = recordVersions(signalsRoot, slug);
  if (!contiguousFromV1(versions)) throw new Error(`rights-signal versions are not contiguous from v1 for ${slug}: ${versions.map((v) => `v${v}`).join(",") || "none"}`);

  let previousHash = null;
  for (const version of versions) {
    const base = join(signalsRoot, slug, `v${version}`);
    // The .raw capture is what the hash and the signature are OVER. Without it
    // a record is unverifiable rather than merely unverified, so its absence is
    // a hard failure, not a skip.
    for (const ext of ["json", "ots", "raw"]) {
      if (!existsSync(`${base}.${ext}`)) throw new Error(`rights-signal ${slug} v${version} is missing its .${ext}`);
    }
    const record = JSON.parse(readFileSync(`${base}.json`, "utf8"));
    const raw = new Uint8Array(readFileSync(`${base}.raw`));
    const otsBytes = new Uint8Array(readFileSync(`${base}.ots`));

    // A record filed under the wrong surface would otherwise verify perfectly
    // while attesting to the wrong thing.
    if (record.slug !== slug) throw new Error(`rights-signal ${slug} v${version} declares slug ${JSON.stringify(record.slug)}`);
    const url = URL.canParse(record.url ?? "") ? new URL(record.url) : null;
    if (!url || "https:" !== url.protocol || url.hostname !== SIGNAL_HOST) {
      throw new Error(`rights-signal ${slug} v${version} attests to ${JSON.stringify(record.url ?? null)}, which is not an https URL on ${SIGNAL_HOST}`);
    }

    const recomputed = await sha256Hex(raw);
    if (recomputed !== record.content_hash) throw new Error(`rights-signal hash mismatch for ${slug} v${version}: .raw hashes to ${recomputed}, record says ${record.content_hash}`);

    const pubPath = join(root, "keys", `${record.pubkey_id}.pub`);
    if (!existsSync(pubPath)) throw new Error(`rights-signal ${slug} v${version} names unpublished key ${record.pubkey_id}`);
    const key = await crypto.subtle.importKey("raw", b64(readFileSync(pubPath, "utf8")), { name: "Ed25519" }, false, ["verify"]);
    if (!await crypto.subtle.verify({ name: "Ed25519" }, key, b64(record.signature), raw)) {
      throw new Error(`rights-signal signature does not verify for ${slug} v${version} under ${record.pubkey_id}`);
    }

    if (toHex(stampedDigest(otsBytes)) !== record.content_hash) throw new Error(`rights-signal OTS proof does not commit to the content hash for ${slug} v${version}`);
    if (record.ots?.status === "confirmed") {
      const btc = await bitcoinAttestation(otsBytes);
      if (!btc || btc.height !== record.ots.bitcoin_block) {
        throw new Error(`rights-signal confirmed OTS block mismatch for ${slug} v${version}: proof attests height ${btc?.height ?? "none"}, record says ${record.ots.bitcoin_block}`);
      }
    }

    // The writer appends only when the bytes CHANGED (it compares the new hash
    // against the current record and returns early otherwise). Two consecutive
    // identical hashes therefore mean that dedup did not hold — a version was
    // burned, and a Bitcoin anchor spent, on a surface that never changed.
    if (previousHash === record.content_hash) throw new Error(`rights-signal ${slug} v${version} repeats the content hash of v${version - 1} — an unchanged surface must not be re-anchored`);
    previousHash = record.content_hash;
    checked += 1;
  }
}

console.log(`${checked}/${checked} rights-signal records across ${slugs.length} surfaces (${slugs.join(", ")}) pass offline hash, signature, OTS-digest, and append-order verification`);
