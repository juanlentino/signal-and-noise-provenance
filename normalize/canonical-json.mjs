// Deterministic JSON, mirroring inc/provenance-core.php sn_prov_canonical_json()
// byte-for-byte: recursively sort object keys (byte/string order), compact,
// UTF-8, slashes and non-ASCII characters emitted raw (unescaped). List
// arrays are left in their original order — only plain-object keys are
// sorted. Object keys MUST stay ASCII and non-numeric (same constraint the
// PHP source documents), since JS engines reorder integer-like string keys
// ahead of other keys regardless of insertion/sort order.
//
// JS's JSON.stringify() already emits forward slashes and non-ASCII
// characters unescaped by default, matching PHP's
// JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE flags, so no extra
// post-processing is needed for those two — only the key-sort step below is
// PHP-specific behavior we have to replicate.
export function canonicalize(obj) {
  return JSON.stringify(sortKeysRecursive(obj));
}

function sortKeysRecursive(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeysRecursive);
  }
  if (value !== null && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort(compareByteOrder)) {
      sorted[key] = sortKeysRecursive(value[key]);
    }
    return sorted;
  }
  return value;
}

// PHP's ksort($data, SORT_STRING) compares keys byte-by-byte (ordinal). JS's
// default `<`/`>` string comparison does the same UTF-16-code-unit ordering
// for the ASCII-only keys this payload's contract requires, so a plain
// comparator is sufficient here.
function compareByteOrder(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
