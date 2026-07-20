# Verify the public provenance ledger

Node 22 is recommended. A fresh clone needs no OTS client:

```bash
npm ci
npm test
node verify-records.mjs
node verify.mjs <note_uid>
node verify.mjs --from-page https://juanlentino.com/notes/<slug>/ <note_uid>
node verify.mjs genesis
node verify-genesis.mjs
node verify-key-history.mjs
node verify-key-pins.mjs
node verify-coverage.mjs
```

`verify.mjs` recomputes the signed bytes, verifies Ed25519, parses the detached
OTS proof, requires the proof's embedded starting digest to equal
`content_hash`, and compares its Merkle commitment with the real Bitcoin block
from Blockstream. It exits nonzero on any failure. `verify-records.mjs` applies
the offline hash, signature, OTS-digest, and confirmed-block-height checks to
every indexed standalone record in one command.

## Content and page verification

The canonical artifact is `record.payload.content`. Never feed an entire
rendered page directly to `normalizeV1`: WordPress renders surrounding UI and
HTML optimizers remove source block whitespace. `--from-page` is the supported
public-artifact proof. It fetches the URL, isolates
`div.entry-content.wp-block-post-content`, cuts at the first provenance/share/
footer boundary, removes the generated `nav.sn-article-toc`, restores
deterministic block and inline-diagram boundaries, runs `sn-normalize-v1`,
replaces only the payload's content, canonicalizes, and requires both the
content string and SHA-256 to match.

Some page-cache optimizers erase source-only blank lines inside inline SVGs.
Only when direct page recovery misses does the verifier consult the same post's
public WordPress REST `content.rendered`: the REST rendering must reproduce the
record exactly, and the served page must be text-equivalent after whitespace
collapse. This permits only provably whitespace-only optimizer loss. A changed,
inserted, deleted, or reordered non-whitespace character on either public
surface fails.

For ordinary records, `content_hash` is SHA-256 of recursive sorted-key compact
JSON for `payload` (UTF-8, unescaped slash and Unicode). The same canonicalizer
is tested byte-for-byte across PHP, ledger JS, and Worker JS.

Genesis is the explicit exception to the hash convention: `content_hash` is
the Merkle root because the OTS commits to that root. Its Ed25519 signature is
still over recursive sorted-key canonical JSON for its payload. The controlled
2026-07-20 re-sign changed only `signature`; the root JSON value and original
`.ots` bytes remain the 2026-07-09 anchor.

## Genesis and historical backfills

Run `node verify-genesis.mjs`. It reconstructs every v0 leaf from
`genesis/2026-07-09-leaves.json`, generates and verifies all audit paths, and
must produce root
`cca0dfa924b4bd694c762f902c61c70340b94e302a2f0ad3bb7e42f56d1f2ef9`.

Historical genesis-only notes also have standalone v1 records. Their
`genesis_ref` links to the older leaf. The genesis OTS is the authoritative
"existed by 2026-07-09" evidence; the later v1 OTS supplies independently
reproducible content and proves existence by the backfill block. Leaf and
content hashes differ because v0 uses `SHA-256(0x00 || canonical-v0)`, while v1
uses `SHA-256(canonical-v1)` and names the leaf as its parent.

## Pin the key outside GitHub

Do not accept the repo copy by itself. Compare all three surfaces:

```bash
dig +short TXT _provenance.juanlentino.com
curl -fsS https://juanlentino.com/.well-known/provenance-keys.json
cat keys/sn-ed25519-2026-07.pub
node verify-key-history.mjs
```

They must agree on:

- id `sn-ed25519-2026-07`
- key `+aDvAWcZA6awAX3+y76cteKbIGKyVLDjpG7rp7IVNWs=`
- raw-key SHA-256 `973e572578919916d93bbe37dbf3a3539b4e1bc1b19d235a7610cc734cae674a`

`verify-key-history.mjs` also verifies that every declared key introduction
points to a correctly signed and hashed fingerprint record. Once the two public
off-repo surfaces are live, `verify-key-pins.mjs` requires DNS, HTTPS, and
`key-history.json` to agree exactly.

The private key is a Cloudflare Worker secret and is never committed. The
current fingerprint has its own signed OTS record at
`keys/anchors/sn-ed25519-2026-07.json`. Future generations must be introduced
by a transition in `key-history.json` signed by the preceding key; revocations
record their effective boundary without invalidating signatures made before it.

## Coverage

`node verify-coverage.mjs` enumerates the public WordPress note collection and
requires every live slug to have one unique `index.json` row with a confirmed
genesis or per-note Bitcoin anchor. The success line is `24/24 anchored, 0 gaps`.
Use `--offline` to validate only the committed manifest.
