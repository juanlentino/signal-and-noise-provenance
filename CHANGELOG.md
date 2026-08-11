# Changelog

## 2026-08-11 — signed pages enter the index (R2A step 4)

The About page was signed today — `pages/01cea10c…/v1.json`, the first record
ever written outside `notes/`. It was also **invisible**: absent from
`index.json`, and therefore outside the record↔index consistency check this
repo's CI runs. CI stayed green over it, because CI only ever checked things
that were indexed. A page record was not wrong; it was unchecked.

- **`build-index.mjs` discovers signed pages the same way it discovers notes** —
  fetch the site, read the UID out of the rendered page — rather than by walking
  `pages/` on disk. Disk enumeration would publish records with nothing to
  compare them against, and the site→ledger cross-exam is the entire point of
  this file.
- **The one asymmetry with notes, stated because it looks like a missing check:**
  a page with **no UID is normal**, not an error. Signing a page is opt-in per
  page (plugin v10.84.0), so most pages carry no provenance and are skipped in
  silence. The notes loop throws on a missing UID because every published note
  must be signed; the same rule here would fail CI on every ordinary page.
  Conversely, a page that **renders a UID with no record on disk** throws — the
  site claiming a proof that does not exist is exactly what this cross-exam is
  for.
- **`verify-coverage.mjs` holds page rows to the same record↔index checks** —
  newest version, matching `content_hash`, matching OTS status and block. The
  record side reads `?? null` so a record written before worker v1.10.1 (which
  omitted the key rather than writing null) compares equal to the explicit null
  the index always writes. That mismatch is what reddened CI earlier today.
- **The site→ledger reverse-coverage tier is deliberately NOT applied to pages**,
  and says so in the code: with opt-in signing, "a published page with no record"
  is normal rather than a gap. Left silent, the missing tier would read as an
  oversight instead of a decision.
- **Additive by contract**: `pages` is a new top-level key. `entries` rows are
  untouched, because plugin-side readers index into them by shape and a row with
  different fields inside that array would be a silent contract break.

Requires plugin **v10.86.0** to be installed before it finds anything: the UID
this reads only appears in a signed page's HTML once that release's render
lands. Until then the pages section is empty and everything behaves exactly as
before — verified against the current index, which has no `pages` key at all.


## 2026-08-11 — the mirror moved to v2 and the verifier was not told

Every push run since 01:45 failed with:

```
HTTPS key mirror does not match key history — schema: got "sn-provenance-keys-v2",
expected "sn-provenance-keys-v1".
```

**The key material was byte-identical.** Id, algorithm, public key, fingerprint, status
and introduction date all agreed with `keys/key-history.json`, and the DNS pin agreed too.
The only divergence was the version string: the plugin's v10.77.0 ("key history with a
future") moved the served document to **v2**, adding a per-key validity window and an
optional `next_key_commitment`, and this repo — a separate repo, released separately —
kept asserting v1. It went unnoticed until the plugin carrying v2 reached the live site.

`verify:key-pins` now expects `sn-provenance-keys-v2`, deliberately as a **single accepted
version** rather than an allow-list. This is the trust root's mirror; "either shape is
fine" is how a downgrade goes unremarked.

**Bumping the string alone would have traded a loud failure for a blind spot,** because
v2's entire contribution is the validity window and nothing verified it. So the comparison
also asserts:

- `valid_from` agrees with the key history's `introduced_at`.
- `valid_until` is `null` — the key we are still signing with has an open window by
  definition, and a date there contradicts `status: "active"` rather than refining it.
- An **absent** `valid_until` is reported as absent, not collapsed to `null`. A mirror that
  dropped the field would otherwise pass as though it had declared an open window.

**Why this had no test.** The comparison lived inline in `verify-key-pins.mjs`, below a DNS
lookup and a live fetch at module scope — reaching it from a test meant performing both, so
it had none. It moves to `key-pins.mjs` as a pure function over `(document, current)`;
`verify-key-pins.mjs` stays the runner that resolves, fetches and reports. 9 assertions in
`verify/key-pins.test.mjs`.

