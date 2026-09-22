import {
  base64UrlEncode,
  clearBytes,
  deriveRecoveryAuthKey,
  generateRecoveryKey,
  parseRecoveryKey,
  wrapVaultWithRecovery,
  randomBytes
} from '@cipherpad/crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearRateLimits } from '../src/rateLimit.js';
import { createTestApp, refreshCookieFrom, testVectors, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestApp();
});

afterEach(async () => {
  await ctx.cleanup();
  await ctx.app.close();
  clearRateLimits();
});

interface RecoverySetup {
  email: string;
  recoveryText: string;
  recoveryAuth: string;
  recoveryBytes: Uint8Array;
  authKey: string;
}

async function registerWithRecovery(email: string): Promise<RecoverySetup> {
  const v = testVectors();
  const gen = await generateRecoveryKey();
  const proof = await deriveRecoveryAuthKey(gen.recoveryKeyBytes);
  const wrapped = await wrapVaultWithRecovery(gen.recoveryKeyBytes, randomBytes(32));
  const reg = await ctx.app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      email,
      salt: v.salt,
      kdfIterations: 600000,
      authKey: v.authKey,
      wrappedVaultIv: v.iv,
      wrappedVaultData: v.data,
      wrappedRecoveryIv: base64UrlEncode(wrapped.iv),
      wrappedRecoveryData: base64UrlEncode(wrapped.data),
      recoveryAuth: base64UrlEncode(proof)
    }
  });
  expect(reg.statusCode).toBe(201);
  clearBytes(proof);
  return { email, recoveryText: gen.recoveryKeyText, recoveryAuth: '', recoveryBytes: gen.recoveryKeyBytes, authKey: v.authKey };
}

async function proofFor(setup: RecoverySetup): Promise<string> {
  const parsed = await parseRecoveryKey(setup.recoveryText);
  const proof = await deriveRecoveryAuthKey(parsed);
  const text = base64UrlEncode(proof);
  clearBytes(parsed);
  clearBytes(proof);
  return text;
}

function freshVault(): { iv: string; data: string } {
  return { iv: testVectors().iv, data: testVectors().data };
}

