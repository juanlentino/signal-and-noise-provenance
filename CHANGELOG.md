# Changelog

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
- Regression-protected the original six confirmed JSON/OTS pairs. The only
  permitted historical JSON change is the controlled genesis signature value;
  its root and OTS proof remain byte-identical.
