import { DEFAULT_KDF_PARAMS } from '@cipherpad/crypto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, writeMeta, type CipherpadDb } from '../src/notes/db.js';
import { checkKdfPinned, createVaultLocal, hasVault, lockVault, readVaultMeta, unlockVault } from '../src/vault/session.js';

const FAST_KDF = { ...DEFAULT_KDF_PARAMS, iterations: 1000 };

const open: CipherpadDb[] = [];

function testDb() {
  const name = `vault ${Math.random().toString(36).slice(2)}`;
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

describe('local vault lifecycle', () => {
  it('reports missing vault before creation', async () => {
    expect(await hasVault(testDb())).toBe(false);
  });

  it('creates then unlocks with same password', async () => {
    const db = testDb();
    const created = await createVaultLocal(db, 'correct horse battery staple', FAST_KDF);
    expect(await hasVault(db)).toBe(true);
    const meta = await readVaultMeta(db);
    expect(meta?.kdfIterations).toBe(1000);
    const opened = await unlockVault(db, 'correct horse battery staple', { iterations: 1000 });
    expect(opened.ownerId).toBe(created.ownerId);
    expect(opened.rawVaultKey).toEqual(created.rawVaultKey);
  });

  it('rejects wrong password', async () => {
    const db = testDb();
    await createVaultLocal(db, 'first password value', FAST_KDF);
    await expect(unlockVault(db, 'other password value', { iterations: 1000 })).rejects.toThrow();
  });

  it('clears raw material on lock', async () => {
    const db = testDb();
    const created = await createVaultLocal(db, 'lock me out please', FAST_KDF);
    expect(created.rawVaultKey.some((b) => b !== 0)).toBe(true);
    lockVault(created);
    expect(created.rawVaultKey.every((b) => b === 0)).toBe(true);
  });

  it('keeps keys non extractable', async () => {
    const db = testDb();
    const created = await createVaultLocal(db, 'extract check value', FAST_KDF);
    expect(created.vaultKey.extractable).toBe(false);
  });

  it('rejects weak iteration counts at creation', async () => {
    const db = testDb();
    await expect(createVaultLocal(db, 'weak params value', { ...DEFAULT_KDF_PARAMS, iterations: 500 })).rejects.toThrow();
    expect(await hasVault(db)).toBe(false);
  });

  it('rejects pinned downgrades and accepts upgrades', () => {
    expect(() => checkKdfPinned(600000, 1000)).toThrow('KDF params rejected');
    expect(() => checkKdfPinned(600000, 600000)).not.toThrow();
    expect(() => checkKdfPinned(600000, 1200000)).not.toThrow();
  });

  it('refuses unlock when stored params fall below floor', async () => {
    const db = testDb();
    await createVaultLocal(db, 'floor check value', FAST_KDF);
    await writeMeta(db, 'kdfIterations', '500');
    await expect(unlockVault(db, 'floor check value')).rejects.toThrow();
  });
});
