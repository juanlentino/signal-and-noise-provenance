# Provenance signing keys

`sn-ed25519-2026-07.pub` is the active Ed25519 public key. It was generated
for the July 2026 signing epoch and first published with the genesis ledger on
2026-07-09. The file is the raw 32-byte key encoded as one base64 line:

- key id: `sn-ed25519-2026-07`
- public key: `+aDvAWcZA6awAX3+y76cteKbIGKyVLDjpG7rp7IVNWs=`
- SHA-256 of the raw key: `973e572578919916d93bbe37dbf3a3539b4e1bc1b19d235a7610cc734cae674a`

The matching PKCS#8 private key exists only as the Cloudflare Worker secret
`ED25519_PRIVATE_KEY`; it has never been committed. The date suffix identifies
the generation, not an automatic expiry. Rotation is deliberate: create a new
key id, have the current key sign its introduction in `key-history.json`, pin
the new key through DNS and HTTPS, deploy the Worker with the new secret/id,
then mark the prior generation retired. A compromised key is marked revoked
with the reason and discovery time; old signatures remain verifiable but are
not trusted after the recorded revocation boundary.

Do not trust this directory alone. Compare it with both independent pins:

- DNS TXT at `_provenance.juanlentino.com`
- `https://juanlentino.com/.well-known/provenance-keys.json`

`key-history.json` is the lifecycle chain. Its first entry is an explicitly
documented trust root; every later key introduction must be signed by the key
that immediately precedes it. The current fingerprint is also signed and
OpenTimestamps-anchored at `anchors/sn-ed25519-2026-07.json`.
