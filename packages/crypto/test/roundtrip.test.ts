// Roundtrip flows for register vault notes recovery and rewrap
// Prose in this file avoids dash characters per project docs rule

import { describe, expect, it } from 'vitest';
import {
  clearBytes,
  constantTimeEqual,
  base64UrlEncode,
  base64UrlDecode,
  randomBytes
} from '../src/encoding.js';
import {
  DEFAULT_KDF_PARAMS,
  generateSalt,
  deriveMasterKey,
  splitMasterKey,
  encodeAuthKey
} from '../src/keys.js';
import { createVault, wrapVaultKey, unwrapVaultKey, importVaultKey } from '../src/vault.js';
import { encryptNote, decryptNote, deriveNoteKey } from '../src/notes.js';
import {
  generateRecoveryKey,
  parseRecoveryKey,
  wrapVaultWithRecovery,
  unwrapVaultWithRecovery,
  deriveRecoveryAuthKey,
  normalizeRecoveryInput,
  groupRecoveryText,
  encodeCrockford,
  decodeCrockford
} from '../src/recovery.js';
import { serializeWrapped, deserializeWrapped, serializeEncrypted, deserializeEncrypted } from '../src/serialize.js';
import type { KdfParams } from '../src/types.js';

const TEST_KDF: KdfParams = { ...DEFAULT_KDF_PARAMS, iterations: 1000 };

describe('KDF defaults', () => {
  it('uses safe production parameters', () => {
    expect(DEFAULT_KDF_PARAMS.algorithm).toBe('PBKDF2');
    expect(DEFAULT_KDF_PARAMS.hash).toBe('SHA-256');
    expect(DEFAULT_KDF_PARAMS.iterations).toBe(600000);
    expect(DEFAULT_KDF_PARAMS.saltBytes).toBe(16);
    expect(DEFAULT_KDF_PARAMS.outputBytes).toBe(32);
    expect(DEFAULT_KDF_PARAMS.version).toBe(1);
  });

  it('creates unique salts', () => {
    const a = generateSalt();
    const b = generateSalt();
    expect(a.length).toBe(16);
    expect(constantTimeEqual(a, b)).toBe(false);
  });
});

describe('register flow', () => {
  it('derives distinct auth and kek then wraps vault', async () => {
    const salt = generateSalt();
    const master = await deriveMasterKey('correct horse battery staple', salt, TEST_KDF);
    expect(master.extractable).toBe(false);
    const { authKey, kek } = await splitMasterKey(master);
    try {
      expect(authKey.length).toBe(32);
      expect(kek.extractable).toBe(false);
      expect((kek.algorithm as AesKeyAlgorithm).name).toBe('AES-GCM');
      const text = encodeAuthKey(authKey);
      expect(base64UrlDecode(text)).toEqual(authKey);
      const { rawVaultKey, vaultKey, wrappedVaultKey } = await createVault(kek);
      try {
        expect(rawVaultKey.length).toBe(32);
        expect(vaultKey.extractable).toBe(false);
        const back = await unwrapVaultKey(kek, wrappedVaultKey);
        expect(back.rawVaultKey).toEqual(rawVaultKey);
        clearBytes(back.rawVaultKey);
      } finally {
        clearBytes(rawVaultKey);
      }
    } finally {
      clearBytes(authKey);
    }
  });

  it('produces fresh IV per wrap', async () => {
    const salt = generateSalt();
    const master = await deriveMasterKey('another passphrase value', salt, TEST_KDF);
    const { authKey, kek } = await splitMasterKey(master);
    try {
      const raw = randomBytes(32);
      try {
        const w1 = await wrapVaultKey(kek, raw);
        const w2 = await wrapVaultKey(kek, raw);
        expect(w1.iv).not.toEqual(w2.iv);
        expect(w1.data).not.toEqual(w2.data);
      } finally {
        clearBytes(raw);
      }
    } finally {
      clearBytes(authKey);
    }
  });
});

