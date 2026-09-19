// The rights-evidence rules, in a module of their own so they can be tested
// offline (the same split retraction-checks.mjs records: a check reachable
// only through a filesystem walk and Ed25519 verification is a check with no
// test).
//
// A rights-evidence record is one month of one crawler family, composed by
// the site from its edge sensor (plugin 17.0.0) and signed through the
// ordinary webhook (worker 1.21.0), so its envelope is a Note's: the
// signature and the hash are over canonical(payload). What is checked here
// is the CLAIM: the record is filed under the id its own contents derive,
// names the site, the month and the kind it says it does, and carries the
// counts a reader would cite.

const RFC4122_URL_NS = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hexOf = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * The id a record's contents derive: UUIDv5 over the RFC 4122 URL namespace of
 * `<site>/rights-evidence/<family>/<month>`. The same derivation the plugin
 * performs (sn_rights_evidence_uuid), so a record filed under another id is a
 * record about something else.
 */
export async function evidenceUuid(site, family, month) {
  const ns = Uint8Array.from(Buffer.from(RFC4122_URL_NS.replace(/-/g, ""), "hex"));
  const name = new TextEncoder().encode(`${String(site).replace(/\/+$/, "")}/rights-evidence/${family}/${month}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", new Uint8Array([...ns, ...name])));
  const b = digest.slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = hexOf(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Everything wrong with one rights-evidence record's CLAIM, as
 * [problem, detail] pairs. Empty means it holds. Signature, hash and OTS are
 * the runner's job (verifyRecord); this looks at the payload.
 *
 * @param {object} record The parsed record.
 * @param {{uid: string, version: number, host: string}} ctx The directory it sits in and the site host.
 */
export async function evidenceDivergences(record, ctx) {
  const p = (record && record.payload) || {};
  const out = [];
  if (p.kind !== "rights-evidence") out.push(["kind", `payload.kind is ${JSON.stringify(p.kind ?? null)}`]);
  if (!/^[a-z0-9-]{1,48}$/.test(String(p.family ?? ""))) out.push(["family", `payload.family is ${JSON.stringify(p.family ?? null)}`]);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(p.month ?? ""))) out.push(["month", `payload.month is ${JSON.stringify(p.month ?? null)}`]);
  const site = URL.canParse(p.site ?? "") ? new URL(p.site) : null;
  if (!site || site.protocol !== "https:" || site.hostname !== ctx.host) out.push(["site", `payload.site is ${JSON.stringify(p.site ?? null)}, not an https URL on ${ctx.host}`]);
  if (!UUID_RE.test(ctx.uid)) out.push(["id", `directory ${ctx.uid} is not a UUIDv5`]);
  else if (out.length === 0) {
    const expected = await evidenceUuid(p.site, p.family, p.month);
    if (expected !== ctx.uid) out.push(["id", `filed under ${ctx.uid}; the site, family and month derive ${expected}`]);
  }
  if (ctx.version !== 1) out.push(["version", `v${ctx.version}: a month's record is minted once; a correction is a retraction, never a v2`]);
  for (const [block, keys] of [["crawling", ["reads", "train", "by_day", "by_surface", "complete"]], ["rights_reads", ["reads", "by_path", "first", "last", "complete"]], ["reservation", ["as_of", "signals"]]]) {
    const b = p[block];
    if (!b || typeof b !== "object" || Array.isArray(b)) { out.push([block, `payload.${block} is missing`]); continue; }
    for (const k of keys) if (!(k in b)) out.push([block, `payload.${block}.${k} is missing`]);
  }
  const signals = p.reservation?.signals;
  if (!Array.isArray(signals) || signals.length === 0) out.push(["reservation", "payload.reservation.signals is empty: a record without the reservation is half an evidence"]);
  else for (const s of signals) {
    if (typeof s?.slug !== "string" || !/^[0-9a-f]{64}$/.test(String(s?.content_hash ?? ""))) out.push(["reservation", `a signal without a slug and a sha256 content_hash: ${JSON.stringify(s)}`]);
  }
  for (const k of ["reads", "train"]) if (!Number.isInteger(p.crawling?.[k]) || p.crawling[k] < 0) out.push(["crawling", `payload.crawling.${k} is not a count`]);
  if (Number.isInteger(p.crawling?.reads) && Number.isInteger(p.crawling?.train) && p.crawling.train > p.crawling.reads) out.push(["crawling", `train (${p.crawling.train}) exceeds reads (${p.crawling.reads})`]);
  return out;
}
