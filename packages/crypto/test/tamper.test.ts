// Tamper and binding checks that must fail closed
// Prose in this file avoids dash characters per project docs rule

import { describe, expect, it } from 'vitest';
import { clearBytes } from '../src/encoding.js';
import { generateSalt, deriveMasterKey, splitMasterKey } from '../src/keys.js';
import { createVault, wrapVaultKey, unwrapVaultKey } from '../src/vault.js';
import { encryptNote, decryptNote } from '../src/notes.js';
import { generateRecoveryKey, parseRecoveryKey } from '../src/recovery.js';
import type { KdfParams } from '../src/types.js';
import { DEFAULT_KDF_PARAMS } from '../src/keys.js';

const TEST_KDF: KdfParams = { ...DEFAULT_KDF_PARAMS, iterations: 1000 };

async function setupVault(password: string) {
  const salt = generateSalt();
  const master = await deriveMasterKey(password, salt, TEST_KDF);
  const { authKey, kek } = await splitMasterKey(master);
  const { rawVaultKey, vaultKey } = await createVault(kek);
  return { salt, master, authKey, kek, rawVaultKey, vaultKey };
}

describe('ciphertext tamper', () => {
  it('fails when one byte flips', async () => {
    const s = await setupVault('tamper one');
    try {
      const ctx = { userId: 'u', noteId: 'noteA', revision: 1 };
      const note = { title: 't', body: 'secret', tags: [], createdAt: 'a', updatedAt: 'b' };
      const bundle = await encryptNote(s.vaultKey, note, ctx);
      const bad = { ...bundle, ciphertext: new Uint8Array(bundle.ciphertext) };
      bad.ciphertext[0] = (bad.ciphertext[0] ?? 0) ^ 1;
      await expect(decryptNote(s.vaultKey, bad, ctx)).rejects.toThrow();
    } finally {
      clearBytes(s.authKey);
      clearBytes(s.rawVaultKey);
    }
  });

  it('fails when IV flips', async () => {
    const s = await setupVault('tamper two');
    try {
      const ctx = { userId: 'u', noteId: 'noteA', revision: 1 };
      const note = { title: 't', body: 'secret', tags: [], createdAt: 'a', updatedAt: 'b' };
      const bundle = await encryptNote(s.vaultKey, note, ctx);
      const bad = { ...bundle, iv: new Uint8Array(bundle.iv) };
      bad.iv[0] = (bad.iv[0] ?? 0) ^ 1;
      await expect(decryptNote(s.vaultKey, bad, ctx)).rejects.toThrow();
    } finally {
      clearBytes(s.authKey);
      clearBytes(s.rawVaultKey);
    }
  });
});

describe('context binding', () => {
  it('fails with wrong revision', async () => {
    const s = await setupVault('binding one');
    try {
      const ctx = { userId: 'u', noteId: 'noteA', revision: 1 };
      const note = { title: 't', body: 'secret', tags: [], createdAt: 'a', updatedAt: 'b' };
      const bundle = await encryptNote(s.vaultKey, note, ctx);
      await expect(decryptNote(s.vaultKey, bundle, { ...ctx, revision: 2 })).rejects.toThrow();
    } finally {
      clearBytes(s.authKey);
      clearBytes(s.rawVaultKey);
    }
  });

  it('fails with wrong user', async () => {
    const s = await setupVault('binding two');
    try {
      const ctx = { userId: 'alice', noteId: 'noteA', revision: 1 };
      const note = { title: 't', body: 'secret', tags: [], createdAt: 'a', updatedAt: 'b' };
      const bundle = await encryptNote(s.vaultKey, note, ctx);
      await expect(decryptNote(s.vaultKey, bundle, { ...ctx, userId: 'bob' })).rejects.toThrow();
    } finally {
      clearBytes(s.authKey);
      clearBytes(s.rawVaultKey);
    }
  });

  it('fails with wrong note id', async () => {
    const s = await setupVault('binding three');
    try {
      const ctx = { userId: 'u', noteId: 'noteA', revision: 1 };
      const note = { title: 't', body: 'secret', tags: [], createdAt: 'a', updatedAt: 'b' };
      const bundle = await encryptNote(s.vaultKey, note, ctx);
      await expect(decryptNote(s.vaultKey, bundle, { ...ctx, noteId: 'noteB' })).rejects.toThrow();
    } finally {
      clearBytes(s.authKey);
      clearBytes(s.rawVaultKey);
    }
  });
});

describe('key mismatch', () => {
  it('fails with wrong vault', async () => {
    const a = await setupVault('vault alpha');
    const b = await setupVault('vault beta');
    try {
      const ctx = { userId: 'u', noteId: 'noteA', revision: 1 };
      const note = { title: 't', body: 'secret', tags: [], createdAt: 'a', updatedAt: 'b' };
      const bundle = await encryptNote(a.vaultKey, note, ctx);
      await expect(decryptNote(b.vaultKey, bundle, ctx)).rejects.toThrow();
    } finally {
      clearBytes(a.authKey);
      clearBytes(a.rawVaultKey);
      clearBytes(b.authKey);
      clearBytes(b.rawVaultKey);
    }
  });

  it('fails unwrap with wrong kek', async () => {
    const a = await setupVault('kek alpha');
    const b = await setupVault('kek beta');
    try {
      const wrapped = await wrapVaultKey(a.kek, a.rawVaultKey);
      await expect(unwrapVaultKey(b.kek, wrapped)).rejects.toThrow();
    } finally {
      clearBytes(a.authKey);
      clearBytes(a.rawVaultKey);
      clearBytes(b.authKey);
      clearBytes(b.rawVaultKey);
    }
  });
});

describe('recovery typo guard', () => {
  it('catches check symbol error before unwrap', async () => {
    const { recoveryKeyText, recoveryKeyBytes } = await generateRecoveryKey();
    try {
      const clean = recoveryKeyText.replace(/\s+/g, '');
      const last = clean[clean.length - 1] ?? '';
      const flip = last === 'A' ? 'B' : 'A';
      const bad = clean.slice(0, 26) + flip;
      await expect(parseRecoveryKey(bad)).rejects.toThrow(/check symbol/);
      clearBytes(recoveryKeyBytes);
      void parseRecoveryKey;
    } finally {
      clearBytes(recoveryKeyBytes);
    }
  });
});
