// بديل node:crypto باستخدام Web Crypto و @noble/hashes
import { scrypt } from '@noble/hashes/scrypt';
import { sha256 } from '@noble/hashes/sha256';

const B = () => globalThis.Buffer;
const bytes = (v) => (typeof v === 'string' ? new TextEncoder().encode(v) : new Uint8Array(v));

export function randomBytes(n) { return B().from(globalThis.crypto.getRandomValues(new Uint8Array(n))); }
export function randomUUID() { return globalThis.crypto.randomUUID(); }
export function scryptSync(password, salt, keylen, opts = {}) {
  return B().from(scrypt(bytes(password), bytes(salt), { N: opts.N || 16384, r: opts.r || 8, p: opts.p || 1, dkLen: keylen }));
}
export function timingSafeEqual(a, b) {
  if (a.length !== b.length) throw new Error('length mismatch');
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
export function createHash() {
  let data = '';
  const h = {
    update(s) { data += s; return h; },
    digest(enc) { return B().from(sha256(bytes(data))).toString(enc); },
  };
  return h;
}
export default { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash };
