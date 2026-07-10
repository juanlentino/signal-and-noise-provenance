# Verifying a provenance record

Anyone can independently verify that a published Note's content existed, in
exactly its committed form, at or before a given time — without trusting
this repo's owner, the Worker, or WordPress.

## Quick: one command

With Node ≥ 18 and a clone of this repo, one script does steps 2–4 for you —
recompute the content hash, verify the Ed25519 signature under the published
key, and confirm the OpenTimestamps proof's merkle root against the **real
Bitcoin block** (fetched from a public block explorer; no OTS client to install):

```bash
git clone https://github.com/<owner>/signal-and-noise-provenance
cd signal-and-noise-provenance
node verify.mjs <note_uid>     # e.g. node verify.mjs a0f8393c-9804-4780-9e77-f2d4f6b7d1ff
```

```
  1) content hash  ✓ matches (canonical reproduced independently)
  2) signature     ✓ valid Ed25519 under the published key
  3) bitcoin       ✓ merkle root matches block 957333 on-chain

VERIFIED — authentic, unmodified, and anchored in Bitcoin.
```

It prints each check and exits non-zero if any fails; everything but the final
block-header lookup is offline. Prefer to trust nothing but your own Bitcoin
node, or to check by hand? The four manual steps below remain fully valid — the
script is a convenience, not the source of truth.

## 1. Fetch the record

Every commit lives at `notes/<note_uid>/v<version>.json` (plus a matching
`v<version>.ots`). Fetch both, e.g.:

```bash
curl -O https://raw.githubusercontent.com/<owner>/signal-and-noise-provenance/main/notes/<note_uid>/v1.json
curl -O https://raw.githubusercontent.com/<owner>/signal-and-noise-provenance/main/notes/<note_uid>/v1.ots
```

The `.json` record has the shape:

```json
{
  "payload": { "algo": "sn-normalize-v1", "author": "...", "content": "...", "note_uid": "...", "parent": null, "published_at": "...", "title": "...", "version": 1 },
  "content_hash": "<sha256 hex>",
  "signature": "<base64 ed25519 sig>",
  "pubkey_id": "sn-ed25519-2026-07",
  "ots": { "status": "pending" | "confirmed", "calendars": [...] }
}
```

## 2. Recompute the hash

A pure-JS verifier can do this entire step with only the two files below —
no PHP, no WordPress, no network calls beyond fetching the record itself:

- Run the Note's raw HTML through `normalize/sn-normalize-v1.mjs`'s
  `normalizeV1()` (or the authoritative PHP `sn_prov_normalize_v1()` in the
  plugin repo — both are guaranteed byte-identical; see
  `normalize/parity.test.mjs`, including its live-PHP cross-checks) to get
  `payload.content`.
- Canonicalize `payload` with `normalize/canonical-json.mjs`'s
  `canonicalize()` (recursively sorts object keys by byte order, compact
  JSON, UTF-8, unescaped slashes/unicode — byte-identical to the
  authoritative PHP `sn_prov_canonical_json()`; see
  `normalize/canonical-json.test.mjs`'s live-PHP cross-checks).
- SHA-256 the canonical bytes and compare hex digests against
  `content_hash`. A mismatch means the content was altered after commit.

## 3. Verify the signature

- Fetch the publishing key from `keys/<pubkey_id>.pub` (raw 32-byte Ed25519
  public key, base64).
- Verify `signature` (base64, 64 raw bytes) against the *exact canonical
  JSON bytes* from step 2 using that public key. A valid signature proves
  the holder of the corresponding private key attested to this exact
  content — not just that some data with a matching hash exists.

## 4. Verify the timestamp

- `.ots` is a standard OpenTimestamps proof over `content_hash`.
- Install the reference client (`pip install opentimestamps-client`) and run:
  ```bash
  ots verify v1.ots
  ```
- `status: "pending"` means the proof is calendar-attested but not yet
  aggregated into a Bitcoin block; `ots verify` will report a pending
  attestation. `status: "confirmed"` means the Worker's hourly sweep
  upgraded it — `ots verify` should report `Success! Bitcoin block <height>
  attests existence as of <date>`, proving the content existed no later
  than that block.

## Trust model

This ledger is bot-written and append-only (Task 8 scaffold; commits are
made only by the `sn-provenance` Worker via a scoped GitHub token). Nothing
here requires trusting the repo owner: the signature proves authorship
attestation, and the OpenTimestamps proof proves a lower bound on existence
time, both independently checkable by any third party with steps 2–4 above.
