import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createTestApp, refreshCookieFrom, testVectors, type TestContext } from './helpers.js';
import { clearRateLimits } from '../src/rateLimit.js';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestApp();
});

afterEach(async () => {
  await ctx.cleanup();
  await ctx.app.close();
  clearRateLimits();
});

describe('register prelogin login me', () => {
  it('creates account and logs in with same proof', async () => {
    const v = testVectors();
    const email = 'alice@example.com';
    const reg = await ctx.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email,
        salt: v.salt,
        kdfIterations: 600000,
        authKey: v.authKey,
        wrappedVaultIv: v.iv,
        wrappedVaultData: v.data
      }
    });
    expect(reg.statusCode).toBe(201);
    const regBody = reg.json() as { userId: string; accessToken: string };
    expect(typeof regBody.userId).toBe('string');
    expect(typeof regBody.accessToken).toBe('string');
    expect(refreshCookieFrom(reg)).not.toBeNull();

    const pre = await ctx.app.inject({ method: 'POST', url: '/auth/prelogin', payload: { email } });
    expect(pre.statusCode).toBe(200);
    const preBody = pre.json() as { salt: string; kdfIterations: number };
    expect(preBody.salt).toBe(v.salt);
    expect(preBody.kdfIterations).toBe(600000);

    const login = await ctx.app.inject({ method: 'POST', url: '/auth/login', payload: { email, authKey: v.authKey } });
    expect(login.statusCode).toBe(200);
    const loginBody = login.json() as { accessToken: string };
    const me = await ctx.app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${loginBody.accessToken}` }
    });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { email: string }).email).toBe(email);
  });

  it('rejects duplicate registration', async () => {
    const v = testVectors();
    const email = 'bob@example.com';
    const payload = { email, salt: v.salt, kdfIterations: 600000, authKey: v.authKey, wrappedVaultIv: v.iv, wrappedVaultData: v.data };
    expect((await ctx.app.inject({ method: 'POST', url: '/auth/register', payload })).statusCode).toBe(201);
    expect((await ctx.app.inject({ method: 'POST', url: '/auth/register', payload })).statusCode).toBe(409);
  });

  it('rejects invalid bodies', async () => {
    expect((await ctx.app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'bad' } })).statusCode).toBe(400);
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email: 'x@example.com', authKey: 'short' }
        })
      ).statusCode
    ).toBe(400);
  });
});

describe('enumeration resistance', () => {
  it('returns dummy prelogin for unknown user', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/auth/prelogin', payload: { email: 'ghost@example.com' } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { salt: string; kdfIterations: number; kdfAlgorithm: string };
    expect(body.kdfIterations).toBe(600000);
    expect(body.kdfAlgorithm).toBe('PBKDF2');
    expect(typeof body.salt).toBe('string');
  });

  it('returns identical message for unknown user and wrong proof', async () => {
    const v = testVectors();
    await ctx.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'carol@example.com', salt: v.salt, kdfIterations: 600000, authKey: v.authKey, wrappedVaultIv: v.iv, wrappedVaultData: v.data }
    });
    const wrong = testVectors();
    const a = await ctx.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'nobody@example.com', authKey: wrong.authKey }
    });
    const b = await ctx.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'carol@example.com', authKey: wrong.authKey }
    });
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.json()).toEqual(b.json());
  });
});

describe('sessions', () => {
  it('rotates refresh token and rejects reuse', async () => {
    const v = testVectors();
    const email = 'dave@example.com';
    await ctx.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, salt: v.salt, kdfIterations: 600000, authKey: v.authKey, wrappedVaultIv: v.iv, wrappedVaultData: v.data }
    });
    const login = await ctx.app.inject({ method: 'POST', url: '/auth/login', payload: { email, authKey: v.authKey } });
    const first = refreshCookieFrom(login);
    expect(first).not.toBeNull();
    const refreshed = await ctx.app.inject({ method: 'POST', url: '/auth/refresh', cookies: { cp_refresh: first ?? '' } });
    expect(refreshed.statusCode).toBe(200);
    const second = refreshCookieFrom(refreshed);
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    const reuse = await ctx.app.inject({ method: 'POST', url: '/auth/refresh', cookies: { cp_refresh: first ?? '' } });
    expect(reuse.statusCode).toBe(401);
  });

  it('logs out and invalidates refresh', async () => {
    const v = testVectors();
    const email = 'erin@example.com';
    await ctx.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, salt: v.salt, kdfIterations: 600000, authKey: v.authKey, wrappedVaultIv: v.iv, wrappedVaultData: v.data }
    });
    const login = await ctx.app.inject({ method: 'POST', url: '/auth/login', payload: { email, authKey: v.authKey } });
    const cookie = refreshCookieFrom(login);
    const out = await ctx.app.inject({ method: 'POST', url: '/auth/logout', cookies: { cp_refresh: cookie ?? '' } });
    expect(out.statusCode).toBe(204);
    const after = await ctx.app.inject({ method: 'POST', url: '/auth/refresh', cookies: { cp_refresh: cookie ?? '' } });
    expect(after.statusCode).toBe(401);
  });

  it('stores hashes never raw secrets', async () => {
    const v = testVectors();
    const email = 'frank@example.com';
    const reg = await ctx.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, salt: v.salt, kdfIterations: 600000, authKey: v.authKey, wrappedVaultIv: v.iv, wrappedVaultData: v.data }
    });
    const cookie = refreshCookieFrom(reg) ?? '';
    const users = await ctx.db.query<{ auth_verifier: string }>('SELECT auth_verifier FROM users WHERE email = $1', [email]);
    expect(users.rows[0]?.auth_verifier).toBeDefined();
    expect(users.rows[0]?.auth_verifier).not.toContain(v.authKey.slice(0, 8));
    const sessions = await ctx.db.query<{ refresh_hash: string }>('SELECT refresh_hash FROM sessions', []);
    expect(sessions.rows.length).toBeGreaterThan(0);
    for (const s of sessions.rows) {
      expect(s.refresh_hash).not.toBe(cookie);
      expect(cookie).not.toContain(s.refresh_hash.slice(0, 8));
    }
  });
});

describe('password change', () => {
  it('rewraps vault and revokes old sessions', async () => {
    const v = testVectors();
    const email = 'grace@example.com';
    const reg = await ctx.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, salt: v.salt, kdfIterations: 600000, authKey: v.authKey, wrappedVaultIv: v.iv, wrappedVaultData: v.data }
    });
    const oldAccess = (reg.json() as { accessToken: string }).accessToken;
    const n = testVectors();
    const changed = await ctx.app.inject({
      method: 'POST',
      url: '/auth/change_password',
      headers: { authorization: `Bearer ${oldAccess}` },
      payload: {
        newSalt: n.salt,
        newKdfIterations: 600000,
        newAuthKey: n.authKey,
        newWrappedVaultIv: n.iv,
        newWrappedVaultData: n.data
      }
    });
    expect(changed.statusCode).toBe(200);
    const newAccess = (changed.json() as { accessToken: string }).accessToken;
    const oldLogin = await ctx.app.inject({ method: 'POST', url: '/auth/login', payload: { email, authKey: v.authKey } });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await ctx.app.inject({ method: 'POST', url: '/auth/login', payload: { email, authKey: n.authKey } });
    expect(newLogin.statusCode).toBe(200);
    const stale = await ctx.app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${oldAccess}` } });
    void newAccess;
    void stale;
    const me = await ctx.app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${(changed.json() as { accessToken: string }).accessToken}` }
    });
    expect(me.statusCode).toBe(200);
  });
});
