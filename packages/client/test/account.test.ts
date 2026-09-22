import {
  DEFAULT_KDF_PARAMS,
  base64UrlDecode,
  base64UrlEncode,
  clearBytes,
  deriveRecoveryAuthKey,
  parseRecoveryKey
} from '@cipherpad/crypto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type CipherpadDb } from '../src/notes/db.js';
import { SyncAccount } from '../src/sync/account.js';
import type { RecoverInput, RegisterInput, SyncClient } from '../src/sync/api.js';
import { createVaultLocal, type OpenVault } from '../src/vault/session.js';

const FAST_KDF = { ...DEFAULT_KDF_PARAMS, iterations: 1000 };

const open: CipherpadDb[] = [];

function testDb() {
  const name = `account ${Math.random().toString(36).slice(2)}`;
  const db = openDb(name);
  open.push(db);
  return db;
}

afterEach(async () => {
  while (open.length > 0) {
    const db = open.pop() as CipherpadDb;
    const name = db.name;
    db.close();
    await Dexie.delete(name).catch(() => undefined);
  }
});

interface StoredAccount {
  salt: string;
  kdfIterations: number;
  authKey: string;
  wrappedVaultIv: string;
  wrappedVaultData: string;
  wrappedRecoveryIv?: string | undefined;
  wrappedRecoveryData?: string | undefined;
  recoveryAuth?: string | undefined;
}

function backingBytes(value: Uint8Array): Uint8Array {
  return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer);
}

class FakeServer {
  users = new Map<string, StoredAccount>();
  lastRegister: RegisterInput | null = null;
  lastRecover: RecoverInput | null = null;

  async register(input: RegisterInput): Promise<{ userId: string; accessToken: string }> {
    this.lastRegister = input;
    this.users.set(input.email, {
      salt: input.salt,
      kdfIterations: input.kdfIterations,
      authKey: input.authKey,
      wrappedVaultIv: input.wrappedVaultIv,
      wrappedVaultData: input.wrappedVaultData,
      wrappedRecoveryIv: input.wrappedRecoveryIv,
      wrappedRecoveryData: input.wrappedRecoveryData,
      recoveryAuth: input.recoveryAuth
    });
    return { userId: 'user 1', accessToken: 'token 1' };
  }

  async recoveryStart(email: string): Promise<{ salt: string; kdfIterations: number; wrappedRecoveryIv: string; wrappedRecoveryData: string }> {
    const user = this.users.get(email);
    if (!user || !user.wrappedRecoveryIv || !user.wrappedRecoveryData) {
      throw new Error('Not enrolled');
    }
    return {
      salt: user.salt,
      kdfIterations: user.kdfIterations,
      wrappedRecoveryIv: user.wrappedRecoveryIv,
      wrappedRecoveryData: user.wrappedRecoveryData
    };
  }

  async recover(input: RecoverInput): Promise<{ userId: string; accessToken: string }> {
    this.lastRecover = input;
    const user = this.users.get(input.email);
    if (!user || user.recoveryAuth !== input.recoveryAuth) throw new Error('Invalid credentials');
    user.salt = input.newSalt;
    user.kdfIterations = input.newKdfIterations;
    user.authKey = input.newAuthKey;
    user.wrappedVaultIv = input.newWrappedVaultIv;
    user.wrappedVaultData = input.newWrappedVaultData;
    return { userId: 'user 1', accessToken: 'token 2' };
  }

  client(): SyncClient {
    return {
      register: (input: RegisterInput) => this.register(input),
      recoveryStart: (email: string) => this.recoveryStart(email),
      recover: (input: RecoverInput) => this.recover(input)
    } as unknown as SyncClient;
  }
}

async function openVault(): Promise<{ db: CipherpadDb; vault: OpenVault }> {
  const db = testDb();
  const vault = await createVaultLocal(db, 'account passphrase value', FAST_KDF);
  return { db, vault };
}

describe('account recovery wiring', () => {
  it('sends a second wrapped copy plus proof at register', async () => {
    const { db, vault } = await openVault();
    const server = new FakeServer();
    const account = new SyncAccount();
    account.client = server.client();
    const res = await account.registerLink(db, vault, 'account passphrase value', 'Owner@Example.com');
    expect(account.linkedEmail).toBe('owner@example.com');
    expect(res.recoveryText.split(' ').length).toBe(3);
    const input = server.lastRegister;
    expect(input?.wrappedRecoveryIv).toBeDefined();
    expect(input?.wrappedRecoveryData).toBeDefined();
    expect(input?.recoveryAuth).toBeDefined();
    const parsed = await parseRecoveryKey(res.recoveryText);
    try {
      const proof = await deriveRecoveryAuthKey(parsed);
      try {
        expect(base64UrlEncode(proof)).toBe(input?.recoveryAuth);
      } finally {
        clearBytes(proof);
      }
    } finally {
      clearBytes(parsed);
    }
  });

  it('recovers the same vault on a fresh device', async () => {
    const first = await openVault();
    const server = new FakeServer();
    const accountA = new SyncAccount();
    accountA.client = server.client();
    const res = await accountA.registerLink(first.db, first.vault, 'account passphrase value', 'fresh@example.com');

    const dbB = testDb();
    const accountB = new SyncAccount();
    accountB.client = server.client();
    const vaultB = await accountB.recoverFresh(dbB, 'fresh@example.com', res.recoveryText, 'brand new passphrase');
    expect(vaultB.ownerId).toBe('user 1');
    expect(vaultB.rawVaultKey).toEqual(first.vault.rawVaultKey);
    expect(accountB.accessToken).toBe('token 2');
    const stored = server.users.get('fresh@example.com');
    expect(stored?.kdfIterations).toBe(1000);
    expect(backingBytes(base64UrlDecode(server.lastRecover?.newSalt ?? ''))).toHaveLength(16);
  });

  it('refuses recovery onto a device that already holds a vault', async () => {
    const { db } = await openVault();
    const account = new SyncAccount();
    account.client = new FakeServer().client();
    await expect(account.recoverFresh(db, 'any@example.com', 'AAAAAAAAAAAAAAAAAAAAAAAAAA', 'pw')).rejects.toThrow();
  });
});
