// Vault creation plus wrap plus unwrap
// Raw vault bytes exist only briefly then are cleared by caller
// Stored vault keys stay non extractable for session use

import { getSubtle, randomBytes } from './encoding.js';
import type { WrappedKeyBundle } from './types.js';

export async function importVaultKey(rawVaultKey: Uint8Array): Promise<CryptoKey> {
  if (rawVaultKey.length !== 32) throw new Error('Vault key size mismatch');
  const subtle = getSubtle();
  return subtle.importKey('raw', rawVaultKey as unknown as BufferSource, 'HKDF', false, ['deriveBits', 'deriveKey']);
}

export async function wrapVaultKey(kek: CryptoKey, rawVaultKey: Uint8Array): Promise<WrappedKeyBundle> {
  if (rawVaultKey.length !== 32) throw new Error('Vault key size mismatch');
  const subtle = getSubtle();
  const iv = randomBytes(12);
  const data = new Uint8Array(
    await subtle.encrypt({ name: 'AES-GCM', iv: iv as unknown as BufferSource }, kek, rawVaultKey as unknown as BufferSource)
  );
  return { iv, data, version: 1 };
}

export async function unwrapVaultKey(
  kek: CryptoKey,
  wrapped: WrappedKeyBundle
): Promise<{ rawVaultKey: Uint8Array; vaultKey: CryptoKey }> {
  if (wrapped.version !== 1) throw new Error('Unsupported wrapped key version');
  if (wrapped.iv.length !== 12) throw new Error('Invalid wrap IV size');
  if (wrapped.data.length === 0) throw new Error('Invalid wrapped data');
  const subtle = getSubtle();
  const plain = await subtle.decrypt(
    { name: 'AES-GCM', iv: wrapped.iv as unknown as BufferSource },
    kek,
    wrapped.data as unknown as BufferSource
  );
  const rawVaultKey = new Uint8Array(plain);
  if (rawVaultKey.length !== 32) throw new Error('Unwrapped vault size mismatch');
  const vaultKey = await importVaultKey(rawVaultKey);
  return { rawVaultKey, vaultKey };
}

export async function createVault(kek: CryptoKey): Promise<{
  rawVaultKey: Uint8Array;
  vaultKey: CryptoKey;
  wrappedVaultKey: WrappedKeyBundle;
}> {
  const rawVaultKey = randomBytes(32);
  const wrappedVaultKey = await wrapVaultKey(kek, rawVaultKey);
  const vaultKey = await importVaultKey(rawVaultKey);
  return { rawVaultKey, vaultKey, wrappedVaultKey };
}
