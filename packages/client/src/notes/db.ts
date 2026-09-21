import Dexie, { type Table } from 'dexie';

export interface NoteRecord {
  noteId: string;
  iv: Uint8Array;
  ciphertext: Uint8Array;
  revision: number;
  updatedAt: string;
  deleted: number;
  baseRevision: number;
  dirty: number;
}

export interface MetaRecord {
  key: string;
  value: string;
}

export class CipherpadDb extends Dexie {
  notes!: Table<NoteRecord, string>;
  meta!: Table<MetaRecord, string>;

  constructor(name = 'cipherpad') {
    super(name);
    this.version(1).stores({
      notes: 'noteId, updatedAt, deleted',
      meta: 'key'
    });
    this.version(2)
      .stores({
        notes: 'noteId, updatedAt, deleted, dirty',
        meta: 'key'
      })
      .upgrade((tx) => {
        return tx
          .table<NoteRecord>('notes')
          .toCollection()
          .modify((row) => {
            row.dirty = 0;
            row.baseRevision = row.revision;
          });
      });
  }
}

export function openDb(name = 'cipherpad'): CipherpadDb {
  return new CipherpadDb(name);
}

export async function readMeta(db: CipherpadDb, key: string): Promise<string | null> {
  const row = await db.meta.get(key);
  return row?.value ?? null;
}

export async function writeMeta(db: CipherpadDb, key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}