**Also refreshed `keys/provenance-keys.json`**, the committed copy of the served document,
which was still at v1. Nothing read it — no script imports it, only prose points at the live
URL — which is exactly why it drifted: an artifact with no reader has no guard. It now has
one: the snapshot is held to the same comparison as the live mirror, so the next skew is a
red test rather than a red deploy.

## 2026-08-05 — a pending anchor is a state, not a failed build

`verify:coverage` failed at 11:35 with `anchor is not confirmed for
the-pen-is-not-the-notary`. The Note had been published at 11:28. Seven minutes
into a wait that routinely takes hours, the trust repo declared a problem — and
the check would have kept failing until Bitcoin confirmed, on every publication,
forever. A check that reds the build every time you publish is a check people
learn to ignore, which defeats the only thing this repo is for.

**Pending is now a state.** `anchor-grace.mjs` decides whether an unconfirmed
anchor is young or stuck: within the window (24h by default,
`SN_ANCHOR_GRACE_HOURS` to override) it passes; past it, the build fails **and
names the age** — `pending for 31.4h, past the 24h grace window` — so the report
is actionable rather than binary.

Deliberately narrow, because the point is to keep catching real trouble:

- Only `ots_status: "pending"` waits. Any other value — `failed`, missing,
  misspelled — is a fault regardless of age.
- An entry whose `published_at` is absent or unparseable **fails**. An age that
  cannot be established is unknown, and unknown must not pass as young.
- A future-dated `published_at` fails too: a scheduled post or a clock problem
  is not evidence an anchor is progressing.
- A pass that carries pending anchors **says so** — the run prints which Notes
  are waiting and for how long, so green never reads as "everything confirmed".

The decision is extracted into its own module so it can be tested with an
injected clock; a grace window tested against the wall clock would pass today
and fail at some future hour. 21 assertions in `verify/anchor-grace.test.mjs`,
including the live 11:28/11:35 case and the invariant that a failure always
carries a reason.

**Also rebuilt `index.json`.** The sweep that confirmed the-pen-is-not-the-notary
(block 961,153) committed with `[skip ci]`, so nothing rebuilt the index and
nothing re-ran the checks — the row still read `pending/null` while the record on
disk read `confirmed/961153`. The staleness guard that catches exactly this was
already in place and correct; it simply had not run yet. Rebuilt, so the next
run starts from a consistent ledger.


## 2026-08-04 — index.json carries the rights-signals ledger, so the anchoring gap becomes answerable

`verify:rights-signals` (below) proves every anchored rights-signal claim is
internally sound. It says nothing about whether the surface the site serves
*right now* has been anchored at all — if the Worker stopped re-anchoring a
changed `robots.txt`, the ledger would stay perfectly valid and perfectly stale.
Answering that from outside needs the newest record's hash per surface, and the
rights-signals ledger had no index: a reader had to probe `v1`, `v2`, … until a
404, or spend one of GitHub's 60 unauthenticated tree calls an hour.

- **`index.json` gains a `rights_signals` section** — one row per surface, with
  `slug`, `url`, `version`, `content_hash`, `ots_status`, `bitcoin_block`.
  Derived exactly like the note rows (newest record wins), so `robots-txt`
  correctly lands on v2. One read of a file the ledger already publishes and CI
  already self-heals. Additive to `sn-provenance-index-v1`.
- **`verify:coverage` holds the new rows to the records**, with the same
  anti-stale guard the note rows got this morning: a row pinned to a superseded
  record, a surface missing from the index, a row whose hash or URL disagrees
  with its record, a stale anchor, or a row naming a surface with no records —
  each fails by name with the command that fixes it. Without this the section
  would become exactly the stale mirror that caused today's earlier incident,
  and any consumer trusting it would report drift that is really index staleness.

The consumer is the WordPress side: a Content-Health check comparing each live
surface against its anchored hash. This section is what makes that a single
cheap read. Note what is deliberately NOT here — a heartbeat from the Worker
saying "sweep completed" would be a success-only readout, and this Worker has
exactly that shape (per-signal failures are caught, logged, and stepped over),
so it would report healthy while a surface silently never anchored.

