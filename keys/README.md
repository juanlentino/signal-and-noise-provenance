# keys/

Publishes the site's Ed25519 public key(s), one file per key generation
(rotation-friendly). Filename convention matches the Worker's `PUBKEY_ID` var
and the `pubkey_id` field on every ledger record, e.g. `sn-ed25519-2026-07.pub`.

Each file holds the raw 32-byte public key, base64-encoded, one line, no
other content — the exact bytes `scripts/gen-keypair.mjs` prints under
"PUBLIC KEY (publish; 32-byte raw, base64)".

**No key has been generated or published yet.** `gen-keypair.mjs` was
written (worker `scripts/gen-keypair.mjs`) but deliberately not run as part
of this offline build — key generation + secret provisioning is an outward
step for the controller to run once, after which the resulting public key
lands here as `sn-ed25519-2026-07.pub` and the private key becomes the
Worker's `ED25519_PRIVATE_KEY` secret (never committed to this repo).
