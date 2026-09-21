// Password to master to auth plus kek
// Master stays non extractable to limit exposure in memory
// Auth is exportable bytes for server proof then cleared

import { clearBytes, getSubtle, randomBytes, base64UrlEncode, utf8Encode } from './encoding.js';
import type { KdfParams } from './types.js';

export const DEFAULT_KDF_PARAMS: KdfParams = {
  algorithm: 'PBKDF2',
  hash: 'SHA-256',
  iterations: 600000,
  saltBytes: 16,
  outputBytes: 32,
  version: 1
};

export const AUTH_INFO = 'cipherpad/auth/v1';
export const KEK_INFO = 'cipherpad/kek/v1';

export function generateSalt(length: number = DEFAULT_KDF_PARAMS.saltBytes): Uint8Array {
  if (!Number.isInteger(length) || length < 16 || length > 64) {
    throw new Error('Salt length must be within safe bounds');
  }
  return randomBytes(length);
}

export function validateKdfParams(p: KdfParams): void {
  if (p.algorithm !== 'PBKDF2') throw new Error('Unsupported KDF algorithm');
  if (p.hash !== 'SHA-256') throw new Error('Unsupported KDF hash');
  if (!Number.isInteger(p.iterations) || p.iterations < 1000) {
    throw new Error('Iteration count is too low');
  }
  if (p.saltBytes < 16 || p.saltBytes > 64) throw new Error('Invalid salt size');
  if (p.outputBytes !== 32) throw new Error('Invalid output size');
  if (p.version !== 1) throw new Error('Unsupported KDF version');
}

export async function deriveMasterKey(
  password: string,
  salt: Uint8Array,
  params: KdfParams = DEFAULT_KDF_PARAMS
): Promise<CryptoKey> {
  validateKdfParams(params);
  if (password.length === 0) throw new Error('Password must not be empty');
  if (salt.length !== params.saltBytes) throw new Error('Salt size mismatch');
  const subtle = getSubtle();
  const pwBytes = utf8Encode(password);
  try {
    const base = await subtle.importKey('raw', pwBytes as unknown as BufferSource, 'PBKDF2', false, ['deriveBits']);
    const bits = await subtle.deriveBits(
      { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: params.iterations, hash: params.hash },
      base,
      params.outputBytes * 8
    );
    const master = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveBits', 'deriveKey']);
    return master;
  } finally {
    clearBytes(pwBytes);
  }
}

export async function splitMasterKey(masterKey: CryptoKey): Promise<{ authKey: Uint8Array; kek: CryptoKey }> {
  const subtle = getSubtle();
  const emptySalt = new Uint8Array(0);
  const authBits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: emptySalt as unknown as BufferSource, info: utf8Encode(AUTH_INFO) as unknown as BufferSource },
    masterKey,
    256
  );
  const authKey = new Uint8Array(authBits);
  const kek = await subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: emptySalt as unknown as BufferSource, info: utf8Encode(KEK_INFO) as unknown as BufferSource },
    masterKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  return { authKey, kek };
}

export function encodeAuthKey(authKey: Uint8Array): string {
  if (authKey.length !== 32) throw new Error('Auth key size mismatch');
  return base64UrlEncode(authKey);
}