## 2026-08-04 — The rights-signals ledger was signed, anchored, and checked by nothing

A sweep for the `v1.json` hardcode fixed earlier today found no second instance
of it — but found that the repo's **other** ledger had no verifier at all. Four
machine-readable rights surfaces (`robots-txt`, `license-xml`, `tdm-policy`,
`tdmrep-json`), five records, each hashed, signed with the same production
ed25519 key as the Notes and anchored in Bitcoin. No `verify:*` script and no
workflow step read any of it; only `CHANGELOG.md` and `README.md` mentioned it,
in prose. `robots-txt` already had a v2, so the multi-version case had been
exercised there unobserved. All five were checked by hand and verify.

- **`verify:rights-signals`** (new), wired into the workflow. Per record: the
  `.raw` capture hashes to `content_hash`; the signature verifies over those
  same raw bytes under the published key; the OTS proof commits to the hash; a
  `confirmed` record's proof attests the block it claims. Per surface: versions
  contiguous from v1, every version carrying all three of `.json`/`.ots`/`.raw`,
  and no record filed under another surface's slug.
- **Its scope is pinned, because it discovers its own scope.** Listing the
  ledger to decide what to verify means a surface that *disappears* is
  invisible — deleting one had it report "4/4 across 3 surfaces" and pass. The
  four surfaces are now a floor, taken from the writer's own `RIGHTS_SIGNALS`
  list. Additive: a fifth is verified without being listed; none of the four may
  vanish quietly.
- **Re-anchoring an unchanged surface is a failure.** The writer appends only
  when the bytes changed, so two consecutive identical hashes mean dedup did not
  hold — a version burned and a Bitcoin anchor spent on a surface that never
  moved.
- **Deliberately offline, and this is the interesting difference.** A Note's
  record claims *this is the Note's content*, so `verify:pages` holds the served
  page to it. A rights-signal record claims *on this date the surface served
  these bytes*, which a later edit does not falsify. Since the worker re-anchors
  hourly on change, a live comparison would red CI for the window between an
  edit and the next sweep — turning worker latency into a ledger integrity
  failure. Freshness belongs to the worker's monitoring; this script answers
  only whether every anchored claim is internally sound.
- `contiguousFromV1()` moved into `ledger-records.mjs` and is unit-tested; both
  verifiers now state that invariant once.

Each guard was confirmed to fire against a deliberately broken copy — tampered
capture, tampered signature, wrong slug, wrong block, unpublished key,
re-anchored unchanged surface, missing `.raw`, version gap, deleted surface, and
a record attesting to another host. Added as a workflow *step*, not a job, so it
bills no additional rounded minute.

## 2026-08-04 — The first edited Note broke the index, because the index assumed no Note was ever edited

**Root cause:** `scripts/build-index.mjs` read `notes/<uid>/v1.json` — hardcoded.
That held for 29 Notes because none had ever been edited. `start-here` was
edited on 2026-08-04; the Worker appended a correct, signed `v2.json`, and the
index row went on naming v1. `verify-pages.mjs` reads
`v${entry.version}.json`, so it compared the live page against the *superseded*
record and reported `served-page drift for start-here` — the ledger accusing
the site of tampering over its own stale index. It was not a race: the failing
run was the run for the v2 push, with v2 already in the tree.

The failure was permanent, not transient. Every run — including the nightly
schedule — would have stayed red for as long as the edit stood.

- **The index tracks the newest record.** `recordVersions()` /
  `latestRecordVersion()` in the new `ledger-records.mjs` are now the single
  answer to "which record is current?", shared by the index builder, the
  coverage guard, and the offline record verifier. They sort numerically: a
  string sort puts v10 before v2 and reports v9 as the newest record of a
  ten-version Note.
- **A pending edit no longer un-anchors a Note.** A fresh record is `pending`
  for the hours between its commit and its Bitcoin confirmation. The row's
  top-level anchor now names the newest *confirmed* record, and a new
  `anchored_version` field says which one — a row carrying the current text's
  `content_hash` beside an older record's `bitcoin_block`, with nothing saying
  so, reads as a claim that the current text is in that block. `standalone_*`
  continues to report the current record's own OTS state, which for
  `start-here` is honestly `pending`/`null` until its v2 confirms. Additive to
  `sn-provenance-index-v1`; no code outside this repo reads the index.
