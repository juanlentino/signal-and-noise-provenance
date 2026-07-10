# signal-and-noise-provenance

Public, append-only provenance ledger for Signal & Noise Tools Notes. Every
commit is written by the `sn-provenance` Cloudflare Worker in response to a
Note being published or edited — no human commits here directly.

Verify any record yourself with **one command** —
`node verify.mjs <note_uid>` — which recomputes the content hash, checks the
Ed25519 signature under the published key, and confirms the OpenTimestamps proof
against the **real Bitcoin block** on a public explorer (no OTS client needed).
For the manual, do-it-by-hand steps see `VERIFY.md`. Either way, no trust in this
repo's owner is required.

## Layout

- `keys/` — published Ed25519 public keys, one file per key generation
  (`<pubkey_id>.pub`, raw 32-byte key, base64). See `keys/README.md`.
- `notes/<note_uid>/v<version>.json` — a signed, hash-anchored commit record
  for one version of one Note. `note_uid` is a stable UUID (survives slug/ID
  changes); `version` increments per non-trivial edit.
- `notes/<note_uid>/v<version>.ots` — the matching OpenTimestamps proof over
  `content_hash`, upgraded from `pending` to Bitcoin-`confirmed` by the
  Worker's hourly sweep.
- `genesis/` — baseline records for Notes that existed before the
  provenance system went live (backlog import; set via WordPress's
  `_sn_prov_genesis_parent` meta).
- `normalize/sn-normalize-v1.mjs` — the JS reference implementation of the
  `sn-normalize-v1` content-normalization algorithm. **Authoritative for
  third-party verifiers** — guaranteed byte-identical to the PHP source of
  truth (`inc/provenance-core.php`'s `sn_prov_normalize_v1()` in the plugin
  repo) by `normalize/parity.test.mjs`.
- `pending.json` — the Worker's sweep work queue: `{note_uid, version, path}`
  for every record whose OTS proof hasn't yet been confirmed on-chain.
- `verify.mjs` + `verify/` — the one-command trustless verifier
  (`node verify.mjs <note_uid>`, or `npm run verify -- <note_uid>`): recompute
  the canonical hash via `normalize/canonical-json.mjs`, verify the Ed25519
  signature, and confirm the OTS proof's merkle root against the real block
  header from a public explorer. `verify/ots.mjs` is a minimal, vendored OTS
  reader; everything but the block-header lookup is offline. Tested against a
  real confirmed record in `verify/verify.test.mjs` (`npm test`).
- `backfill-v1.done` — one-time marker: present once the Worker's historical
  `bitcoin_block` backfill has run (for Notes confirmed before the Worker began
  recording the block).

## Why "bot-written"

The write path is a scoped, fine-grained GitHub PAT
(`Contents: Read and write` on this repo only) held only by the Worker.
Records are committed atomically (blob → tree → commit → ref, GitHub's Git
Data API) so a `vN.json` and its `vN.ots` never land as two separate,
observable commits. Nothing here is meant to be edited by hand.

## Algorithm versioning

`sn-normalize-v1` is content-addressed by name (`payload.algo`). If the
normalization pipeline ever needs to change in a way that would alter output
for existing content, that requires a new `sn-normalize-v2` file and algo
name — never silently reordering or editing v1's steps.