describe('account recovery', () => {
  it('resets credentials with a valid recovery proof', async () => {
    const setup = await registerWithRecovery('recover1@example.com');
    try {
      const proof = await proofFor(setup);
      const next = freshVault();
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/auth/recover',
        payload: {
          email: setup.email,
          recoveryAuth: proof,
          newSalt: testVectors().salt,
          newKdfIterations: 600000,
          newAuthKey: testVectors().authKey,
          newWrappedVaultIv: next.iv,
          newWrappedVaultData: next.data
        }
      });
      expect(res.statusCode).toBe(200);
      expect(refreshCookieFrom(res)).not.toBeNull();
      const oldLogin = await ctx.app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: setup.email, authKey: setup.authKey }
      });
      expect(oldLogin.statusCode).toBe(401);
    } finally {
      clearBytes(setup.recoveryBytes);
    }
  });

  it('rejects wrong proof exactly like an unknown account', async () => {
    const setup = await registerWithRecovery('recover2@example.com');
    try {
      const wrong = base64UrlEncode(randomBytes(32));
      const next = freshVault();
      const base = {
        newSalt: testVectors().salt,
        newKdfIterations: 600000,
        newAuthKey: testVectors().authKey,
        newWrappedVaultIv: next.iv,
        newWrappedVaultData: next.data
      };
      const a = await ctx.app.inject({
        method: 'POST',
        url: '/auth/recover',
        payload: { email: 'nobody@example.com', recoveryAuth: wrong, ...base }
      });
      const b = await ctx.app.inject({
        method: 'POST',
        url: '/auth/recover',
        payload: { email: setup.email, recoveryAuth: wrong, ...base }
      });
      expect(a.statusCode).toBe(401);
      expect(b.statusCode).toBe(401);
      expect(a.json()).toEqual(b.json());
    } finally {
      clearBytes(setup.recoveryBytes);
    }
  });

  it('refuses reset when no recovery was set up', async () => {
    const v = testVectors();
    await ctx.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: 'norecovery@example.com',
        salt: v.salt,
        kdfIterations: 600000,
        authKey: v.authKey,
        wrappedVaultIv: v.iv,
        wrappedVaultData: v.data
      }
    });
    const next = freshVault();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/auth/recover',
      payload: {
        email: 'norecovery@example.com',
        recoveryAuth: base64UrlEncode(randomBytes(32)),
        newSalt: testVectors().salt,
        newKdfIterations: 600000,
        newAuthKey: testVectors().authKey,
        newWrappedVaultIv: next.iv,
        newWrappedVaultData: next.data
      }
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Invalid credentials' });
  });

  it('rotates recovery material atomically', async () => {
    const setup = await registerWithRecovery('recover3@example.com');
    try {
      const proof = await proofFor(setup);
      const rotation = await generateRecoveryKey();
      try {
        const rotationProof = await deriveRecoveryAuthKey(rotation.recoveryKeyBytes);
        const wrapped = await wrapVaultWithRecovery(rotation.recoveryKeyBytes, randomBytes(32));
        const next = freshVault();
        const res = await ctx.app.inject({
          method: 'POST',
          url: '/auth/recover',
          payload: {
            email: setup.email,
            recoveryAuth: proof,
            newSalt: testVectors().salt,
            newKdfIterations: 600000,
            newAuthKey: testVectors().authKey,
            newWrappedVaultIv: next.iv,
            newWrappedVaultData: next.data,
            newWrappedRecoveryIv: base64UrlEncode(wrapped.iv),
            newWrappedRecoveryData: base64UrlEncode(wrapped.data),
            newRecoveryVerifier: base64UrlEncode(rotationProof)
          }
        });
        expect(res.statusCode).toBe(200);
        clearBytes(rotationProof);
        const stale = await ctx.app.inject({
          method: 'POST',
          url: '/auth/recover',
          payload: {
            email: setup.email,
            recoveryAuth: proof,
            newSalt: testVectors().salt,
            newKdfIterations: 600000,
            newAuthKey: testVectors().authKey,
            newWrappedVaultIv: next.iv,
            newWrappedVaultData: next.data
          }
        });
        expect(stale.statusCode).toBe(401);
      } finally {
        clearBytes(rotation.recoveryKeyBytes);
      }
    } finally {
      clearBytes(setup.recoveryBytes);
    }
  });

  it('rejects partial rotation', async () => {
    const setup = await registerWithRecovery('recover4@example.com');
    try {
      const proof = await proofFor(setup);
      const next = freshVault();
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/auth/recover',
        payload: {
          email: setup.email,
          recoveryAuth: proof,
          newSalt: testVectors().salt,
          newKdfIterations: 600000,
          newAuthKey: testVectors().authKey,
          newWrappedVaultIv: next.iv,
          newWrappedVaultData: next.data,
          newWrappedRecoveryIv: next.iv
        }
      });
      expect(res.statusCode).toBe(400);
    } finally {
      clearBytes(setup.recoveryBytes);
    }
  });

  it('revokes sessions on recovery reset', async () => {
    const setup = await registerWithRecovery('recover5@example.com');
    try {
      const login = await ctx.app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: setup.email, authKey: setup.authKey }
      });
      const cookie = refreshCookieFrom(login) ?? '';
      expect(cookie).not.toBe('');
      const proof = await proofFor(setup);
      const next = freshVault();
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/auth/recover',
        payload: {
          email: setup.email,
          recoveryAuth: proof,
          newSalt: testVectors().salt,
          newKdfIterations: 600000,
          newAuthKey: testVectors().authKey,
          newWrappedVaultIv: next.iv,
          newWrappedVaultData: next.data
        }
      });
      expect(res.statusCode).toBe(200);
      const reuse = await ctx.app.inject({ method: 'POST', url: '/auth/refresh', cookies: { cp_refresh: cookie } });
      expect(reuse.statusCode).toBe(401);
    } finally {
      clearBytes(setup.recoveryBytes);
    }
  });

  it('preserves recovery across password change', async () => {    const setup = await registerWithRecovery('recover6@example.com');
    try {
      const login = await ctx.app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: setup.email, authKey: setup.authKey }
      });
      const token = (login.json() as { accessToken: string }).accessToken;
      const changed = await ctx.app.inject({
        method: 'POST',
        url: '/auth/change_password',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          newSalt: testVectors().salt,
          newKdfIterations: 600000,
          newAuthKey: testVectors().authKey,
          newWrappedVaultIv: testVectors().iv,
          newWrappedVaultData: testVectors().data
        }
      });
      expect(changed.statusCode).toBe(200);
      const proof = await proofFor(setup);
      const next = freshVault();
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/auth/recover',
        payload: {
          email: setup.email,
          recoveryAuth: proof,
          newSalt: testVectors().salt,
          newKdfIterations: 600000,
          newAuthKey: testVectors().authKey,
          newWrappedVaultIv: next.iv,
          newWrappedVaultData: next.data
        }
      });
      expect(res.statusCode).toBe(200);
    } finally {
      clearBytes(setup.recoveryBytes);
    }
  });
});