- **The guard that should have caught it.** `verify:coverage` compared the row
  against `v1.json` too, so it could not see the staleness; its live check
  compares *slugs*, and an edited Note keeps its slug. It now rejects a row
  pinned to a superseded record, by name, with the command that fixes it — the
  bug would have surfaced as "index is pinned to a superseded record" instead
  of as drift.
- **Superseded records stay verified.** `verify:records` checked only the
  version the index named, so pointing the row at v2 would have quietly dropped
  v1 from verification. It now verifies every version on disk and requires them
  contiguous from v1: 30/30 records across 29 Notes, up from 29/29.
- **The commit chain is verified for the first time.** `payload.parent` was
  written but never checked — with one record per Note the link was always
  null-or-genesis and never load-bearing. The chain runs genesis leaf → v1 → v2
  → …, and it is what makes an *edit* auditable rather than merely recorded.
  Note the limit of the end-to-end check: `parent` sits inside the signed
  payload, so a tampered link fails the hash and signature long before the
  chain comparison — the rule only fires on a validly signed record naming the
  wrong predecessor, which cannot be constructed without the signing key. The
  rule is therefore a unit-tested pure function rather than an unfalsifiable
  claim in a script.

## 2026-08-02 — Every site fetch validates its payload, not just its status

**Root cause, confirmed on the runner:** the edge answers GitHub Actions
requests with a **bot-challenge interstitial carrying HTTP 200** — 12,015
bytes titled `"One moment, please..."` in place of a ~119,000-byte Note
(`cf-ray …-SJC`, `cf-cache-status BYPASS`). Neither the status nor the
content-type can see it. It is intermittent: two runs of the *same commit*
five seconds apart disagreed (PR passed, push failed). The 2026-07-29
HTTP 415 and this `<!DOCTYPE html>` JSON parse failure are the same
mitigation wearing different faces.

- **Made a green run mean something.** A pass could not be distinguished from
  a pass that never met a challenge, so consecutive green runs were weak
  evidence the fix worked. Every leg now reports fetches, attempts, challenges,
  which attempt recovered, and the PoP — to stdout, to the GitHub step summary,
  and at the moment a challenge occurs so it survives a later unrelated
  failure. CI keeps any interstitial body it is served as a 30-day artifact:
  a challenge is ASN-based and cannot be reproduced from a residential IP, so
  that artifact is the only route to a real one.
- Replaced the remaining verdict-only assertions with evidence-bearing ones.
  `verify-key-pins` threw a single opaque `"does not match key history"` from
  an 8-way `||`, so a runner that hit it on 2026-08-03 — while the same
  document verified perfectly from a residential IP — could not say whether
  the mirror was wrong or the edge had served something else. It now names
  every diverging field with got/expected, the document's keys and its byte
  count, and keeps the raw bytes. Proven by negative control against a
  deliberately wrong document. `verify-pages` likewise prints the twin
  document rather than only its key names.
- Asserted that the 12 tests CI skips are **only** the live-PHP cross-checks,
  which need the plugin source and are absent by design. Verified by negative
  control — an injected stray `it.skip` fails the step. Without it a broken
  guard could silently skip real tests and still read as green.
- `fetch-site.mjs` now detects the interstitial by `<title>` and by the
  `cf-mitigated` header, treats it as retryable, and names it in the error
  instead of blaming the payload.

- Fixed the CI failure on the `10bc8a21…` record push: the edge answered
  `scripts/build-index.mjs`'s REST call with **HTTP 200 carrying an HTML
  body**, which walked through `if (!response.ok)` and died as
  `SyntaxError: Unexpected token '<', "<!DOCTYPE "...` inside `JSON.parse`.
  The failure discarded the status, content-type, `cf-ray` and body, so the
  edge's actual verdict was unrecoverable after the fact.
