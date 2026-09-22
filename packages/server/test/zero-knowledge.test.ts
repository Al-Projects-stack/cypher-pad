import {
  base64UrlEncode,
  clearBytes,
  createVault,
  decryptNote,
  deriveMasterKey,
  encryptNote,
  generateSalt,
  splitMasterKey
} from '@cipherpad/crypto';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearRateLimits } from '../src/rateLimit.js';
import { createTestApp, testVectors, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestApp();
});

afterEach(async () => {
  await ctx.cleanup();
  await ctx.app.close();
  clearRateLimits();
});

const CANARY_TITLE = 'zkcanary title alpha 7f3a9c2e';
const CANARY_BODY = 'zkcanary body bravo 4d8b1f6a93';
const CANARY_TAG = 'zkcanary tag charlie 2e5c8b';
const CANARY_PASSWORD = 'zkcanary password delta 9a1f4d';

function backingBytes(value: Uint8Array): Uint8Array {
  return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer);
}

function dumpRows(rows: unknown[]): string {
  return JSON.stringify(rows, (_key, value: unknown) => {
    if (typeof value === 'object' && value !== null && 'type' in value && (value as { type?: unknown }).type === 'Buffer') {
      const data = (value as { data?: unknown }).data;
      if (Array.isArray(data)) return Buffer.from(data).toString('latin1');
    }
    if (value instanceof Uint8Array) return Buffer.from(value).toString('latin1');
    return value;
  });
}

describe('zero knowledge proof', () => {
  it('never persists or echoes plaintext secrets', async () => {
    const email = 'zero@example.com';
    const salt = generateSalt();
    const master = await deriveMasterKey(CANARY_PASSWORD, backingBytes(salt));
    const split = await splitMasterKey(master);
    const authText = base64UrlEncode(backingBytes(split.authKey));
    const created = await createVault(split.kek);
    const userId = randomUUID();
    const noteId = randomUUID();
    const stamp = '2026-09-22T00:00:00.000Z';
    const bundle = await encryptNote(
      created.vaultKey,
      { title: CANARY_TITLE, body: CANARY_BODY, tags: [CANARY_TAG], createdAt: stamp, updatedAt: stamp },
      { userId, noteId, revision: 1 }
    );
    const v = testVectors();
    const reg = await ctx.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email,
        salt: base64UrlEncode(backingBytes(salt)),
        kdfIterations: 600000,
        authKey: authText,
        wrappedVaultIv: v.iv,
        wrappedVaultData: v.data
      }
    });
    expect(reg.statusCode).toBe(201);

    const login = await ctx.app.inject({ method: 'POST', url: '/auth/login', payload: { email, authKey: authText } });
    const token = (login.json() as { accessToken: string }).accessToken;
    const headers = { authorization: `Bearer ${token}` };

    const push = await ctx.app.inject({
      method: 'POST',
      url: '/sync/push',
      headers,
      payload: {
        notes: [
          {
            id: noteId,
            baseRevision: 0,
            revision: 1,
            ciphertext: base64UrlEncode(backingBytes(bundle.ciphertext)),
            iv: base64UrlEncode(backingBytes(bundle.iv)),
            deleted: false
          }
        ]
      }
    });
    expect(push.statusCode).toBe(200);

    const pull = await ctx.app.inject({ method: 'GET', url: '/sync/pull?cursor=0', headers });
    const changes = (pull.json() as { changes: Array<{ ciphertext: string; iv: string }> }).changes;
    expect(changes.length).toBe(1);
    const sameOwner = await decryptNote(
      created.vaultKey,
      {
        iv: backingBytes(Buffer.from(changes[0]?.iv ?? '', 'base64url')),
        ciphertext: backingBytes(Buffer.from(changes[0]?.ciphertext ?? '', 'base64url')),
        version: 1
      },
      { userId, noteId, revision: 1 }
    );
    expect(sameOwner.title).toBe(CANARY_TITLE);

    const tables = ['users', 'sessions', 'notes'] as const;
    for (const table of tables) {
      const dumped = await ctx.db.query<Record<string, unknown>>(`SELECT * FROM ${table}`, []);
      const text = dumpRows(dumped.rows);
      expect(text).not.toContain(CANARY_TITLE);
      expect(text).not.toContain(CANARY_BODY);
      expect(text).not.toContain(CANARY_TAG);
      expect(text).not.toContain(CANARY_PASSWORD);
    }

    const badPush = await ctx.app.inject({
      method: 'POST',
      url: '/sync/push',
      headers,
      payload: { notes: [{ id: 'notauuid', baseRevision: 0, revision: 1, ciphertext: 'QQ', iv: 'QQ', deleted: false }] }
    });
    expect(badPush.statusCode).toBe(400);
    expect(badPush.body).not.toContain(CANARY_TITLE);

    clearBytes(split.authKey);
    clearBytes(created.rawVaultKey);
  });
});
