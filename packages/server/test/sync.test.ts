import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearRateLimits } from '../src/rateLimit.js';
import { createTestApp, registerUser, testNote, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestApp();
});

afterEach(async () => {
  await ctx.cleanup();
  await ctx.app.close();
  clearRateLimits();
});

function auth(user: { accessToken: string }) {
  return { authorization: `Bearer ${user.accessToken}` };
}

describe('push and pull', () => {
  it('stores new notes and returns them after cursor', async () => {
    const user = await registerUser(ctx.app, 'sync1@example.com');
    const note = testNote();
    const push = await ctx.app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: auth(user),
      payload: { notes: [note] }
    });
    expect(push.statusCode).toBe(200);
    expect(push.json()).toEqual({ applied: [{ id: note.id, revision: 1 }], conflicts: [] });

    const pull = await ctx.app.inject({ method: 'GET', url: '/sync/pull?cursor=0', headers: auth(user) });
    expect(pull.statusCode).toBe(200);
    const body = pull.json() as { changes: Array<{ id: string; revision: number }>; nextCursor: string };
    expect(body.changes.length).toBe(1);
    expect(body.changes[0]?.id).toBe(note.id);
    expect(body.nextCursor).not.toBe('0');

    const again = await ctx.app.inject({
      method: 'GET',
      url: `/sync/pull?cursor=${body.nextCursor}`,
      headers: auth(user)
    });
    expect((again.json() as { changes: unknown[] }).changes).toEqual([]);
  });

  it('applies updates when base matches', async () => {
    const user = await registerUser(ctx.app, 'sync2@example.com');
    const note = testNote();
    await ctx.app.inject({ method: 'POST', url: '/sync/push', headers: auth(user), payload: { notes: [note] } });
    const update = testNote({ id: note.id, baseRevision: 1, revision: 2 });
    const push = await ctx.app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: auth(user),
      payload: { notes: [update] }
    });
    expect(push.statusCode).toBe(200);
    const pull = await ctx.app.inject({ method: 'GET', url: '/sync/pull?cursor=0', headers: auth(user) });
    const changes = (pull.json() as { changes: Array<{ revision: number; ciphertext: string }> }).changes;
    expect(changes.length).toBe(1);
    expect(changes[0]?.revision).toBe(2);
    expect(changes[0]?.ciphertext).toBe(update.ciphertext);
  });

  it('returns 409 with server version on stale base', async () => {
    const user = await registerUser(ctx.app, 'sync3@example.com');
    const note = testNote();
    await ctx.app.inject({ method: 'POST', url: '/sync/push', headers: auth(user), payload: { notes: [note] } });
    const winner = testNote({ id: note.id, baseRevision: 1, revision: 2 });
    await ctx.app.inject({ method: 'POST', url: '/sync/push', headers: auth(user), payload: { notes: [winner] } });
    const stale = testNote({ id: note.id, baseRevision: 1, revision: 2 });
    const push = await ctx.app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: auth(user),
      payload: { notes: [stale] }
    });
    expect(push.statusCode).toBe(409);
    const body = push.json() as {
      applied: unknown[];
      conflicts: Array<{ id: string; server: { revision: number; ciphertext: string } | null }>;
    };
    expect(body.applied).toEqual([]);
    expect(body.conflicts.length).toBe(1);
    expect(body.conflicts[0]?.id).toBe(note.id);
    expect(body.conflicts[0]?.server?.revision).toBe(2);
    expect(body.conflicts[0]?.server?.ciphertext).toBe(winner.ciphertext);
  });

  it('syncs tombstones as deletions', async () => {
    const user = await registerUser(ctx.app, 'sync4@example.com');
    const note = testNote();
    await ctx.app.inject({ method: 'POST', url: '/sync/push', headers: auth(user), payload: { notes: [note] } });
    const tomb = testNote({ id: note.id, baseRevision: 1, revision: 2, deleted: true });
    const push = await ctx.app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: auth(user),
      payload: { notes: [tomb] }
    });
    expect(push.statusCode).toBe(200);
    const pull = await ctx.app.inject({ method: 'GET', url: '/sync/pull?cursor=0', headers: auth(user) });
    const changes = (pull.json() as { changes: Array<{ deleted: boolean }> }).changes;
    expect(changes.length).toBe(1);
    expect(changes[0]?.deleted).toBe(true);
  });

  it('keeps users isolated', async () => {
    const a = await registerUser(ctx.app, 'isolateda@example.com');
    const b = await registerUser(ctx.app, 'isolatedb@example.com');
    await ctx.app.inject({ method: 'POST', url: '/sync/push', headers: auth(a), payload: { notes: [testNote()] } });
    const pull = await ctx.app.inject({ method: 'GET', url: '/sync/pull?cursor=0', headers: auth(b) });
    expect((pull.json() as { changes: unknown[] }).changes).toEqual([]);
  });

  it('rejects unknown id with nonzero base', async () => {
    const user = await registerUser(ctx.app, 'sync5@example.com');
    const push = await ctx.app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: auth(user),
      payload: { notes: [testNote({ baseRevision: 3, revision: 4 })] }
    });
    expect(push.statusCode).toBe(409);
    const body = push.json() as { conflicts: Array<{ server: null }> };
    expect(body.conflicts[0]?.server).toBeNull();
  });
});

describe('sync validation and auth', () => {
  it('requires access token', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/sync/pull?cursor=0' })).statusCode).toBe(401);
    expect(
      (await ctx.app.inject({ method: 'POST', url: '/sync/push', payload: { notes: [] } })).statusCode
    ).toBe(401);
    expect((await ctx.app.inject({ method: 'GET', url: '/auth/vault' })).statusCode).toBe(401);
  });

  it('rejects malformed push bodies', async () => {
    const user = await registerUser(ctx.app, 'sync6@example.com');
    const badId = await ctx.app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: auth(user),
      payload: { notes: [testNote({ id: 'notauuid' })] }
    });
    expect(badId.statusCode).toBe(400);
    const badStep = await ctx.app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: auth(user),
      payload: { notes: [testNote({ baseRevision: 2, revision: 1 })] }
    });
    expect(badStep.statusCode).toBe(400);
    const badCursor = await ctx.app.inject({
      method: 'GET',
      url: '/sync/pull?cursor=nope',
      headers: auth(user)
    });
    expect(badCursor.statusCode).toBe(400);
  });

  it('serves wrapped vault blobs to owner', async () => {
    const user = await registerUser(ctx.app, 'sync7@example.com');
    const res = await ctx.app.inject({ method: 'GET', url: '/auth/vault', headers: auth(user) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { salt: string; kdfIterations: number; wrappedVaultData: string };
    expect(body.salt).toBe(user.vectors.salt);
    expect(body.kdfIterations).toBe(600000);
    expect(body.wrappedVaultData).toBe(user.vectors.data);
  });
});
