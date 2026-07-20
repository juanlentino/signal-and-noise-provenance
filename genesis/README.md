# 2026-07-09 genesis snapshot

The genesis record anchors 21 ordered v0 payloads in Bitcoin block 957359.
Its tree is now fully public and reproducible:

- leaf data: recursive sorted-key canonical JSON of the v0 payload
- leaf hash: `SHA-256(0x00 || leaf_data)`
- internal node: `SHA-256(0x01 || left || right)`
- odd node: promoted unchanged (never duplicated)
- ordering: WordPress publication time ascending

`2026-07-09-leaves.json` contains every exact v0 payload derivation. Run
`node verify-genesis.mjs` to recompute all 21 leaf hashes, the root, and every
audit path offline. `normalize/merkle-v1.mjs` is the published implementation.

Genesis and standalone records intentionally have different hashes. A genesis
leaf includes the `0x00` domain separator and a v0 payload; a standalone v1
`content_hash` is plain SHA-256 of its v1 canonical payload, whose parent is the
genesis leaf. This is an epoch/scheme distinction, not drift.

The time claim is also split deliberately. The genesis OTS proves each included
leaf existed no later than 2026-07-09. A later standalone backfill OTS proves
that reproducible v1 record existed by its own confirmation block. The older
genesis anchor remains the authoritative historical time claim; the v1 record
is the first-class content-verification layer.
