import {
  DEFAULT_KDF_PARAMS,
  base64UrlDecode,
  base64UrlEncode,
  clearBytes,
  deriveMasterKey,
  encodeAuthKey,
  splitMasterKey,
  unwrapVaultKey,
  validateKdfParams,
  type KdfParams
} from '@cipherpad/crypto';
import { readMeta, writeMeta, type CipherpadDb } from '../notes/db.js';
import { hasVault, readVaultMeta } from '../vault/session.js';
import { reencryptOwner } from '../notes/store.js';
import { lockVault, type OpenVault } from '../vault/session.js';
import { SyncClient } from './api.js';

export interface MemoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function backingBytes(value: Uint8Array): Uint8Array {
  return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer);
}

function defaultStorage(): MemoryStorage {
  if (typeof localStorage !== 'undefined') return localStorage;
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k)
  };
}

const EMAIL_KEY = 'cipherpad.sync.email';
const URL_KEY = 'cipherpad.sync.url';

export const DEFAULT_SYNC_URL = 'http://localhost:3000';

export class SyncAccount {
  client: SyncClient;
  accessToken: string | null = null;
  storage: MemoryStorage;

  constructor(baseUrl: string = DEFAULT_SYNC_URL, storage?: MemoryStorage) {
    this.storage = storage ?? defaultStorage();
    const savedUrl = this.storage.getItem(URL_KEY) ?? baseUrl;
    this.client = new SyncClient(savedUrl, () => this.accessToken);
  }

  get baseUrl(): string {
    return this.client.baseUrl;
  }

  setBaseUrl(url: string): void {
    this.client.baseUrl = url.replace(/\/+$/, '');
    this.storage.setItem(URL_KEY, this.client.baseUrl);
  }

  get linkedEmail(): string | null {
    return this.storage.getItem(EMAIL_KEY);
  }

  get linked(): boolean {
    return this.linkedEmail !== null && this.accessToken !== null;
  }

  async registerLink(db: CipherpadDb, vault: OpenVault, password: string, email: string): Promise<string> {
    const clean = email.trim().toLowerCase();
    const meta = await readVaultMeta(db);
    if (!meta) throw new Error('No vault found');
    const salt = backingBytes(base64UrlDecode(meta.salt));
    const kdf: KdfParams = { ...DEFAULT_KDF_PARAMS, iterations: meta.kdfIterations };
    validateKdfParams(kdf);
    const master = await deriveMasterKey(password, salt, kdf);
    const split = await splitMasterKey(master);
    try {
      const authKey = split.authKey;
      const wrappedIv = (await readMeta(db, 'wrappedVaultIv')) ?? '';
      const wrappedData = (await readMeta(db, 'wrappedVaultData')) ?? '';
      const registered = await this.client.register({
        email: clean,
        salt: base64UrlEncode(salt),
        kdfIterations: kdf.iterations,
        authKey: encodeAuthKey(authKey),
        wrappedVaultIv: wrappedIv,
        wrappedVaultData: wrappedData
      });
      await reencryptOwner(db, vault, registered.userId);
      await writeMeta(db, 'ownerId', registered.userId);
      vault.ownerId = registered.userId;
      this.accessToken = registered.accessToken;
      this.storage.setItem(EMAIL_KEY, clean);
      return registered.userId;
    } finally {
      clearBytes(split.authKey);
      clearBytes(salt);
    }
  }

  async loginFresh(db: CipherpadDb, email: string, password: string): Promise<OpenVault> {
    const clean = email.trim().toLowerCase();
    if (await hasVault(db)) throw new Error('Local vault exists');
    const pre = await this.client.prelogin(clean);
    const kdf: KdfParams = { ...DEFAULT_KDF_PARAMS, iterations: pre.kdfIterations };
    validateKdfParams(kdf);
    const salt = backingBytes(base64UrlDecode(pre.salt));
    if (salt.length < 16 || salt.length > 64) throw new Error('KDF params rejected');
    try {
      const master = await deriveMasterKey(password, salt, kdf);
      const split = await splitMasterKey(master);
      try {
        const logged = await this.client.login(clean, encodeAuthKey(split.authKey));
        this.accessToken = logged.accessToken;
        const blobs = await this.client.getVault();
        validateKdfParams({ ...DEFAULT_KDF_PARAMS, iterations: blobs.kdfIterations });
        await writeMeta(db, 'ownerId', logged.userId);
        await writeMeta(db, 'salt', blobs.salt);
        await writeMeta(db, 'kdfIterations', String(blobs.kdfIterations));
        await writeMeta(db, 'wrappedVaultIv', blobs.wrappedVaultIv);
        await writeMeta(db, 'wrappedVaultData', blobs.wrappedVaultData);
        const opened = await unwrapVaultKey(split.kek, {
          iv: backingBytes(base64UrlDecode(blobs.wrappedVaultIv)),
          data: backingBytes(base64UrlDecode(blobs.wrappedVaultData)),
          version: 1
        });
        this.storage.setItem(EMAIL_KEY, clean);
        return { ownerId: logged.userId, vaultKey: opened.vaultKey, rawVaultKey: opened.rawVaultKey };
      } finally {
        clearBytes(split.authKey);
      }
    } finally {
      clearBytes(salt);
    }
  }

  async refresh(): Promise<boolean> {
    try {
      const res = await this.client.refresh();
      this.accessToken = res.accessToken;
      return true;
    } catch {
      this.accessToken = null;
      return false;
    }
  }

  async logout(): Promise<void> {
    await this.client.logout();
    this.accessToken = null;
    this.storage.removeItem(EMAIL_KEY);
  }

  forgetLocalSession(vault: OpenVault | null): void {
    if (vault) lockVault(vault);
    this.accessToken = null;
  }
}
