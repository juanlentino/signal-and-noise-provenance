// Minimal, dependency-free OpenTimestamps READER — just enough to pull the
// Bitcoin block a proof commits to. Vendored from the sn-provenance Worker's
// ots.mjs (the write/upgrade half is omitted; a verifier only reads). Web Crypto
// + typed arrays only, so it runs in Node and the browser with no install.
//
// Format refs: python-opentimestamps timestamp.py / op.py / notary.py.

const enc = new TextEncoder();

export const HEADER_MAGIC = new Uint8Array([
  0x00, ...enc.encode("OpenTimestamps"), 0x00, 0x00,
  ...enc.encode("Proof"), 0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94,
]); // 31 bytes

const OP_SHA256  = 0x08;
const OP_APPEND  = 0xf0;
const OP_PREPEND = 0xf1;
export const ATT_BITCOIN = "0588960d73d71901";

const concatBytes = (arrs) => {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
};
export const toHex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
const bytesEqual = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

/** Return the SHA-256 digest named in the detached proof header. */
export function stampedDigest(otsBytes) {
  if (otsBytes.length < HEADER_MAGIC.length + 34) throw new Error("truncated OTS proof");
  if (!bytesEqual(otsBytes.slice(0, HEADER_MAGIC.length), HEADER_MAGIC)) throw new Error("invalid OTS header");
  const version = otsBytes[HEADER_MAGIC.length];
  const fileHashOp = otsBytes[HEADER_MAGIC.length + 1];
  if (version !== 1 || fileHashOp !== OP_SHA256) throw new Error("unsupported OTS version or file-hash operation");
  return otsBytes.slice(HEADER_MAGIC.length + 2, HEADER_MAGIC.length + 34);
}

function readVaruint(buf, cur) {
  let result = 0, shift = 0, b;
  do { b = buf[cur.i++]; result += (b & 0x7f) * Math.pow(2, shift); shift += 7; } while (b & 0x80);
  return result;
}

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

function applyOp(opTag, arg, msg) {
  if (opTag === OP_APPEND)  return concatBytes([msg, arg]);
  if (opTag === OP_PREPEND) return concatBytes([arg, msg]);
  throw new Error(`unsupported op 0x${opTag.toString(16)}`);
}

// Walk the serialized Timestamp, collecting every attestation as
// { attTag, commitment } — the running message at each attestation node.
async function parseAttestations(otsBytes) {
  const digest = stampedDigest(otsBytes);
  let i = HEADER_MAGIC.length + 34;
  const cur = { i };
  const attestations = [];

  async function walk(msg) {
    let tag = otsBytes[cur.i++];
    for (;;) {
      const terminal = tag !== 0xff;
      const marker = terminal ? tag : otsBytes[cur.i++];
      if (marker === 0x00) {
        const attTag = toHex(otsBytes.slice(cur.i, cur.i + 8)); cur.i += 8;
        const len = readVaruint(otsBytes, cur);
        const payload = otsBytes.slice(cur.i, cur.i + len); cur.i += len;
        attestations.push({ attTag, commitment: msg, payload });
      } else {
        let arg = new Uint8Array(0);
        if (marker === OP_APPEND || marker === OP_PREPEND) {
          const len = readVaruint(otsBytes, cur);
          arg = otsBytes.slice(cur.i, cur.i + len); cur.i += len;
        }
        const next = marker === OP_SHA256 ? await sha256(msg) : applyOp(marker, arg, msg);
        await walk(next);
      }
      if (terminal) break;
      tag = otsBytes[cur.i++];
    }
  }

  await walk(digest);
  return attestations;
}

// Every Bitcoin block a proof commits to, as { height, merkleRoot } with
// merkleRoot in display (big-endian) hex, directly comparable to a block
// explorer's `merkle_root`. The OTS running message at the attestation is the
// merkle root in Bitcoin's internal little-endian order, so it is byte-reversed
// here. Empty when the proof carries no BitcoinBlockHeaderAttestation yet.
//
// Since sn-provenance 1.20.0 a digest goes to every calendar and the proof
// forks at the root, so a proof can carry SEVERAL Bitcoin attestations (one per
// calendar that aggregated it, in different blocks: tdm-policy v8 commits to
// 967489 and 967491). Each is a genuine anchor of the same digest.
export async function bitcoinAttestations(otsBytes) {
  const atts = await parseAttestations(otsBytes);
  return atts
    .filter((a) => a.attTag === ATT_BITCOIN)
    .map((a) => ({ height: readVaruint(a.payload, { i: 0 }), merkleRoot: toHex(a.commitment.slice().reverse()) }))
    .sort((a, b) => a.height - b.height);
}

// The ONE block to cite for a proof: the attestation at `preferHeight` when the
// proof carries it (the block the record names), else the earliest, which is
// the strongest "existed by" claim. null while the proof is pending.
export async function bitcoinAttestation(otsBytes, preferHeight = null) {
  const all = await bitcoinAttestations(otsBytes);
  if (!all.length) return null;
  return all.find((a) => a.height === preferHeight) ?? all[0];
}
