import { base64UrlDecode, base64UrlEncode, decryptNote, encryptNote, type NotePlaintext } from '@cipherpad/crypto';
import { type CipherpadDb, type NoteRecord } from './db.js';
import type { OpenVault } from '../vault/session.js';

export interface NoteDraft {
  title: string;
  body: string;
  tags: string[];
}

export interface NoteView extends NoteDraft {
  noteId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function toRecordInput(bundle: { iv: Uint8Array; ciphertext: Uint8Array }): { iv: Uint8Array; ciphertext: Uint8Array } {
  return {
    iv: new Uint8Array(bundle.iv.buffer.slice(bundle.iv.byteOffset, bundle.iv.byteOffset + bundle.iv.byteLength) as ArrayBuffer),
    ciphertext: new Uint8Array(
      bundle.ciphertext.buffer.slice(bundle.ciphertext.byteOffset, bundle.ciphertext.byteOffset + bundle.ciphertext.byteLength) as ArrayBuffer
    )
  };
}

export async function createNote(db: CipherpadDb, vault: OpenVault, draft: NoteDraft): Promise<NoteView> {
  const noteId = crypto.randomUUID();
  const stamp = nowIso();
  const payload: NotePlaintext = { title: draft.title, body: draft.body, tags: [...draft.tags], createdAt: stamp, updatedAt: stamp };
  const ctx = { userId: vault.ownerId, noteId, revision: 1 };
  const bundle = toRecordInput(await encryptNote(vault.vaultKey, payload, ctx));
  const record: NoteRecord = { noteId, ...bundle, revision: 1, updatedAt: stamp, deleted: 0, baseRevision: 0, dirty: 1 };
  await db.notes.put(record);
  return { ...draft, tags: [...draft.tags], noteId, revision: 1, createdAt: stamp, updatedAt: stamp };
}

export async function updateNote(
  db: CipherpadDb,
  vault: OpenVault,
  noteId: string,
  draft: NoteDraft
): Promise<NoteView> {
  const existing = await db.notes.get(noteId);
  if (!existing || existing.deleted === 1) throw new Error('Note not found');
  const revision = existing.revision + 1;
  const stamp = nowIso();
  const current = await decryptNote(
    vault.vaultKey,
    { iv: existing.iv, ciphertext: existing.ciphertext, version: 1 },
    { userId: vault.ownerId, noteId, revision: existing.revision }
  );
  const payload: NotePlaintext = { title: draft.title, body: draft.body, tags: [...draft.tags], createdAt: current.createdAt, updatedAt: stamp };
  const ctx = { userId: vault.ownerId, noteId, revision };
  const bundle = toRecordInput(await encryptNote(vault.vaultKey, payload, ctx));
  await db.notes.put({ noteId, ...bundle, revision, updatedAt: stamp, deleted: 0, baseRevision: existing.baseRevision, dirty: 1 });
  return { ...draft, tags: [...draft.tags], noteId, revision, createdAt: current.createdAt, updatedAt: stamp };
}

export async function deleteNote(db: CipherpadDb, noteId: string): Promise<void> {
  const existing = await db.notes.get(noteId);
  if (!existing) throw new Error('Note not found');
  await db.notes.put({ ...existing, revision: existing.revision + 1, deleted: 1, updatedAt: nowIso(), dirty: 1 });
}

export async function listNotes(db: CipherpadDb, vault: OpenVault): Promise<NoteView[]> {
  const rows = await db.notes.where('deleted').equals(0).toArray();
  const out: NoteView[] = [];
  for (const row of rows) {
    const payload = await decryptNote(
      vault.vaultKey,
      { iv: row.iv, ciphertext: row.ciphertext, version: 1 },
      { userId: vault.ownerId, noteId: row.noteId, revision: row.revision }
    );
    out.push({ title: payload.title, body: payload.body, tags: payload.tags, noteId: row.noteId, revision: row.revision, createdAt: payload.createdAt, updatedAt: payload.updatedAt });
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return out;
}

export interface DirtyNote {
  id: string;
  baseRevision: number;
  revision: number;
  ciphertext: string;
  iv: string;
  deleted: boolean;
}

export async function getDirtyNotes(db: CipherpadDb): Promise<DirtyNote[]> {
  const rows = await db.notes.where('dirty').equals(1).toArray();
  return rows.map((row) => ({
    id: row.noteId,
    baseRevision: row.baseRevision,
    revision: row.revision,
    ciphertext: base64UrlEncode(backingBytes(row.ciphertext)),
    iv: base64UrlEncode(backingBytes(row.iv)),
    deleted: row.deleted === 1
  }));
}

export async function markPushed(db: CipherpadDb, noteId: string, serverRevision: number): Promise<void> {
  const row = await db.notes.get(noteId);
  if (!row) return;
  await db.notes.put({ ...row, baseRevision: serverRevision, dirty: 0 });
}

export async function rebaseNote(db: CipherpadDb, noteId: string, baseRevision: number): Promise<void> {
  const row = await db.notes.get(noteId);
  if (!row) return;
  await db.notes.put({ ...row, baseRevision, dirty: 1 });
}

export interface PulledChange {
  id: string;
  revision: number;
  ciphertext: string;
  iv: string;
  deleted: boolean;
  updatedAt: string;
}

export async function applyPulledNote(db: CipherpadDb, vault: OpenVault, change: PulledChange): Promise<'inserted' | 'updated' | 'already' | 'conflict'> {
  const row = await db.notes.get(change.id);
  const iv = backingBytes(base64UrlDecode(change.iv));
  const ciphertext = backingBytes(base64UrlDecode(change.ciphertext));
  if (!row) {
    if (!change.deleted) {
      await decryptNote(
        vault.vaultKey,
        { iv, ciphertext, version: 1 },
        { userId: vault.ownerId, noteId: change.id, revision: change.revision }
      );
    }
    await db.notes.put({
      noteId: change.id,
      iv,
      ciphertext,
      revision: change.revision,
      updatedAt: change.updatedAt,
      deleted: change.deleted ? 1 : 0,
      baseRevision: change.revision,
      dirty: 0
    });
    return 'inserted';
  }
  if (row.dirty === 1) {
    if (change.revision === row.baseRevision) return 'already';
    return 'conflict';
  }
  if (change.revision === row.baseRevision && change.revision === row.revision) {
    await db.notes.put({ ...row, baseRevision: change.revision, dirty: 0 });
    return 'already';
  }
  if (!change.deleted) {
    await decryptNote(
      vault.vaultKey,
      { iv, ciphertext, version: 1 },
      { userId: vault.ownerId, noteId: change.id, revision: change.revision }
    );
  }
  await db.notes.put({
    noteId: change.id,
    iv,
    ciphertext,
    revision: change.revision,
    updatedAt: change.updatedAt,
    deleted: change.deleted ? 1 : 0,
    baseRevision: change.revision,
    dirty: 0
  });
  return 'updated';
}

export async function createConflictCopy(
  db: CipherpadDb,
  vault: OpenVault,
  server: PulledChange
): Promise<NoteView> {
  const payload = await decryptNote(
    vault.vaultKey,
    { iv: backingBytes(base64UrlDecode(server.iv)), ciphertext: backingBytes(base64UrlDecode(server.ciphertext)), version: 1 },
    { userId: vault.ownerId, noteId: server.id, revision: server.revision }
  );
  const draft = { title: `${payload.title} (conflict copy)`, body: payload.body, tags: [...payload.tags] };
  const copy = await createNote(db, vault, draft);
  const original = await db.notes.get(server.id);
  if (original) {
    await db.notes.put({ ...original, baseRevision: server.revision });
  }
  return copy;
}

export async function reencryptOwner(db: CipherpadDb, vault: OpenVault, newOwnerId: string): Promise<void> {
  const rows = await db.notes.where('deleted').equals(0).toArray();
  for (const row of rows) {
    const payload = await decryptNote(
      vault.vaultKey,
      { iv: row.iv, ciphertext: row.ciphertext, version: 1 },
      { userId: vault.ownerId, noteId: row.noteId, revision: row.revision }
    );
    const bundle = toRecordInput(
      await encryptNote(vault.vaultKey, payload, { userId: newOwnerId, noteId: row.noteId, revision: row.revision })
    );
    await db.notes.put({ ...row, ...bundle, dirty: 1 });
  }
}

function backingBytes(value: Uint8Array): Uint8Array {
  return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer);
}