describe('recovery start', () => {
  it('serves real blobs to enrolled accounts and dummies otherwise', async () => {
    const setup = await registerWithRecovery('start1@example.com');
    try {
      const known = await ctx.app.inject({
        method: 'POST',
        url: '/auth/recovery/start',
        payload: { email: setup.email }
      });
      expect(known.statusCode).toBe(200);
      const knownBody = known.json() as { salt: string; wrappedRecoveryIv: string; wrappedRecoveryData: string };
      expect(knownBody.salt.length).toBeGreaterThan(0);

      const unknown = await ctx.app.inject({
        method: 'POST',
        url: '/auth/recovery/start',
        payload: { email: 'nobody@example.com' }
      });
      expect(unknown.statusCode).toBe(200);
      const unknownBody = unknown.json() as { salt: string; wrappedRecoveryIv: string; wrappedRecoveryData: string };
      expect(Object.keys(unknownBody).sort()).toEqual(Object.keys(knownBody).sort());

      const again = await ctx.app.inject({
        method: 'POST',
        url: '/auth/recovery/start',
        payload: { email: 'nobody@example.com' }
      });
      const againBody = again.json() as { wrappedRecoveryData: string };
      expect(againBody.wrappedRecoveryData).not.toBe(unknownBody.wrappedRecoveryData);
    } finally {
      clearBytes(setup.recoveryBytes);
    }
  });
});

describe('recovery rotation', () => {
  it('replaces proof and blobs from a live session', async () => {
    const setup = await registerWithRecovery('rotate1@example.com');
    try {
      const login = await ctx.app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: setup.email, authKey: setup.authKey }
      });
      const token = (login.json() as { accessToken: string }).accessToken;
      const rotation = await generateRecoveryKey();
      try {
        const proof = await deriveRecoveryAuthKey(rotation.recoveryKeyBytes);
        const wrapped = await wrapVaultWithRecovery(rotation.recoveryKeyBytes, randomBytes(32));
        const res = await ctx.app.inject({
          method: 'POST',
          url: '/auth/recovery/rotate',
          headers: { authorization: `Bearer ${token}` },
          payload: {
            newWrappedRecoveryIv: base64UrlEncode(wrapped.iv),
            newWrappedRecoveryData: base64UrlEncode(wrapped.data),
            newRecoveryVerifier: base64UrlEncode(proof)
          }
        });
        expect(res.statusCode).toBe(200);
        clearBytes(proof);
        const staleProof = await proofFor(setup);
        const next = freshVault();
        const stale = await ctx.app.inject({
          method: 'POST',
          url: '/auth/recover',
          payload: {
            email: setup.email,
            recoveryAuth: staleProof,
            newSalt: testVectors().salt,
            newKdfIterations: 600000,
            newAuthKey: testVectors().authKey,
            newWrappedVaultIv: next.iv,
            newWrappedVaultData: next.data
          }
        });
        expect(stale.statusCode).toBe(401);
      } finally {
        clearBytes(rotation.recoveryKeyBytes);
      }
    } finally {
      clearBytes(setup.recoveryBytes);
    }
  });

  it('requires a live session', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/auth/recovery/rotate',
      payload: {
        newWrappedRecoveryIv: testVectors().iv,
        newWrappedRecoveryData: testVectors().data,
        newRecoveryVerifier: base64UrlEncode(randomBytes(32))
      }
    });
    expect(res.statusCode).toBe(401);
  });
});
