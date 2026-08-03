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

Verify the bytes served by the public site—not merely the committed payload:

```bash
node verify.mjs --from-page https://juanlentino.com/notes/<slug>/ <note_uid>
```

The root `index.json` is the machine-checkable coverage manifest. The scheduled
GitHub Action verifies the offline suites, reconstructs genesis, reconciles the
live WordPress note list, and checks every served page for drift.

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
- `genesis/2026-07-09-leaves.json` + `normalize/merkle-v1.mjs` — all 21
  public v0 derivations, the domain-separated historical tree algorithm, and
  audit-path inputs; `verify-genesis.mjs` proves them offline.
- `rights-signals/<slug>/v<version>.{raw,json,ots}` — the same anchoring applied
  to the site's rights signals: the machine-readable `/robots.txt`,
  `/license.xml`, and `/.well-known/tdmrep.json`, plus the human-readable
  `/tdm-policy/` page. `.raw` is the exact served bytes; unlike a
  Note record there is no `payload` and no `sn-normalize-v1` pass —
  `content_hash` is the plain SHA-256 of those bytes, the Ed25519 signature is
  over the same bytes, and `.ots` is the detached proof over `content_hash`.
- `index.json` + `verify-coverage.mjs` — one coverage row per public Note and
  live-site gap detection.
- `keys/key-history.json` + `verify-key-history.mjs` — key lifecycle and
  transition verification; DNS and HTTPS carry independent off-repo pins.
- `normalize/sn-normalize-v1.mjs` — the JS reference implementation of the
  `sn-normalize-v1` content-normalization algorithm. **Authoritative for
  third-party verifiers** — guaranteed byte-identical to the PHP source of
  truth (`inc/provenance-core.php`'s `sn_prov_normalize_v1()` in the plugin
  repo) by `normalize/parity.test.mjs`.
- `pending.json` — the Worker's sweep work queue:
  `{note_uid, version, path, kind, queued_at}` for every record whose OTS proof
  hasn't yet been confirmed on-chain. `kind` is `note`, `rights-signal`, or
  `key-fingerprint`. `queued_at` is an ISO-8601 timestamp; entries written
  before it was introduced carry none and are age-unknown rather than fresh.
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

## CI and the edge

Verification is deliberately **live**: the set of *public* Notes is only
knowable from the site, and comparing it against the ledger is the whole point
of the reverse-coverage guard. That puts ~60 requests per run against
juanlentino.com from a GitHub Actions runner.

The edge intermittently answers those runners with a **bot-challenge
interstitial carrying HTTP 200** — ~12 KB titled `"One moment, please..."`
where a real Note is ~119 KB. Because it is a genuine `200` and genuine
`text/html`, neither a status check nor a content-type check can see it. It has
also appeared as `HTTP 415` (2026-07-29) and as `<!DOCTYPE html>` on a JSON
endpoint (2026-08-02). It is genuinely intermittent: the `pull_request` and
`push` runs of one commit, five seconds apart, have disagreed.

### Reading a green run

A pass used to be ambiguous: "the retry absorbed a challenge" and "no challenge
happened" produced identical output, so a green run was consistent with the
retry never having been exercised. Every leg now ends with a line saying which
it was:

```
[evidence] verify:pages: 34 fetches, 34 attempts, no challenge from the edge
                         (this run did not exercise the retry)

[evidence] verify:pages: 34 fetches, 36 attempts, 2 challenges from the edge
                         at SJC — 2 absorbed by retry (worst case: attempt 2),
                         0 exhausted the budget
```

The second line is the evidence that the retry works; the first is an honest
statement that this run proves nothing about it. Both are appended to the run's
GitHub step summary, and a challenge that occurs is logged the moment it
happens, so it survives an unrelated later failure. Any interstitial body CI is
served is kept as a `challenge-evidence-<run_id>` artifact for 30 days — a
challenge cannot be reproduced from a residential IP, so that artifact is the
only way to hold a real one.

`fetch-site.mjs` is the single hardened path for every site fetch. It sends a
named `User-Agent`, asserts the payload **shape** rather than the status alone,
recognises the interstitial by `<title>` and by `cf-mitigated`, retries a
bounded 4s/12s, and on exhaustion reports the status, content-type, `cf-ray`
and a body snippet — so a recurrence is diagnosable from the CI log alone.

**Cloudflare is RULED OUT (owner-verified 2026-08-03).** In the zone's
Security -> Bots panel, Bot Fight Mode is **off** and AI-bot blocking is set to
**"Allow (do not block)"**. Cloudflare's bot mitigation is not running, so a
Cloudflare WAF skip rule — recommended in an earlier revision of this file —
would have been a no-op. Do not re-investigate Cloudflare.

**CONFIRMED: Imunify360 bot-protection on the Cloudways host.** It named
itself. Run 30775546845 (2026-08-03, `cf-ray …-SEA`) got this on the `.json`
twin, as HTTP 200 `application/json`:

```json
{"message":"Access denied by Imunify360 bot-protection.
            IPs used for automation should be whitelisted"}
```

So the same product answers in two shapes depending on what is asked for: an
HTML splash titled *"One moment, please..."* for page requests, and this JSON
envelope for `.json` ones. Both are HTTP 200. Also ruled out along the way:
Cloudflare (above) and this project's own plugin and theme (no interstitial
markup in either).

**It is not visible in the Cloudways dashboard** — do not hunt for a toggle.
Note also that the message asks for **IPs** to be whitelisted, and GitHub
Actions publishes thousands of rotating CIDRs, so an IP allowlist is not
practical. The support request should lead with the User-Agent and let
Cloudways say whether Imunify360 can match on it:

> Requests to `juanlentino.com` from GitHub Actions runners intermittently
> receive `{"message":"Access denied by Imunify360 bot-protection. IPs used
> for automation should be whitelisted"}` with HTTP 200, and an HTML splash
> titled "One moment, please..." on page requests. This is automated
> verification of my own site, identifying itself as
> `sn-ledger-verify/1.0 (+https://github.com/juanlentino/signal-and-noise-provenance)`.
> IP allowlisting is impractical — GitHub Actions egress rotates across
> thousands of CIDRs. Can Imunify360 allowlist by User-Agent, or exempt
> `/wp-json/wp/v2/posts`, `/notes/*` and `/.well-known/*` for this application?

A captured `challenge-evidence-<run_id>` artifact contains the interstitial
verbatim and names its own system in its markup. None has been captured yet
(capture landed after the last challenge). Attach one to the support request
when it appears — it turns the ticket into a one-look confirmation.

The retry logic stays regardless — it makes a challenge survivable, not
impossible.

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
