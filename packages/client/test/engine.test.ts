import { DEFAULT_KDF_PARAMS } from '@cipherpad/crypto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type CipherpadDb } from '../src/notes/db.js';
import { createNote, listNotes, updateNote, deleteNote } from '../src/notes/store.js';
import { createVaultLocal, type OpenVault } from '../src/vault/session.js';
import type { SyncAccount } from '../src/sync/account.js';
import { SyncHttpError, type PullResult, type PushPayload, type PushResult } from '../src/sync/api.js';
import { syncNow } from '../src/sync/engine.js';

const FAST_KDF = { ...DEFAULT_KDF_PARAMS, iterations: 1000 };

const open: CipherpadDb[] = [];

function testDb() {
  const name = `sync ${Math.random().toString(36).slice(2)}`;
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

interface ServerNote {
  revision: number;
  ciphertext: string;
  iv: string;
  deleted: boolean;
  seq: number;
}

class MockServer {
  notes = new Map<string, ServerNote>();
  seq = 0;

  async push(notes: PushPayload[]): Promise<PushResult> {
    const applied: Array<{ id: string; revision: number }> = [];
    const conflicts: PushResult['conflicts'] = [];
    for (const n of notes) {
      const current = this.notes.get(n.id);
      if (!current) {
        if (n.baseRevision !== 0) {
          conflicts.push({ id: n.id, server: null });
          continue;
        }
        this.seq += 1;
        this.notes.set(n.id, { revision: n.revision, ciphertext: n.ciphertext, iv: n.iv, deleted: n.deleted, seq: this.seq });
        applied.push({ id: n.id, revision: n.revision });
        continue;
      }
      if (current.revision !== n.baseRevision) {
        conflicts.push({
          id: n.id,
          server: { revision: current.revision, ciphertext: current.ciphertext, iv: current.iv, deleted: current.deleted, updatedAt: new Date().toISOString() }
        });
        continue;
      }
      this.seq += 1;
      this.notes.set(n.id, { revision: n.revision, ciphertext: n.ciphertext, iv: n.iv, deleted: n.deleted, seq: this.seq });
      applied.push({ id: n.id, revision: n.revision });
    }
    if (conflicts.length > 0) throw new SyncHttpError(409, 'Sync conflict', { applied, conflicts });
    return { applied, conflicts };
  }

  async pull(cursor: string): Promise<PullResult> {
    const after = Number(cursor);
    const changes = [...this.notes.entries()]
      .filter(([, n]) => n.seq > after)
      .sort((a, b) => a[1].seq - b[1].seq)
      .map(([id, n]) => ({ id, revision: n.revision, ciphertext: n.ciphertext, iv: n.iv, deleted: n.deleted, updatedAt: new Date().toISOString() }));
    const nextCursor = changes.length > 0 ? String(this.seq) : cursor;
    return { changes, nextCursor };
  }
}

function mockAccount(server: MockServer): SyncAccount {
  return {
    accessToken: 'token',
    refresh: async () => true,
    client: {
      push: (notes: PushPayload[]) => server.push(notes),
      pull: (cursor: string) => server.pull(cursor)
    }
  } as unknown as SyncAccount;
}

async function twoDevices(): Promise<{ dbA: CipherpadDb; dbB: CipherpadDb; vault: OpenVault; server: MockServer }> {
  const dbA = testDb();
  const dbB = testDb();
  const vault = await createVaultLocal(dbA, 'shared passphrase value', FAST_KDF);
  const meta = await dbA.meta.toArray();
  await dbB.meta.bulkPut(meta);
  const server = new MockServer();
  return { dbA, dbB, vault, server };
}

describe('sync engine', () => {
  it('pushes from A and pulls to B', async () => {
    const { dbA, dbB, vault, server } = await twoDevices();
    const created = await createNote(dbA, vault, { title: 'Hello', body: 'from A', tags: [] });
    const first = await syncNow(mockAccount(server), dbA, vault);
    expect(first.pushed).toBe(1);
    const second = await syncNow(mockAccount(server), dbB, vault);
    expect(second.pulled).toBe(1);
    const notes = await listNotes(dbB, vault);
    expect(notes.length).toBe(1);
    expect(notes[0]?.noteId).toBe(created.noteId);
    expect(notes[0]?.body).toBe('from A');
  });

  it('keeps a conflict copy on both side edit', async () => {
    const { dbA, dbB, vault, server } = await twoDevices();
    const created = await createNote(dbA, vault, { title: 'Shared', body: 'v1', tags: [] });
    await syncNow(mockAccount(server), dbA, vault);
    await syncNow(mockAccount(server), dbB, vault);
    await updateNote(dbA, vault, created.noteId, { title: 'Shared', body: 'edit from A', tags: [] });
    await updateNote(dbB, vault, created.noteId, { title: 'Shared', body: 'edit from B', tags: [] });
    await syncNow(mockAccount(server), dbA, vault);
    const result = await syncNow(mockAccount(server), dbB, vault);
    expect(result.conflicts).toBe(1);
    const notes = await listNotes(dbB, vault);
    expect(notes.length).toBe(2);
    const copy = notes.find((n) => n.title.includes('conflict copy'));
    expect(copy?.body).toBe('edit from A');
    const kept = notes.find((n) => !n.title.includes('conflict copy'));
    expect(kept?.body).toBe('edit from B');
  });

  it('propagates tombstones', async () => {
    const { dbA, dbB, vault, server } = await twoDevices();
    const created = await createNote(dbA, vault, { title: 'Gone', body: 'bye', tags: [] });
    await syncNow(mockAccount(server), dbA, vault);
    await syncNow(mockAccount(server), dbB, vault);
    expect((await listNotes(dbB, vault)).length).toBe(1);
    await deleteNote(dbA, created.noteId);
    await syncNow(mockAccount(server), dbA, vault);
    await syncNow(mockAccount(server), dbB, vault);
    expect(await listNotes(dbB, vault)).toEqual([]);
  });

  it('converges after conflict resolution', async () => {
    const { dbA, dbB, vault, server } = await twoDevices();
    const created = await createNote(dbA, vault, { title: 'Shared', body: 'v1', tags: [] });
    await syncNow(mockAccount(server), dbA, vault);
    await syncNow(mockAccount(server), dbB, vault);
    await updateNote(dbA, vault, created.noteId, { title: 'Shared', body: 'edit from A', tags: [] });
    await updateNote(dbB, vault, created.noteId, { title: 'Shared', body: 'edit from B', tags: [] });
    await syncNow(mockAccount(server), dbA, vault);
    await syncNow(mockAccount(server), dbB, vault);
    const again = await syncNow(mockAccount(server), dbB, vault);
    expect(again.conflicts).toBe(0);
    const third = await syncNow(mockAccount(server), dbA, vault);
    expect(third.pulled).toBeGreaterThan(0);
    const notesA = await listNotes(dbA, vault);
    expect(notesA.length).toBe(2);
  });
});