describe('note flow', () => {
  it('encrypts and decrypts one payload', async () => {
    const salt = generateSalt();
    const master = await deriveMasterKey('note passphrase value', salt, TEST_KDF);
    const { authKey, kek } = await splitMasterKey(master);
    try {
      const { rawVaultKey, vaultKey } = await createVault(kek);
      try {
        const ctx = { userId: 'user 1', noteId: '11111111 1111 1111 1111 111111111111', revision: 1 };
        const note = {
          title: 'Hello',
          body: '# Hi\nSecret body text',
          tags: ['personal', 'todo'],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        };
        const bundle = await encryptNote(vaultKey, note, ctx);
        expect(bundle.iv.length).toBe(12);
        const back = await decryptNote(vaultKey, bundle, ctx);
        expect(back).toEqual(note);
        const k1 = await deriveNoteKey(vaultKey, ctx.noteId);
        const k2 = await deriveNoteKey(vaultKey, ctx.noteId);
        expect(k1.algorithm).toEqual(k2.algorithm);
        const other = await deriveNoteKey(vaultKey, '22222222 2222 2222 2222 222222222222');
        const t1 = await encryptNote(vaultKey, note, ctx);
        void other;
        void t1;
        void importVaultKey;
      } finally {
        clearBytes(rawVaultKey);
        clearBytes(authKey);
      }
    } finally {
      clearBytes(authKey.slice());
    }
  });

  it('uses fresh IV per note encryption', async () => {
    const salt = generateSalt();
    const master = await deriveMasterKey('iv freshness check', salt, TEST_KDF);
    const { authKey, kek } = await splitMasterKey(master);
    try {
      const { rawVaultKey, vaultKey } = await createVault(kek);
      try {
        const ctx = { userId: 'u', noteId: 'n1', revision: 1 };
        const note = { title: 't', body: 'b', tags: [], createdAt: 'a', updatedAt: 'b' };
        const e1 = await encryptNote(vaultKey, note, ctx);
        const e2 = await encryptNote(vaultKey, note, ctx);
        expect(e1.iv).not.toEqual(e2.iv);
        expect(e1.ciphertext).not.toEqual(e2.ciphertext);
      } finally {
        clearBytes(rawVaultKey);
      }
    } finally {
      clearBytes(authKey);
    }
  });

  it('serializes bundles for transport', async () => {
    const salt = generateSalt();
    const master = await deriveMasterKey('serialize check', salt, TEST_KDF);
    const { authKey, kek } = await splitMasterKey(master);
    try {
      const { rawVaultKey, vaultKey } = await createVault(kek);
      try {
        const w = await wrapVaultKey(kek, rawVaultKey);
        expect(deserializeWrapped(serializeWrapped(w))).toEqual(w);
        const ctx = { userId: 'u', noteId: 'n', revision: 2 };
        const note = { title: 't', body: 'b', tags: ['x'], createdAt: 'a', updatedAt: 'b' };
        const e = await encryptNote(vaultKey, note, ctx);
        expect(deserializeEncrypted(serializeEncrypted(e))).toEqual(e);
        expect(base64UrlEncode(new Uint8Array([1, 2, 3]))).toBe('AQID');
      } finally {
        clearBytes(rawVaultKey);
      }
    } finally {
      clearBytes(authKey);
    }
  });
});