- Added `fetch-site.mjs`: one hardened path for every juanlentino.com fetch —
  a named `User-Agent` and `Accept`, an assertion on the payload **shape**
  and not merely the status, three bounded spaced attempts, and an error that
  reports the status, content-type, `cf-ray` and a bounded body snippet.
  14 offline tests cover both observed interception shapes.
- Routed all eight site call sites through it — `build-index`,
  `build-genesis-derivations`, `verify-coverage`, `verify-pages` (page +
  twin), `verify.mjs` (REST + `--from-page`), and `verify-key-pins`, whose
  bespoke 2026-07-29 retry this generalises. The `.json` twin's 404 stays a
  *legitimate absence* via an explicit `tolerate`, so "no twin" and
  "intercepted" can no longer be confused. Blockstream calls are deliberately
  untouched: different origin, different failure mode.
- Rebuilt `index.json` with the `10bc8a21…` row. The failed run never reached
  its self-heal push, so `verify:coverage` was left red on `main` — the
  reverse-coverage guard correctly catching the record the index had lost.
  The ledger stands at **29/29** confirmed Note records.

## 2026-07-24 to 2026-07-31 — Coverage self-heal and rights-signal expansion

- Closed the `index.json` coverage drift that had held CI red since
  2026-07-21 by rebuilding the index from committed records (#1).
- Fixed the missing-index-rows bug, added a reverse-coverage guard, and
  closed a twin whitespace-only false-fallback in page verification (#2).
- Hardened `verify-key-pins.mjs`'s HTTPS mirror fetch with a named User-Agent,
  an `Accept` header, and bounded retry (#3).
- Made the coverage index self-healing in CI: the Worker commits records but
  never writes index rows, so the verify workflow now rebuilds `index.json`
  from the committed files on every run and pushes the healed tree on `main`
  (#4).
- Added confirmed provenance records for rights-signals `robots-txt` (v1,
  v2), `tdmrep-json` (v1), `license-xml` (v1), and `tdm-policy` (v1) —
  the ledger's first four rights-signal anchors, documented in the README.
- Landed four new confirmed Note records
  (`0ab100ea…`, `15240786…`, `422f8047…`, `afdc55c0…`), taking the ledger
  from 24/24 to **28/28** confirmed Note records.

## 2026-07-20 — Provenance ledger hardening

- Added rendered-page extraction, `verify.mjs --from-page`, exact drift tests,
  and scheduled live-page verification.
- Removed generated article TOCs during extraction and added a fail-closed
  public-REST fallback for optimizer-induced, whitespace-only inline-SVG loss.
- Added workflow concurrency so a rapid immutable-record backfill keeps only
  the newest branch verification run.
- Published the historical Merkle v1 algorithm, all 21 v0 payload derivations,
  offline root reconstruction, and per-leaf audit-path verification.
- Unified PHP, ledger JS, and Worker JS on recursive sorted-key canonical JSON;
  genesis verification now understands its Merkle-root hash convention.
- Added one-at-a-time, genesis-linked standalone v1 backfill tooling for the 18
  formerly batch-only notes without changing note content.
- Added `index.json`, live coverage enforcement, and the `24/24` verifier.
- Corrected key documentation; added DNS/HTTPS pin artifacts, a key-history
  chain, verifier, and signed OTS fingerprint-record path.
- Extended key-history verification through the signed fingerprint anchor and
  added an online verifier requiring exact DNS/HTTPS/history agreement.
- Bound every detached OTS proof explicitly to its record `content_hash` and
  added a 24-record offline verification sweep to CI.
- Pinned the verification workflow's checkout and Node setup actions to
  immutable commit SHAs and disabled persisted checkout credentials.
- Enabled GitHub secret scanning, push protection, and Dependabot security
  updates. Protected `main` for administrators too: linear history is required,
  and force-pushes and branch deletion are rejected while the provenance Worker
  may continue normal fast-forward ledger commits.
- Regression-protected the original six confirmed JSON/OTS pairs. The only
  permitted historical JSON change is the controlled genesis signature value;
  its root and OTS proof remain byte-identical.
