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
  // A record without `schema` is schema 1 (plugin 17.0.0 to 19.9.0, the four
  // August records): its rules stay exactly as they were. Schema 2 (plugin
  // PR #1810) changes what the reservation and the reads claim, so it gets
  // rules of its own; any other value is a shape nobody composes.
  if (!("schema" in p)) schemaOne(p, out);
  else if (p.schema === 2) schemaTwo(p, out);
  else out.push(["schema", `payload.schema is ${JSON.stringify(p.schema)}; only 2 (or no field, schema 1) is known`]);
  return out;
}

function schemaOne(p, out) {
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
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isCount = (v) => Number.isInteger(v) && v >= 0;
const isTime = (v) => typeof v === "string" && !Number.isNaN(Date.parse(v));

// Which purposes each read block may carry. rights_reads is the training
// claim, so `train` only; unlabelled_reads holds the rows with no recorded
// purpose, so `unlabelled` only; retrieval_reads is everything else, never
// training, never unlabelled and never our own ops/dev probes (the plugin
// drops those before counting).
const READ_BLOCKS = [
  ["rights_reads", (k) => k === "train", "only train"],
  ["retrieval_reads", (k) => !["train", "unlabelled", "ops", "dev"].includes(k), "neither train, unlabelled, ops nor dev"],
  ["unlabelled_reads", (k) => k === "unlabelled", "only unlabelled"],
];

function schemaTwo(p, out) {
  const c = p.crawling;
  if (!isObject(c)) out.push(["crawling", "payload.crawling is missing"]);
  else {
    for (const k of ["reads", "train", "by_day", "by_surface", "complete"]) if (!(k in c)) out.push(["crawling", `payload.crawling.${k} is missing`]);
    for (const k of ["reads", "train"]) if (!isCount(c[k])) out.push(["crawling", `payload.crawling.${k} is not a count`]);
    if (isCount(c.reads) && isCount(c.train) && c.train > c.reads) out.push(["crawling", `train (${c.train}) exceeds reads (${c.reads})`]);
    // Schema 2 keys by_surface by purpose first: a flat {surface: count} is
    // schema 1's shape and would hide which purpose did the crawling.
    if ("by_surface" in c && (!isObject(c.by_surface) || !Object.values(c.by_surface).every(isObject))) out.push(["crawling", "payload.crawling.by_surface is not keyed by purpose, then surface"]);
  }

  for (const [block, allowed, rule] of READ_BLOCKS) {
    const b = p[block];
    if (!isObject(b)) { out.push([block, `payload.${block} is missing`]); continue; }
    for (const k of ["reads", "by_purpose", "by_path", "first", "last", "complete"]) if (!(k in b)) out.push([block, `payload.${block}.${k} is missing`]);
    if ("reads" in b && !isCount(b.reads)) out.push([block, `payload.${block}.reads is not a count`]);
    if ("by_purpose" in b && (!isObject(b.by_purpose) || !Object.values(b.by_purpose).every(isCount))) out.push([block, `payload.${block}.by_purpose is not purpose to count`]);
    if ("by_path" in b && (!isObject(b.by_path) || !Object.values(b.by_path).every((paths) => isObject(paths) && Object.values(paths).every(isCount)))) out.push([block, `payload.${block}.by_path is not purpose, then path, to count`]);
    for (const k of ["first", "last"]) if (k in b && typeof b[k] !== "string") out.push([block, `payload.${block}.${k} is not a string`]);
    if ("complete" in b && typeof b.complete !== "boolean") out.push([block, `payload.${block}.complete is not a boolean`]);
    const stray = isObject(b.by_purpose) ? Object.keys(b.by_purpose).filter((k) => !allowed(k)) : [];
    if (stray.length) out.push([block, `payload.${block}.by_purpose carries ${stray.join(", ")}; it may carry ${rule}`]);
  }

  // The reservation IN FORCE: every version of every signal that held at any
  // point of the month, each with its anchor block and the span it held for.
  // A version is in force from its anchor (valid_from) until the next
  // version's anchor (valid_to, null while it is still current), so one that
  // starts after the window ends or stops before it starts is not evidence of
  // anything this month reserved.
  const r = p.reservation;
  if (!isObject(r)) { out.push(["reservation", "payload.reservation is missing"]); }
  else {
    const w = r.window;
    const windowOk = isObject(w) && isTime(w.start) && isTime(w.end) && Date.parse(w.start) <= Date.parse(w.end);
    if (!windowOk) out.push(["reservation", `payload.reservation.window is not a {start, end} span: ${JSON.stringify(w ?? null)}`]);
    const signals = r.signals;
    if (!isObject(signals) || Object.keys(signals).length === 0) out.push(["reservation", "payload.reservation.signals is empty: a record without the reservation is half an evidence"]);
    else for (const [slug, list] of Object.entries(signals)) {
      if (!Array.isArray(list) || list.length === 0) { out.push(["reservation", `signal ${slug} lists no version in force`]); continue; }
      let prev = 0;
      for (const v of list) {
        const at = `signal ${slug} v${v?.version}`;
        if (!Number.isInteger(v?.version) || v.version < 1) { out.push(["reservation", `signal ${slug} has a version that is not a positive integer: ${JSON.stringify(v)}`]); continue; }
        if (v.version <= prev) out.push(["reservation", `${at} is out of order: versions must be distinct and ascending`]);
        prev = Math.max(prev, v.version);
        if (!/^[0-9a-f]{64}$/.test(String(v.content_hash ?? ""))) out.push(["reservation", `${at} has no sha256 content_hash`]);
        if (!Number.isInteger(v.block)) out.push(["reservation", `${at} names no anchor block`]);
        if (!isTime(v.valid_from)) { out.push(["reservation", `${at} has no valid_from time`]); continue; }
        if (v.valid_to !== null && !isTime(v.valid_to)) { out.push(["reservation", `${at} has a valid_to that is neither a time nor null`]); continue; }
        if (v.valid_to !== null && Date.parse(v.valid_to) < Date.parse(v.valid_from)) out.push(["reservation", `${at} ends (${v.valid_to}) before it starts (${v.valid_from})`]);
        if (windowOk && (Date.parse(v.valid_from) > Date.parse(w.end) || (v.valid_to !== null && Date.parse(v.valid_to) < Date.parse(w.start)))) out.push(["reservation", `${at} was not in force during ${w.start} to ${w.end}`]);
      }
    }
  }

  // Schema 2 names the taxonomy it counted under: purposes are the
  // taxonomy's verdicts, so a count without it cannot be re-read.
  if (!isObject(p.sensor) || !("version" in p.sensor)) out.push(["sensor", "payload.sensor.version is missing"]);
  if (typeof p.sensor?.taxonomy !== "string" || p.sensor.taxonomy === "") out.push(["sensor", "payload.sensor.taxonomy is not a non-empty string"]);
}
