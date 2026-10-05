// OpenSSH signatures (`ssh-keygen -Y sign`), verified offline.
//
// The author's key is an Ed25519 SSH key the author holds; it never signs
// raw bytes. `ssh-keygen -Y sign` wraps the message (PROTOCOL.sshsig):
//
//   signed = "SSHSIG" || string(namespace) || string(reserved)
//            || string(hash_algorithm) || string(H(message))
//
// and the Ed25519 signature is over `signed`, not over the message. The
// namespace is domain separation: a signature made for this ledger cannot be
// replayed as a git commit signature, or the other way round.
//
// Only `ssh-ed25519` keys are accepted. A security key (sk-ssh-ed25519) or
// any other algorithm is refused rather than half-understood.

import { createHash } from "node:crypto";

export const SSHSIG_NAMESPACE = "sn-provenance@juanlentino.com";
const MAGIC = new TextEncoder().encode("SSHSIG");
const enc = new TextEncoder();

/** Read one SSH wire `string` (uint32 length + bytes) at `at`. */
function readString(bytes, at) {
  if (at + 4 > bytes.length) throw new Error("truncated SSH string length");
  const len = new DataView(bytes.buffer, bytes.byteOffset + at, 4).getUint32(0);
  const end = at + 4 + len;
  if (end > bytes.length) throw new Error("truncated SSH string");
  return { value: bytes.subarray(at + 4, end), next: end };
}

const sshString = (bytes) => {
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length);
  out.set(bytes, 4);
  return out;
};
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
const text = (bytes) => new TextDecoder().decode(bytes);
const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/** The raw 32-byte key inside an `ssh-ed25519` public key blob. */
function ed25519FromBlob(blob) {
  const type = readString(blob, 0);
  if (text(type.value) !== "ssh-ed25519") throw new Error(`unsupported key type ${JSON.stringify(text(type.value))}`);
  const key = readString(blob, type.next);
  if (key.value.length !== 32 || key.next !== blob.length) throw new Error("malformed ssh-ed25519 key");
  return key.value;
}

/** Raw 32-byte key from an `ssh-ed25519 AAAA… comment` public key line. */
export function ed25519FromSshPublicKey(line) {
  const [type, b64] = String(line).trim().split(/\s+/);
  if (type !== "ssh-ed25519" || !b64) throw new Error("expected an ssh-ed25519 public key line");
  return ed25519FromBlob(Uint8Array.from(Buffer.from(b64, "base64")));
}

/**
 * Parse an armored or bare-base64 SSHSIG into its fields. Throws on anything
 * that is not a version-1 ssh-ed25519 signature.
 */
export function parseSshSig(sig) {
  const b64 = String(sig)
    .replace(/-----(BEGIN|END) SSH SIGNATURE-----/g, "")
    .replace(/\s+/g, "");
  const bytes = Uint8Array.from(Buffer.from(b64, "base64"));
  if (!equal(bytes.subarray(0, 6), MAGIC)) throw new Error("not an SSHSIG blob");
  if (new DataView(bytes.buffer, bytes.byteOffset + 6, 4).getUint32(0) !== 1) throw new Error("unsupported SSHSIG version");
  const pub = readString(bytes, 10);
  const ns = readString(bytes, pub.next);
  const reserved = readString(bytes, ns.next);
  const hash = readString(bytes, reserved.next);
  const sigBlob = readString(bytes, hash.next);
  if (sigBlob.next !== bytes.length) throw new Error("trailing bytes after SSHSIG");
  const sigType = readString(sigBlob.value, 0);
  if (text(sigType.value) !== "ssh-ed25519") throw new Error(`unsupported signature type ${JSON.stringify(text(sigType.value))}`);
  const raw = readString(sigBlob.value, sigType.next);
  if (raw.value.length !== 64) throw new Error("malformed Ed25519 signature");
  return {
    publicKey: ed25519FromBlob(pub.value),
    namespace: text(ns.value),
    reserved: reserved.value,
    hashAlgorithm: text(hash.value),
    signature: raw.value,
  };
}

/**
 * Does `sig` sign `message` under `publicKey` (raw 32 bytes) and `namespace`?
 * Returns { ok, reason }; never throws on a bad signature.
 */
export async function verifySshSig({ message, sig, publicKey, namespace = SSHSIG_NAMESPACE }) {
  let parsed;
  try { parsed = parseSshSig(sig); } catch (error) { return { ok: false, reason: error.message }; }
  if (!equal(parsed.publicKey, publicKey)) return { ok: false, reason: "signed by a different key" };
  if (parsed.namespace !== namespace) return { ok: false, reason: `namespace ${JSON.stringify(parsed.namespace)}, expected ${JSON.stringify(namespace)}` };
  if (!["sha256", "sha512"].includes(parsed.hashAlgorithm)) return { ok: false, reason: `unsupported hash ${parsed.hashAlgorithm}` };
  const digest = createHash(parsed.hashAlgorithm).update(message).digest();
  const signed = concat(MAGIC, sshString(enc.encode(namespace)), sshString(parsed.reserved), sshString(enc.encode(parsed.hashAlgorithm)), sshString(digest));
  const key = await crypto.subtle.importKey("raw", publicKey, { name: "Ed25519" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("Ed25519", key, parsed.signature, signed);
  return ok ? { ok: true, reason: null } : { ok: false, reason: "signature does not verify" };
}
