// Recovery key encoding plus vault wrap for account recovery
// Crockford Base32 keeps text readable and avoids confusable symbols
// Check symbol catches typos before any unwrap attempt

import { getSubtle, randomBytes, utf8Encode } from './encoding.js';
import { wrapVaultKey, unwrapVaultKey } from './vault.js';
import type { WrappedKeyBundle } from './types.js';

export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const RECOVERY_INFO = 'cipherpad/recovery/v1';
export const RECOVERY_AUTH_INFO = 'cipherpad/recovery/auth/v1';
const RECOVERY_BYTES = 16;

function crockfordValue(ch: string): number {
  const idx = CROCKFORD_ALPHABET.indexOf(ch);
  return idx;
}

export function encodeCrockford(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CROCKFORD_ALPHABET[(value >> bits) & 31];
    }
  }
  if (bits > 0) {
    out += CROCKFORD_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

export function decodeCrockford(text: string, expectedBytes: number): Uint8Array {
  let value = 0;
  let bits = 0;
  const out: number[] = [];
  for (const ch of text) {
    const v = crockfordValue(ch);
    if (v < 0) throw new Error('Invalid recovery character');
    value = (value << 5) | v;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((value >> bits) & 255);
    }
  }
  if (bits >= 5) throw new Error('Invalid recovery length');
  if (bits > 0) {
    const mask = (1 << bits) - 1;
    if ((value & mask) !== 0) throw new Error('Invalid recovery padding');
  }
  if (out.length !== expectedBytes) throw new Error('Invalid recovery size');
  return new Uint8Array(out);
}

export function normalizeRecoveryInput(input: string): string {
  const upper = input.toUpperCase().replace(/\s+/g, '');
  let s = '';
  for (const ch of upper) {
    if (ch === 'I' || ch === 'L') s += '1';
    else if (ch === 'O') s += '0';
    else s += ch;
  }
  return s;
}

export function groupRecoveryText(chars: string): string {
  const parts: string[] = [];
  for (let i = 0; i < chars.length; i += 9) {
    parts.push(chars.slice(i, i + 9));
  }
  return parts.join(' ');
}

async function computeCheckChar(entropy: Uint8Array): Promise<string> {
  const subtle = getSubtle();
  const digest = new Uint8Array(await subtle.digest('SHA-256', entropy as unknown as BufferSource));
  const v = (digest[0] ?? 0) & 31;
  return CROCKFORD_ALPHABET[v] ?? '0';
}

export async function generateRecoveryKey(): Promise<{ recoveryKeyText: string; recoveryKeyBytes: Uint8Array }> {
  const entropy = randomBytes(RECOVERY_BYTES);
  const dataChars = encodeCrockford(entropy);
  if (dataChars.length !== 26) throw new Error('Internal encoding fault');
  const check = await computeCheckChar(entropy);
  const full = dataChars + check;
  const recoveryKeyBytes = new Uint8Array(entropy);
  return { recoveryKeyText: groupRecoveryText(full), recoveryKeyBytes };
}

export async function parseRecoveryKey(input: string): Promise<Uint8Array> {
  const clean = normalizeRecoveryInput(input);
  if (clean.length !== 26 && clean.length !== 27) {
    throw new Error('Recovery text has wrong length');
  }
  for (const ch of clean) {
    if (crockfordValue(ch) < 0) throw new Error('Recovery text has invalid symbols');
  }
  const dataChars = clean.slice(0, 26);
  const entropy = decodeCrockford(dataChars, RECOVERY_BYTES);
  if (clean.length === 27) {
    const expected = await computeCheckChar(entropy);
    const given = clean[26] ?? '';
    if (given !== expected) {
      throw new Error('Recovery check symbol mismatch');
    }
  }
  return entropy;
}

async function recoveryAesKey(recoveryKeyBytes: Uint8Array): Promise<CryptoKey> {
  if (recoveryKeyBytes.length !== RECOVERY_BYTES) throw new Error('Recovery key size mismatch');
  const subtle = getSubtle();
  const base = await subtle.importKey('raw', recoveryKeyBytes as unknown as BufferSource, 'HKDF', false, [
    'deriveKey'
  ]);
  const emptySalt = new Uint8Array(0);
  return subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: emptySalt as unknown as BufferSource,
      info: utf8Encode(RECOVERY_INFO) as unknown as BufferSource
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function wrapVaultWithRecovery(
  recoveryKeyBytes: Uint8Array,
  rawVaultKey: Uint8Array
): Promise<WrappedKeyBundle> {
  const aes = await recoveryAesKey(recoveryKeyBytes);
  return wrapVaultKey(aes, rawVaultKey);
}

export async function unwrapVaultWithRecovery(
  recoveryKeyBytes: Uint8Array,
  wrapped: WrappedKeyBundle
): Promise<{ rawVaultKey: Uint8Array; vaultKey: CryptoKey }> {
  const aes = await recoveryAesKey(recoveryKeyBytes);
  const res = await unwrapVaultKey(aes, wrapped);
  return { rawVaultKey: res.rawVaultKey, vaultKey: res.vaultKey };
}

export async function deriveRecoveryAuthKey(recoveryKeyBytes: Uint8Array): Promise<Uint8Array> {
  if (recoveryKeyBytes.length !== RECOVERY_BYTES) throw new Error('Recovery key size mismatch');
  const subtle = getSubtle();
  const base = await subtle.importKey('raw', recoveryKeyBytes as unknown as BufferSource, 'HKDF', false, [
    'deriveBits'
  ]);
  const emptySalt = new Uint8Array(0);
  const bits = await subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: emptySalt as unknown as BufferSource,
      info: utf8Encode(RECOVERY_AUTH_INFO) as unknown as BufferSource
    },
    base,
    256
  );
  return new Uint8Array(bits);
}
