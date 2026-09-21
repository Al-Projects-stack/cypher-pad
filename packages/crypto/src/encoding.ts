// Encoding helpers plus randomness plus memory hygiene
// Bytes use base64url text for transport to server

export function getSubtle(): SubtleCrypto {
  const g = globalThis as unknown as { crypto?: Crypto };
  const subtle = g.crypto?.subtle;
  if (!subtle) {
    throw new Error('WebCrypto subtle is unavailable in this runtime');
  }
  return subtle;
}

export function randomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length <= 0) {
    throw new Error('Length must be a positive integer');
  }
  const out = new Uint8Array(length);
  const g = globalThis as unknown as { crypto?: Crypto };
  if (!g.crypto?.getRandomValues) {
    throw new Error('Secure randomness is unavailable in this runtime');
  }
  g.crypto.getRandomValues(out);
  return out;
}

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64Encode(bytes: Uint8Array): string {
  let s = '';
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    const b0 = bytes[i] ?? 0;
    const b1 = i + 1 < n ? (bytes[i + 1] ?? 0) : 0;
    const b2 = i + 2 < n ? (bytes[i + 2] ?? 0) : 0;
    const t0 = b0 >> 2;
    const t1 = ((b0 & 3) << 4) | (b1 >> 4);
    const t2 = ((b1 & 15) << 2) | (b2 >> 6);
    const t3 = b2 & 63;
    s += B64_CHARS[t0] ?? '';
    s += B64_CHARS[t1] ?? '';
    s += i + 1 < n ? (B64_CHARS[t2] ?? '') : '=';
    s += i + 2 < n ? (B64_CHARS[t3] ?? '') : '=';
    i += 3;
  }
  return s;
}

export function base64Decode(s: string): Uint8Array {
  const clean = s.replace(/\s+/g, '');
  if (clean.length % 4 !== 0) {
    throw new Error('Invalid base64 length');
  }
  const rev = new Map<string, number>();
  for (let i = 0; i < 64; i++) {
    rev.set(B64_CHARS[i] ?? '', i);
  }
  let pad = 0;
  if (clean.endsWith('==')) pad = 2;
  else if (clean.endsWith('=')) pad = 1;
  const outLen = (clean.length / 4) * 3 - pad;
  const out = new Uint8Array(outLen);
  let j = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = clean[i] ?? '';
    const c1 = clean[i + 1] ?? '';
    const c2 = clean[i + 2] ?? '';
    const c3 = clean[i + 3] ?? '';
    if (c0 === '=' || c1 === '=') {
      throw new Error('Invalid base64 padding');
    }
    const v0 = rev.get(c0);
    const v1 = rev.get(c1);
    const v2 = c2 === '=' ? 0 : rev.get(c2);
    const v3 = c3 === '=' ? 0 : rev.get(c3);
    if (v0 === undefined || v1 === undefined || v2 === undefined || v3 === undefined) {
      throw new Error('Invalid base64 character');
    }
    const b0 = (v0 << 2) | (v1 >> 4);
    out[j++] = b0;
    if (c2 !== '=') {
      out[j++] = ((v1 & 15) << 4) | (v2 >> 2);
    }
    if (c3 !== '=') {
      out[j++] = ((v2 & 3) << 6) | v3;
    }
  }
  return out;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  return base64Encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlDecode(s: string): Uint8Array {
  const clean = s.replace(/\s+/g, '');
  let b64 = clean.replace(/-/g, '+').replace(/_/g, '/');
  const mod = b64.length % 4;
  if (mod === 2) b64 += '==';
  else if (mod === 3) b64 += '=';
  else if (mod !== 0) {
    throw new Error('Invalid base64url length');
  }
  return base64Decode(b64);
}

export function clearBytes(b: Uint8Array): void {
  b.fill(0);
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

export function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function utf8Decode(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}

export function hexEncode(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}

export function hexDecode(s: string): Uint8Array {
  const clean = s.replace(/\s+/g, '').toLowerCase();
  if (clean.length % 2 !== 0) {
    throw new Error('Invalid hex length');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const pair = clean.slice(i * 2, i * 2 + 2);
    const v = Number.parseInt(pair, 16);
    if (Number.isNaN(v)) {
      throw new Error('Invalid hex character');
    }
    out[i] = v;
  }
  return out;
}
