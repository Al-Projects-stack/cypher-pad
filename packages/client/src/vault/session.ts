import {
  base64UrlDecode,
  base64UrlEncode,
  clearBytes,
  createVault,
  deriveMasterKey,
  generateSalt,
  splitMasterKey,
  unwrapVaultKey,
  validateKdfParams,
  type KdfParams
} from '@cipherpad/crypto';
import { DEFAULT_KDF_PARAMS } from '@cipherpad/crypto';
import { readMeta, writeMeta, type CipherpadDb } from '../notes/db.js';

export interface OpenVault {
  ownerId: string;
  vaultKey: CryptoKey;
  rawVaultKey: Uint8Array;
}

export interface VaultMeta {
  ownerId: string;
  salt: string;
  kdfIterations: number;
}

function backingBytes(value: Uint8Array): Uint8Array {
  return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer);
}

export async function hasVault(db: CipherpadDb): Promise<boolean> {
  return (await readMeta(db, 'salt')) !== null;
}

export async function readVaultMeta(db: CipherpadDb): Promise<VaultMeta | null> {
  const ownerId = await readMeta(db, 'ownerId');
  const salt = await readMeta(db, 'salt');
  const kdfIterations = await readMeta(db, 'kdfIterations');
  if (!ownerId || !salt || !kdfIterations) return null;
  return { ownerId, salt, kdfIterations: Number(kdfIterations) };
}

export function checkKdfPinned(pinnedIterations: number, incomingIterations: number): void {
  if (!Number.isInteger(incomingIterations)) throw new Error('KDF params rejected');
  if (incomingIterations < pinnedIterations) throw new Error('KDF params rejected');
}

export async function createVaultLocal(
  db: CipherpadDb,
  password: string,
  kdf: KdfParams = DEFAULT_KDF_PARAMS
): Promise<OpenVault> {
  if (!password) throw new Error('Password is required');
  validateKdfParams(kdf);
  const ownerId = crypto.randomUUID();
  const salt = generateSalt();
  const master = await deriveMasterKey(password, backingBytes(salt), kdf);
  const split = await splitMasterKey(master);
  try {
    const created = await createVault(split.kek);
    const wrapped = created.wrappedVaultKey;
    await writeMeta(db, 'ownerId', ownerId);
    await writeMeta(db, 'salt', base64UrlEncode(backingBytes(salt)));
    await writeMeta(db, 'kdfIterations', String(kdf.iterations));
    await writeMeta(db, 'wrappedVaultIv', base64UrlEncode(backingBytes(wrapped.iv)));
    await writeMeta(db, 'wrappedVaultData', base64UrlEncode(backingBytes(wrapped.data)));
    return { ownerId, vaultKey: created.vaultKey, rawVaultKey: created.rawVaultKey };
  } finally {
    clearBytes(split.authKey);
  }
}

export async function unlockVault(
  db: CipherpadDb,
  password: string,
  kdfOverride?: Partial<KdfParams>
): Promise<OpenVault> {
  if (!password) throw new Error('Password is required');
  const meta = await readVaultMeta(db);
  if (!meta) throw new Error('No vault found');
  const salt = backingBytes(base64UrlDecode(meta.salt));
  const kdf: KdfParams = { ...DEFAULT_KDF_PARAMS, iterations: meta.kdfIterations, ...kdfOverride };
  validateKdfParams(kdf);
  checkKdfPinned(meta.kdfIterations, kdf.iterations);
  const master = await deriveMasterKey(password, salt, kdf);
  const split = await splitMasterKey(master);
  try {
    const iv = backingBytes(base64UrlDecode((await readMeta(db, 'wrappedVaultIv')) ?? ''));
    const data = backingBytes(base64UrlDecode((await readMeta(db, 'wrappedVaultData')) ?? ''));
    const opened = await unwrapVaultKey(split.kek, { iv, data, version: 1 });
    return { ownerId: meta.ownerId, vaultKey: opened.vaultKey, rawVaultKey: opened.rawVaultKey };
  } finally {
    clearBytes(split.authKey);
    clearBytes(salt);
  }
}

export function lockVault(session: OpenVault): void {
  clearBytes(session.rawVaultKey);
}
