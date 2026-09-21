import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createTestApp, testVectors, type TestContext } from './helpers.js';
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

describe('http hardening', () => {
  it('sets helmet headers and strict csp', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    const csp = String(res.headers['content-security-policy'] ?? '');
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
  });

  it('sets refresh cookie with strict flags', async () => {
    const v = testVectors();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'cookie@example.com', salt: v.salt, kdfIterations: 600000, authKey: v.authKey, wrappedVaultIv: v.iv, wrappedVaultData: v.data }
    });
    const setCookie = String(res.headers['set-cookie'] ?? '');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Path=/');
  });

  it('enforces cors to app origin only', async () => {
    const allowed = await ctx.app.inject({ method: 'GET', url: '/health', headers: { origin: 'http://localhost:5173' } });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const denied = await ctx.app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://evil.example' } });
    expect(denied.headers['access-control-allow-origin']).not.toBe('https://evil.example');
  });

  it('rate limits login per account', async () => {
    const v = testVectors();
    const email = 'limited@example.com';
    await ctx.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, salt: v.salt, kdfIterations: 600000, authKey: v.authKey, wrappedVaultIv: v.iv, wrappedVaultData: v.data }
    });
    const wrong = testVectors();
    let limited = false;
    for (let i = 0; i < 12; i++) {
      const res = await ctx.app.inject({ method: 'POST', url: '/auth/login', payload: { email, authKey: wrong.authKey } });
      if (res.statusCode === 429) {
        limited = true;
        expect(res.json()).toEqual({ error: 'Too many requests' });
        break;
      }
      expect([401, 429]).toContain(res.statusCode);
    }
    expect(limited).toBe(true);
  });

  it('rejects oversize bodies', async () => {
    const big = 'a'.repeat(600 * 1024);
    const res = await ctx.app.inject({ method: 'POST', url: '/auth/prelogin', payload: { email: big } });
    expect([400, 413]).toContain(res.statusCode);
  });
});