describe('recovery flow', () => {
  it('generates grouped text plus check and parses back', async () => {
    const { recoveryKeyText, recoveryKeyBytes } = await generateRecoveryKey();
    try {
      expect(recoveryKeyBytes.length).toBe(16);
      expect(recoveryKeyText.split(' ').length).toBe(3);
      const back = await parseRecoveryKey(recoveryKeyText);
      expect(back).toEqual(recoveryKeyBytes);
      const lower = recoveryKeyText.toLowerCase();
      expect(await parseRecoveryKey(lower)).toEqual(recoveryKeyBytes);
      const nospace = recoveryKeyText.replace(/\s+/g, '');
      const dataOnly = nospace.slice(0, 26);
      expect(await parseRecoveryKey(dataOnly)).toEqual(recoveryKeyBytes);
      expect(normalizeRecoveryInput('o i l').length).toBeGreaterThan(0);
      expect(groupRecoveryText('ABC')).toBe('ABC');
      expect(decodeCrockford(encodeCrockford(recoveryKeyBytes), 16)).toEqual(recoveryKeyBytes);
    } finally {
      clearBytes(recoveryKeyBytes);
    }
  });

  it('wraps vault with recovery and unwraps with text', async () => {
    const salt = generateSalt();
    const master = await deriveMasterKey('recovery wrap check', salt, TEST_KDF);
    const { authKey, kek } = await splitMasterKey(master);
    try {
      const { rawVaultKey, wrappedVaultKey } = await createVault(kek);
      try {
        const { recoveryKeyText, recoveryKeyBytes } = await generateRecoveryKey();
        try {
          const wrapped2 = await wrapVaultWithRecovery(recoveryKeyBytes, rawVaultKey);
          const parsed = await parseRecoveryKey(recoveryKeyText);
          const back = await unwrapVaultWithRecovery(parsed, wrapped2);
          expect(back.rawVaultKey).toEqual(rawVaultKey);
          clearBytes(back.rawVaultKey);
          clearBytes(parsed);
          void wrappedVaultKey;
        } finally {
          clearBytes(recoveryKeyBytes);
        }
      } finally {
        clearBytes(rawVaultKey);
      }
    } finally {
      clearBytes(authKey);
    }
  });

  it('derives a stable auth subkey bound to recovery bytes', async () => {
    const { recoveryKeyBytes } = await generateRecoveryKey();
    try {
      const first = await deriveRecoveryAuthKey(recoveryKeyBytes);
      const second = await deriveRecoveryAuthKey(recoveryKeyBytes);
      expect(first.length).toBe(32);
      expect(first).toEqual(second);
      const other = await generateRecoveryKey();
      try {
        const third = await deriveRecoveryAuthKey(other.recoveryKeyBytes);
        expect(constantTimeEqual(first, third)).toBe(false);
      } finally {
        clearBytes(other.recoveryKeyBytes);
      }
      clearBytes(first);
      clearBytes(second);
    } finally {
      clearBytes(recoveryKeyBytes);
    }
  });

  it('supports password change by rewrap only', async () => {
    const salt1 = generateSalt();
    const salt2 = generateSalt();
    const m1 = await deriveMasterKey('old passphrase value', salt1, TEST_KDF);
    const m2 = await deriveMasterKey('new passphrase value', salt2, TEST_KDF);
    const s1 = await splitMasterKey(m1);
    const s2 = await splitMasterKey(m2);
    try {
      const { rawVaultKey, vaultKey } = await createVault(s1.kek);
      try {
        const ctx = { userId: 'u', noteId: 'n', revision: 1 };
        const note = { title: 't', body: 'keep me', tags: [], createdAt: 'a', updatedAt: 'b' };
        const enc = await encryptNote(vaultKey, note, ctx);
        const oldRaw = (await unwrapVaultKey(s1.kek, await wrapVaultKey(s1.kek, rawVaultKey))).rawVaultKey;
        const rewrapped = await wrapVaultKey(s2.kek, oldRaw);
        clearBytes(oldRaw);
        const opened = await unwrapVaultKey(s2.kek, rewrapped);
        const back = await decryptNote(opened.vaultKey, enc, ctx);
        expect(back.body).toBe('keep me');
        clearBytes(opened.rawVaultKey);
      } finally {
        clearBytes(rawVaultKey);
        clearBytes(s1.authKey);
        clearBytes(s2.authKey);
      }
    } finally {
      clearBytes(s1.authKey.slice());
    }
  });
});
