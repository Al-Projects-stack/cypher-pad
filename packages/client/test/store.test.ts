import { DEFAULT_KDF_PARAMS } from '@cipherpad/crypto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type CipherpadDb } from '../src/notes/db.js';
import { NoteSearch } from '../src/notes/search.js';
import { createNote, deleteNote, listNotes, updateNote } from '../src/notes/store.js';
import { createVaultLocal, type OpenVault } from '../src/vault/session.js';

const FAST_KDF = { ...DEFAULT_KDF_PARAMS, iterations: 1000 };

const open: CipherpadDb[] = [];

function testDb() {
  const name = `notes ${Math.random().toString(36).slice(2)}`;
  const db = openDb(name);
  open.push(db);
  return db;
}

async function openVault(): Promise<{ db: CipherpadDb; vault: OpenVault }> {
  const db = testDb();
  const vault = await createVaultLocal(db, 'store passphrase value', FAST_KDF);
  return { db, vault };
}

afterEach(async () => {
  while (open.length > 0) {
    const db = open.pop() as CipherpadDb;
    const name = db.name;
    db.close();
    await Dexie.delete(name).catch(() => undefined);
  }
});

describe('encrypted note store', () => {
  it('creates and lists decrypted notes', async () => {
    const { db, vault } = await openVault();
    await createNote(db, vault, { title: 'Hello', body: 'Secret body', tags: ['personal'] });
    const all = await listNotes(db, vault);
    expect(all.length).toBe(1);
    expect(all[0]?.title).toBe('Hello');
    expect(all[0]?.revision).toBe(1);
  });

  it('bumps revision on edit and keeps created stamp', async () => {
    const { db, vault } = await openVault();
    const created = await createNote(db, vault, { title: 'T', body: 'one', tags: [] });
    const updated = await updateNote(db, vault, created.noteId, { title: 'T', body: 'two', tags: [] });
    expect(updated.revision).toBe(2);
    expect(updated.createdAt).toBe(created.createdAt);
    const all = await listNotes(db, vault);
    expect(all[0]?.body).toBe('two');
  });

  it('hides tombstones from list and search', async () => {
    const { db, vault } = await openVault();
    const a = await createNote(db, vault, { title: 'Keep me', body: 'visible', tags: [] });
    const b = await createNote(db, vault, { title: 'Drop me', body: 'gone', tags: [] });
    await deleteNote(db, a.noteId);
    const all = await listNotes(db, vault);
    expect(all.map((n) => n.noteId)).toEqual([b.noteId]);
    const index = new NoteSearch();
    index.rebuild(all.map((n) => ({ noteId: n.noteId, title: n.title, body: n.body, tags: n.tags })));
    expect(index.query('visible')).toEqual([]);
    expect(index.query('gone')).toEqual([b.noteId]);
  });

  it('stores ciphertext only in indexeddb', async () => {
    const { db, vault } = await openVault();
    const secret = 'unique local secret value 8472';
    await createNote(db, vault, { title: 'T', body: secret, tags: [] });
    const rows = await db.notes.toArray();
    const blob = JSON.stringify(rows);
    expect(blob).not.toContain(secret);
  });
});
