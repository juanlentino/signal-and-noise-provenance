# Public provenance hardening session — 2026-07-20

## Scope and invariants

This session changed only the public JuanLentino.com provenance track. ReverBeat
and all published Note content were out of scope and untouched. The original six
confirmed per-note JSON/OTS pairs did not change. The controlled genesis
migration changed only the JSON `signature` value; its payload, Merkle root,
`content_hash`, and OTS bytes remain the original 2026-07-09 evidence.

- Genesis root/content hash:
  `cca0dfa924b4bd694c762f902c61c70340b94e302a2f0ad3bb7e42f56d1f2ef9`
- Genesis JSON SHA-256 before/after controlled re-sign:
  `9046f42387dc3086bb78dc637ce6e654f07819513477c8af0210653b3c1c5ae1` /
  `569f4668ae869a2691238e16dbbe23cd6e3e2322e4a85b21519a91d04a7997b7`
- Genesis OTS SHA-256, unchanged:
  `19b4ce9d6f695ab2c238f70285ddd00c4183667339db95f4939e86a5f534a160`
- Existing-vs-new diff from ledger commit `782603ad`: one genesis signature
  modification and 18 newly added `notes/<uid>/v1.{json,ots}` pairs; no existing
  per-note path was modified.

## Delivered

- Public served-page extraction and `verify.mjs --from-page`, including strict
  generated-TOC removal and a fail-closed public-REST fallback for whitespace
  erased from inline SVGs by the page cache.
- Recursive sorted-key compact canonical JSON across ledger JS, plugin PHP, and
  the signing Worker. Genesis now verifies under that rule while retaining its
  explicit Merkle-root hash convention.
- Exact public genesis reconstruction: all 21 v0 derivations, the historical
  domain-separated Merkle builder, audit paths, and `verify-genesis.mjs`.
- Standalone signed v1 records for all 18 formerly genesis-only Notes, each with
  a `genesis_ref` and an independently stamped OTS proof.
- A 24-row machine-readable `index.json`, live coverage verifier, all-page
  verifier, all-record offline verifier, and GitHub Actions enforcement.
- Explicit detached-OTS digest binding: every proof must start from its record's
  `content_hash` before any Bitcoin attestation is accepted.
- Accurate key documentation, signed key-history verification, and a signed OTS
  fingerprint record at `keys/anchors/sn-ed25519-2026-07.{json,ots}`.
- Independent current-key pins:
  `_provenance.juanlentino.com` TXT and
  `https://juanlentino.com/.well-known/provenance-keys.json`.
- GitHub Actions burst containment: workflow concurrency plus `[skip ci]` on
  routine Worker OTS progress/confirmation commits. The 21-record migration
  burst used 481 seconds of runner wall time and GitHub reported 0 billable ms.
  The plugin tag and its release-note follow-up added five green runs and 137
  seconds, also 0 billable ms; no deployment workflow ran.

## Published components

- Public ledger source/hardening base: `782603ad540a1858ee7b304aecc1461f17187ca6`
- Public ledger live verifier/CI commits: `7bba21f`, `c7fd124`
- Signal & Noise Tools: commit `2e09f188b446bdf2baa4ba16abeb0faa7ec28910`,
  tag `v9.72.0`; installed through WordPress admin by the site owner.
- Private Worker source: `893a200e133230a6af37552a68d93d0aff7b2b09`
  (v1.5.0) and `d57e378e559c37dc84b051367ba203f5f58e0e9b`
  (v1.5.1 CI containment), followed by `282122a` (v1.5.2 stale-queue
  self-healing and tracked-lockfile repair).
- Live Worker: v1.5.2, Cloudflare version
  `099e3585-5e3d-48ea-8c81-08d4c2a0c0dd`, deployed with `npm run deploy`.
  The original three secret bindings remain present; no values were read.
- Cloudflare DNS record: `052ba26506e20bcfdfe928bb31640bac`.
- First green full-ledger workflow: run `29751548320` at commit `c7fd124`
  (16 seconds wall time, 0 billable ms).

## Validation evidence

- Ledger tests: 50/50.
- Worker tests: 36/36; Wrangler deployment succeeded.
- Plugin provenance-DID/key-mirror suite: 25/25; changed PHP file linted.
- `verify-records.mjs`: 24/24 offline hash, Ed25519 signature, and OTS-digest
  checks pass.
- `verify-genesis.mjs`: 21/21 derivations and audit paths reproduce the root.
- `verify-coverage.mjs`: `24/24 anchored, 0 gaps` against live WordPress.
- `verify-pages.mjs`: 24/24 public pages reproduce their standalone records;
  optimizer-dependent runs use the strict REST fallback only where needed.
- All six pre-existing standalone records and genesis pass end-to-end Bitcoin
  verification against Blockstream.
- Four newly backfilled standalone records also pass end-to-end verification at
  Bitcoin block `958897`; all 11 currently confirmed artifacts (10 Notes plus
  genesis) pass together.
- DNS answers from 1.1.1.1 and 8.8.8.8, the HTTPS mirror, the repo key, and
  `key-history.json` agree on key id `sn-ed25519-2026-07` and raw-key SHA-256
  `973e572578919916d93bbe37dbf3a3539b4e1bc1b19d235a7610cc734cae674a`.
- A fresh local clone passed install, unit, genesis, key-history, key-pin,
  24-page, and live coverage checks.
- The `signal-and-noise` theme checkout remained clean and untouched.

## External confirmation state

Four of the 18 new standalone Note proofs have now confirmed in Bitcoin block
`958897` (transaction
`84b546128123ec01e6088b5d5b18960dcd150fd2c550af21b571ffaf9ebd4e2c`).
Their Worker commits were pulled, `pending.json` was pruned, and `index.json` was
rebuilt. The sweep exposed a tail-commit failure mode in which confirmed records
could remain queued if the final pending-index commit did not land; Worker
v1.5.2 now recognizes those records, retries the signed WordPress callback, and
self-heals the queue without rewriting confirmed record bytes.

The other 14 new standalone Note proofs and the key-fingerprint proof remain
accepted by Alice but have no calendar Bitcoin transaction yet, so
`pending.json` honestly contains 15 entries. No local or Cloudflare action can
create that external attestation; the hourly Worker will continue upgrading
them as the calendar publishes Bitcoin proofs. Final closure still requires
pulling those later `[skip ci]` bot commits, rebuilding `index.json`, verifying
the newly confirmed proofs, and recording their final block height(s) here.
