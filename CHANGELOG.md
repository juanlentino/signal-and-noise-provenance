# Changelog

## 2026-08-02 — Every site fetch validates its payload, not just its status

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
