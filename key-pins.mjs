// The HTTPS key mirror's expected shape, kept in a module of its own so it can
// be tested offline. verify-key-pins.mjs is a runner: it resolves DNS, fetches
// the live document, and hands the result here. Splitting them (2026-08-11) is
// the direct fix for how the v1 -> v2 skew shipped unnoticed — the comparison
// was unreachable from a test because reaching it meant a DNS lookup and a
// network fetch, so it had none.

/**
 * The schema the mirror is expected to serve.
 *
 * Bumped v1 -> v2 on 2026-08-11, following the plugin (v10.77.0, "key history
 * with a future") which added a per-key validity window and an optional
 * next_key_commitment to the served document. Deliberately a SINGLE accepted
 * version rather than an allow-list: this repo is the trust root's mirror, and
 * "either shape is fine" is how a downgrade goes unremarked.
 */
export const KEY_MIRROR_SCHEMA = "sn-provenance-keys-v2";

/**
 * Compare the served key document against the key history, field by field.
 *
 * An 8-way `||` throwing one opaque string told you a mismatch existed but not
 * WHICH field or what arrived — so when a runner hit this on 2026-08-03 while
 * the same document verified perfectly from a residential IP, the log could not
 * say whether the mirror was wrong or the edge had served something else.
 *
 * @param {object|null} document The parsed mirror document.
 * @param {object} current The active entry from keys/key-history.json.
 * @returns {Array<[string, unknown, unknown]>} [field, actual, expected] per divergence.
 */
export function keyPinDivergences(document, current) {
  const mirrored = document?.keys?.find((key) => key.id === current.id);

  return [
    ["schema", document?.schema, KEY_MIRROR_SCHEMA],
    ["domain", document?.domain, "juanlentino.com"],
    [`keys[id=${current.id}]`, mirrored ? "present" : "ABSENT", "present"],
    ...(mirrored ? [
      ["algorithm", mirrored.algorithm, current.algorithm],
      ["public_key_base64", mirrored.public_key_base64, current.public_key_base64],
      ["sha256_fingerprint", mirrored.sha256_fingerprint, current.sha256_fingerprint],
      ["status", mirrored.status, current.status],
      ["introduced_at", mirrored.introduced_at, current.introduced_at],
      // The window v2 exists to carry. Checking the version string alone would
      // acknowledge the new fields without verifying a single one of them.
      ["valid_from", mirrored.valid_from, current.introduced_at],
      // The key we are still signing with has an OPEN window by definition; a
      // date here contradicts status:"active" rather than refining it. Absent
      // is reported as absent — collapsing it to null would let a mirror that
      // dropped the field pass as though it had declared an open window.
      [
        "valid_until",
        "valid_until" in mirrored ? mirrored.valid_until : "ABSENT",
        null,
      ],
    ] : []),
  ].filter(([, actual, expected]) => actual !== expected);
}
