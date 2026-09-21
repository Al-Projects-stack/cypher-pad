// Known vectors for primitives in use
// Prose in this file avoids dash characters per project docs rule

import { describe, expect, it } from 'vitest';
import { getSubtle, hexDecode, hexEncode, utf8Encode } from '../src/encoding.js';

describe('PBKDF2 SHA256 vectors', () => {
  it('matches RFC test with one iteration', async () => {
    const subtle = getSubtle();
    const base = await subtle.importKey('raw', utf8Encode('password') as unknown as BufferSource, 'PBKDF2', false, ['deriveBits']);
    const bits = await subtle.deriveBits(
      { name: 'PBKDF2', salt: utf8Encode('salt') as unknown as BufferSource, iterations: 1, hash: 'SHA-256' },
      base,
      256
    );
    expect(hexEncode(new Uint8Array(bits))).toBe('120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b');
  });

  it('matches RFC test with two iterations', async () => {
    const subtle = getSubtle();
    const base = await subtle.importKey('raw', utf8Encode('password') as unknown as BufferSource, 'PBKDF2', false, ['deriveBits']);
    const bits = await subtle.deriveBits(
      { name: 'PBKDF2', salt: utf8Encode('salt') as unknown as BufferSource, iterations: 2, hash: 'SHA-256' },
      base,
      256
    );
    expect(hexEncode(new Uint8Array(bits))).toBe('ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43');
  });
});

describe('HKDF SHA256 vectors', () => {
  it('matches RFC5869 case one', async () => {
    const subtle = getSubtle();
    const ikm = new Uint8Array(22).fill(11);
    const salt = hexDecode('000102030405060708090a0b0c');
    const info = hexDecode('f0f1f2f3f4f5f6f7f8f9');
    const base = await subtle.importKey('raw', ikm as unknown as BufferSource, 'HKDF', false, ['deriveBits']);
    const bits = await subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: salt as unknown as BufferSource, info: info as unknown as BufferSource },
      base,
      42 * 8
    );
    expect(hexEncode(new Uint8Array(bits))).toBe(
      '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865'
    );
  });
});

describe('AES GCM vectors', () => {
  it('matches NIST zero key vector', async () => {
    const subtle = getSubtle();
    const keyBytes = new Uint8Array(16);
    const iv = new Uint8Array(12);
    const plain = new Uint8Array(16);
    const key = await subtle.importKey('raw', keyBytes as unknown as BufferSource, 'AES-GCM', false, [
      'encrypt'
    ]);
    const out = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: iv as unknown as BufferSource }, key, plain as unknown as BufferSource));
    expect(hexEncode(out)).toBe('0388dace60b6a392f328c2b971b2fe78ab6e47d42cec13bdf53a67b21257bddf');
  });
});
