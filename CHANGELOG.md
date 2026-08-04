# Changelog

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
