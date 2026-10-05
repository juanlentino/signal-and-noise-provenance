# Verify the public provenance ledger

## What you are trusting when you run this

Not the site. Every check below runs from the files in your clone: the
records, the keys, the proofs, and the verifier itself are all in front of
you, readable before you run anything. The only network call the per-note
verifier makes is one public block-explorer lookup for a Bitcoin header —
and you can point it at any explorer you prefer, or check the header by any
independent means.

What you ARE trusting: the code in this repository (a few small files —
read them), your Node runtime, and one block-header source. That is the
whole list. This is the honest version of "don't trust the site's own
button": the site's /verify page runs the same checks, but with JavaScript
the site served; this program removes that residue.

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
node verify-pages.mjs
```

`verify.mjs` recomputes the signed bytes, verifies Ed25519, parses the detached
OTS proof, requires the proof's embedded starting digest to equal
`content_hash`, and compares its Merkle commitment with the real Bitcoin block
from Blockstream. It exits nonzero on any failure. `verify-records.mjs` applies
the offline hash, signature, OTS-digest, and confirmed-block-height checks to
every indexed standalone record in one command. `verify-pages.mjs` runs the same
served-page proof as `--from-page` across every indexed Note in one pass and
reports how many needed the public-REST whitespace fallback.

## What the signature attests — and what it does not

A passing run proves four things: the record's bytes are unchanged since they
were signed, the signature verifies against the independently pinned key, the
content existed no later than the Bitcoin block its OTS proof commits to, and
the page the site serves still reproduces the signed content exactly.

What it does not prove, said plainly: that a person applied a key by hand over
these words. The private key is a Cloudflare Worker secret (see "Pin the key
outside GitHub" below), and the Worker signs when the site tells it a Note was
published. So the signature attests that **the author's own publishing
infrastructure witnessed this content at this time** — not that a human signed
it directly. The trust boundary is the secret shared between the site and that
Worker, not the author's presence: anyone able to make an authenticated request
to it could obtain a valid signature.

That is deliberate, and it is narrow. This ledger is one instantiation of a
larger argument — a solo author signing their own text. Automated signing
infrastructure under an author's sole control is the same arrangement as a
digital audio workstation holding a creator's key: an instrument, not an issuing
authority. What it is not is an independent third party, and nothing claimed here
depends on it being one.

Nor is it permanent. `key-history.json` introduces new key generations through
transitions signed by the preceding key, so moving to a differently held key
later leaves every signature made before it verifiable.

## Verify the verifier

Releases of this tooling are tagged, built in this repository's public CI, and
published with a [build provenance attestation](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations)
(Sigstore). To check a downloaded release tarball:

```bash
gh attestation verify sn-verifier-<tag>.tar.gz --repo juanlentino/signal-and-noise-provenance
```

What that proves: the tarball you hold was built by this repository's release
workflow, from a named commit, unmodified since — so a tampered mirror or a
corrupted download fails loudly.

What it does not prove, said plainly: the attestation's trust anchor is
GitHub and Sigstore — the same party hosting the clone. It adds
tamper-evidence between the build and your download; it does not remove
GitHub from your trust list. If your concern is GitHub itself, read the code
in your clone (the section above) — that path never trusted the release
artifact to begin with.

## Content and page verification

The canonical artifact is `record.payload.content`. Never feed an entire
rendered page directly to `normalizeV1`: WordPress renders surrounding UI and
HTML optimizers remove source block whitespace. `--from-page` is the supported
public-artifact proof. It fetches the URL, isolates
`div.entry-content.wp-block-post-content`, cuts at the first provenance/share/
footer boundary, removes the generated `nav.sn-article-toc`, restores
deterministic block and inline-diagram boundaries, runs the normalization
generation the record itself names in `payload.algo` (`sn-normalize-v1`, or
`sn-normalize-v2` for records signed after 2026-08-25 — v2 additionally
expands `signal-noise/*` void-block attribute text into the prose, so
sidenote/pull-quote words verify like any other words; an unknown algo is a
hard error, never a guess),
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
genesis or per-note Bitcoin anchor. The success line is `N/N anchored, 0 gaps`,
where `N` is the number of Notes the live site currently publishes; any live
slug missing from `index.json` fails as a gap. Use `--offline` to validate only
the committed manifest.

It also checks each indexed row against `notes/<uid>/v1.json` itself, so a
`content_hash` or OTS mirror (`standalone_ots_status` /
`standalone_bitcoin_block`) that has fallen behind the record fails the run.
This matters because a sweep that confirms a proof rewrites the record only:
whoever runs one must rebuild the index with `node scripts/build-index.mjs` and
commit it alongside, or the next verification fails with a stale-index error
naming the slug. Both checks are offline.

## Rights evidence

`node verify-rights-evidence.mjs` walks `rights-evidence/` (absent until the
first record lands, which is not a failure): for every record it recomputes
the content hash over the canonical payload, verifies the Ed25519 signature
under the published key, checks that the OTS proof commits to that hash and,
for a confirmed proof, that it attests the block the record names. Then the
claim: `payload.kind` is `rights-evidence`, `payload.site` is an https URL on
`juanlentino.com`, `payload.month` is a calendar month, the directory name is
the UUIDv5 the site, family and month derive, the record is a v1 (a month is
minted once), the reservation names at least one signal with a SHA-256 hash,
the counts are counts and the training share does not exceed the reads, and
no month and family is filed twice. The rules live in
`rights-evidence-checks.mjs` with offline tests, including the ids the
plugin's own derivation produces, so the two sides cannot drift apart
unnoticed. Offline, like the rights-signal check: a month's counts are a claim
about the past that nothing served today can confirm.

### Schema 2

A record carrying `schema: 2` (plugin PR #1810, from the September 2026
records on) is checked against a shape of its own; a record with no `schema`
field is schema 1 and keeps every rule above, unchanged. Any other `schema`
value fails. The id, site, month, kind and v1-only rules are the same for
both.

- **The reservation in force.** `reservation` is
  `{window: {start, end}, signals: {<slug>: [...]}}`, with no `as_of`. Each
  entry is `{version, content_hash, block, valid_from, valid_to}`. A version
  is in force from its anchor (`valid_from`, the time of the Bitcoin block
  the ledger names for it) until the next anchored version's anchor
  (`valid_to`, or `null` while it is still current): the anchor is the
  earliest moment the ledger can prove those bytes existed. The record lists
  every version in force at any point of the window, so the verifier
  requires: at least one slug, each with at least one version; versions that
  are positive integers, distinct and ascending; a SHA-256 `content_hash`
  and an integer `block`; `valid_to` null or not before `valid_from`; and
  each version in force during the window, meaning `valid_from` is not after
  `window.end` and `valid_to` (when set) is after `window.start`: a version
  whose successor was anchored at the window's first instant never held
  inside it. The window itself must be the record's month, from its first
  instant (`YYYY-MM-01T00:00:00Z`) to its last second
  (`YYYY-MM-<last>T23:59:59Z`). Times are compared as times, so `+00:00` and
  `Z` offsets agree.
- **Three read blocks.** `rights_reads`, `retrieval_reads` and
  `unlabelled_reads` each carry `{reads, by_purpose, by_path, first, last,
  complete}`: a count, purpose to count, purpose then path to count, two
  strings (empty when there were no reads) and a boolean. `rights_reads` is
  the training claim and may carry only `train`; `unlabelled_reads` holds
  the rows with no recorded purpose and may carry only `unlabelled`;
  `retrieval_reads` is every other purpose and may carry none of `train`,
  `unlabelled`, `ops` or `dev` (the site's own probes are not evidence).
- **Crawling.** As schema 1 (counts that are counts, `train` not above
  `reads`), with `by_surface` keyed by purpose, then surface.
- **Sensor.** `sensor.version` is present and `sensor.taxonomy` is a
  non-empty string: purposes are the taxonomy's verdicts, so a count that
  cannot say which taxonomy it counted under cannot be re-read.
- **Identity.** Every count is by claimed user agent, and most of a month
  predates the verified-bot signal, so a schema-2 record carries
  `identity: {basis, verification: {source, since}, crawling: {reads, train},
  rights_files}`. `basis` is exactly `claimed user agent`;
  `verification.source` is exactly `cloudflare verified bot category` and
  `verification.since` is a time. `crawling.reads` and `crawling.train` are
  each `{verified, unverified, unverifiable}`, three non-negative integers
  that sum to `payload.crawling.reads` and `payload.crawling.train`
  respectively, with no `train` component above the matching `reads`
  component. Against the reservation window: if `since` is after
  `window.end`, nothing in the month could be verified, so `verified` and
  `unverified` are both 0; if `since` is at or before `window.start`,
  `unverifiable` is 0. `rights_files` is a non-empty string saying how the
  rights-file reads were identified. A schema-2 record without `identity`
  fails; a schema-1 record is never asked for one.


## Weigh the key

```bash
node weigh.mjs --policy policy/example.json
node weigh.mjs --policy policy/example.json --at 967020 --explain
```

`weigh.mjs` computes equation (1) of *Provenance Without Institutions*
(Lentino, SSRN 7456638, Section 6) for the current key in
`keys/key-history.json`, from the records in this repository and a policy file
the verifier supplies. It runs offline and writes nothing. There is no default
policy: without `--policy` it refuses, and a policy with an unknown field, an
unknown decay form or a D table that breaks one of the paper's four properties
is refused as well.

A record contributes only if it passes the offline checks `verify-records.mjs`
runs: the content hash recomputes, the signature holds under a key in the
history, the `.ots` proof commits to that hash, and the anchor is confirmed at
the block the record names. For notes and pages the commit chain must also hold
up to that record. A record that fails is listed under `excluded` with its
reason, and later versions of the same subject go with it. A record filed in
two directories (the About page, see `misfiled-records.json`) counts once.

The clock is the confirmed Bitcoin block height: the block each record's
`.ots` proof attests. Run offline, that is the block the proof names. Matching
it against the real chain's merkle root is the network step
(`node verify.mjs <note_uid>`), which `weigh.mjs` never makes, so run that
first if the heights matter to you. `published_at` is self-reported and the
code never reads it; changing it breaks the record's
hash, so the record drops out instead of moving. The 21 genesis notes enter at
block 957359, or at their own v1 anchor where that came first (two did, at
957333 and 957350). `--at` is a block height. Without it the run uses the
highest confirmed height among the records the tool checks. `rights-signals/`
is not read, because those records sign raw file bytes that `verifyRecord()`
cannot check, so a newer rights-signal anchor does not move the default.

Each persistence type the policy names gets its event count and its Pⱼ, an
exact fraction with a rounded decimal beside it for reading. An event anchored
at height h adds `retain ^ floor((at − h) / epoch_blocks)`. The attestation
term lists every type the policy names, each at zero here, with the reason;
C, D(C) and W follow. Two runs on the same commit with the same policy give
the same bytes, and CI checks that.

What a result does not show:

- The weight belongs to a key. This key is held by the publishing Worker (see
  "What the signature attests" above), and custody is as open here as it is in
  the paper's Section 10.
- One key and one author. Nothing about weighting several contributors to one
  work is demonstrated.
- No recognition attestation exists in this record. The ORCID identifier, the
  WebFinger subject and the `did:web` document are the author's own statements
  and are not counted, and the institutional track has nothing to read. W is
  therefore the persistence sum: the paper's floor property, on a key with no
  recognized attester.
- `policy/example.json` is an illustration. The paper leaves all seven inputs
  to the verifier; the example's 4320-block epoch and its retain fractions were
  chosen for this repository and claim nothing beyond it.
- A weight is not proof of identity or of human authorship. Zero means nothing
  has accumulated in the record, and the tool sets no threshold.

A note's original signed events still count after a retraction names it or
after it leaves the posts corpus (`retired-subjects.json`), and the output
lists such subjects by id. A retraction is never an event of its own. Every
retraction in the ledger today targets a rights-evidence record, so no note is
withdrawn.
