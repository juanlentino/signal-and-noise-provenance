# Errata

A record on this ledger is never edited, moved or deleted. When one is wrong,
the correction is published beside it: an entry here, and a signed retraction
under `retractions/` that names the record and what was wrong with it.

## 2026-09-30: the four August 2026 rights-evidence records

Records affected (all schema 1, composed 2026-09-19, confirmed in Bitcoin
block 967760):

| Family | Record | content_hash |
|---|---|---|
| anthropic | `rights-evidence/e52701af-38fd-5775-ac84-ba94e87ee6b3/v1.json` | `4c28bc69cd461cd44a04f593cce8afc9baf345a51f21978347c45a2aeeae01e2` |
| commoncrawl | `rights-evidence/c2ec0f71-fc63-5d0a-a4a0-68b698b7637f/v1.json` | `567f90198f01d9856be5b5abc3e93205f2e5f1f44d8fbb817ec29a68065f1f98` |
| google-ai | `rights-evidence/c2321fd1-5c4d-5db2-9762-869e557968c8/v1.json` | `8599d982f0aed5024e907bf4aacc6ebe636f4eb01f196d1fa04ba02cb41c4b6f` |
| openai | `rights-evidence/0f9d8fcc-d83b-5f41-ae47-2e4643f9f800/v1.json` | `7d795b27a0acaee6c4e882407524045e1016a04b690a8220f1dab1889a179ca3` |

### Error 1: the reservation named versions that were not in force in August

Each record's `reservation.signals` listed the current version of every rights
signal as of composition (`as_of` 2026-09-19T23:55:42Z): license-xml v2,
robots-txt v5, tdm-policy v8, tdmrep-json v1 and webmcp-bridge v5. Two of those
were anchored in September and did not exist in August (tdm-policy v8, block
967489; webmcp-bridge v5, block 967489). The other three were in force for
only part of the month, beside earlier versions the record did not name.

The versions in force at any point from 2026-08-01T00:00:00Z to
2026-08-31T23:59:59Z, by anchor time, are below. The same table holds for all
four records: the reservation does not depend on the family. `valid_from` is
the time of the version's Bitcoin block; `valid_to` is the next version's, or
open. Block heights are given so the times can be recomputed without trusting
any explorer; a block's timestamp can sit an hour or two off wall-clock.

| Signal | Version | Block | valid_from | valid_to | content_hash |
|---|---|---|---|---|---|
| license-xml | 1 | 959374 | 2026-07-24T05:08:48Z | 2026-08-09T19:35:33Z | `d1308fd27030f076c9d5d398ca173972a968a77ae55460ce6a0c1d4102e1f330` |
| license-xml | 2 | 961766 | 2026-08-09T19:35:33Z | 2026-09-20T00:09:20Z | `a645697a9b30edf738270a6351e2765b29048a69f882e81473e3f056c0a0f417` |
| robots-txt | 2 | 959320 | 2026-07-23T23:19:52Z | 2026-08-08T02:11:01Z | `d610fe56cdbbe4da404aa61862d24ea269eb460e516b82ea4b4b132e2da83dec` |
| robots-txt | 3 | 961517 | 2026-08-08T02:11:01Z | 2026-08-09T19:35:33Z | `d3f4255f0445cc616bc714d6722a9c130b11921909d65d3043fe49b55d3a2fad` |
| robots-txt | 4 | 961766 | 2026-08-09T19:35:33Z | 2026-08-23T02:24:19Z | `294770dc377a737bac9de8877122179bf9cde552c5bb29a8320cecc417d61464` |
| robots-txt | 5 | 963662 | 2026-08-23T02:24:19Z | open | `7d2c712340f63795c008d419dad03d0fe6e6ae93807d5189ae3ed23fa2e868a4` |
| tdm-policy | 1 | 960034 | 2026-07-29T01:36:09Z | 2026-08-09T19:35:33Z | `5ae6f2d124a98b76527588fa16f59c8d3a4a7f13d6c04eafee9d3013d008bc6b` |
| tdm-policy | 2 | 961766 | 2026-08-09T19:35:33Z | 2026-08-09T20:21:40Z | `022d947d092e5b71e135f884e7ee55d81f1d92c30fc7531c7fca84e272853fea` |
| tdm-policy | 3 | 961770 | 2026-08-09T20:21:40Z | 2026-08-29T01:31:33Z | `45ef26cb9c100657624f3bcbaa30203d266b8b5f471f5b0b9f68ec25c6f6b4a5` |
| tdm-policy | 4 | 964508 | 2026-08-29T01:31:33Z | 2026-09-12T07:01:26Z | `6d3fa5478dcbe1149ee05b34351c9920f5e4ee9487df6caae322000f1d934bca` |
| tdmrep-json | 1 | 959348 | 2026-07-24T02:34:12Z | open | `421f88383938eeaf8882474c747d1f3cfcd7e51c5d89711fd3df98fc0071ec80` |
| webmcp-bridge | 1 | 964512 | 2026-08-29T02:12:39Z | 2026-09-12T07:01:26Z | `b355cb956d87914169f220ad0e57d9d7260314ef942352aa4894afa60fa7563a` |

### Error 2: the rights-file reads were reported as none

Each record carries `rights_reads.reads: 0` with `complete: false`. Reads did
happen; they were missing because the sensor's rights stream is capped at 500
rows and the site's own monitoring probes had filled it, pushing August out of
the window. Read again with that traffic filtered out, the families' fetches of
the rights files in August were:

| Family | Purpose | Reads | Paths | First | Last |
|---|---|---|---|---|---|
| openai | search | 4 | `/tdm-policy/` 2, `/.well-known/tdmrep.json` 1, `/license.xml` 1 | 2026-08-23T16:22:42Z | 2026-08-31T22:35:51Z |
| openai | user | 1 | `/tdm-policy/` 1 | 2026-08-26T06:19:50Z | 2026-08-26T06:19:50Z |
| openai | train | 1 | `/.well-known/tdmrep.json` 1 | 2026-08-11T00:04:22Z | 2026-08-11T00:04:22Z |
| anthropic | train | 1 | `/license.xml` 1 | 2026-08-11T00:04:22Z | 2026-08-11T00:04:22Z |
| commoncrawl | none | 0 | | | |
| google-ai | none | 0 | | | |

Three limits on this table. Coverage starts 2026-08-11: the rights stream holds
no rows before that date, so nothing can be said about 2026-08-01 to
2026-08-10. The two `train` reads land in the same second as the stream's first
row and may be writes made while it was being set up rather than crawls; treat
them as unconfirmed. The schema-1 records also did not separate a training
crawler reading the terms from a search or user agent fetching them; schema 2
(from September 2026) does.

### A note on identity

The crawling counts in all four records are by claimed user agent: a request
was attributed to a family because its user agent named that family's crawler.
None of August's traffic can be checked against that claim. The site's sensor
began recording Cloudflare's verified-bot category at 2026-09-27T15:49:59Z and
the requesting network on 2026-09-29, both after August ended. Where both were
recorded, most requests naming a training crawler came from networks other
than the named company's and were not verified. August's counts should be read
as requests that claimed to be these crawlers, not as activity of the companies
named. From September 2026, records carry an `identity` block that states this
basis and splits each count into verified, unverified and unverifiable.

### What changed

From September 2026 the site composes schema-2 records: the reservation lists
every version in force during the month with its block and span, rights-file
reads are split into training, retrieval and unlabelled blocks, and the
sensor's rights stream is read per family with the site's own traffic
excluded. `rights-evidence-checks.mjs` verifies both shapes.
