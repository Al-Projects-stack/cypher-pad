// Note payload encryption bound to user plus note plus revision
// Title body tags and timestamps live inside one encrypted JSON value
// Fresh IV per encryption and AAD blocks swap plus rollback

import { getSubtle, randomBytes, utf8Encode, utf8Decode } from './encoding.js';
import type { EncryptedNoteBundle, NoteContext, NotePlaintext } from './types.js';

export const NOTE_KEY_INFO_PREFIX = 'cipherpad/note/v1/';

export function buildAad(ctx: NoteContext): Uint8Array {
  if (ctx.userId.length === 0) throw new Error('Missing user id');
  if (ctx.noteId.length === 0) throw new Error('Missing note id');
  if (!Number.isInteger(ctx.revision) || ctx.revision < 0) throw new Error('Invalid revision');
  const canonical = JSON.stringify(['cipherpad/note/v1', ctx.userId, ctx.noteId, ctx.revision]);
  return utf8Encode(canonical);
}

export async function deriveNoteKey(vaultKey: CryptoKey, noteId: string): Promise<CryptoKey> {
  if (noteId.length === 0) throw new Error('Missing note id');
  const subtle = getSubtle();
  const emptySalt = new Uint8Array(0);
  return subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: emptySalt as unknown as BufferSource,
      info: utf8Encode(NOTE_KEY_INFO_PREFIX + noteId) as unknown as BufferSource
    },
    vaultKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function validateNote(note: NotePlaintext): void {
  if (typeof note.title !== 'string') throw new Error('Invalid title');
  if (typeof note.body !== 'string') throw new Error('Invalid body');
  if (!Array.isArray(note.tags)) throw new Error('Invalid tags');
  for (const t of note.tags) {
    if (typeof t !== 'string') throw new Error('Invalid tag entry');
  }
  if (typeof note.createdAt !== 'string') throw new Error('Invalid created timestamp');
  if (typeof note.updatedAt !== 'string') throw new Error('Invalid updated timestamp');
  if (utf8Encode(JSON.stringify(note)).length > 1024 * 256) {
    throw new Error('Note payload is too large');
  }
}

export async function encryptNote(
  vaultKey: CryptoKey,
  note: NotePlaintext,
  ctx: NoteContext
): Promise<EncryptedNoteBundle> {
  validateNote(note);
  const subtle = getSubtle();
  const noteKey = await deriveNoteKey(vaultKey, ctx.noteId);
  const iv = randomBytes(12);
  const aad = buildAad(ctx);
  const plain = utf8Encode(JSON.stringify(note));
  const ciphertext = new Uint8Array(
    await subtle.encrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource, additionalData: aad as unknown as BufferSource },
      noteKey,
      plain as unknown as BufferSource
    )
  );
  return { iv, ciphertext, version: 1 };
}

export async function decryptNote(
  vaultKey: CryptoKey,
  bundle: EncryptedNoteBundle,
  ctx: NoteContext
): Promise<NotePlaintext> {
  if (bundle.version !== 1) throw new Error('Unsupported note version');
  if (bundle.iv.length !== 12) throw new Error('Invalid note IV size');
  if (bundle.ciphertext.length === 0) throw new Error('Invalid ciphertext');
  const subtle = getSubtle();
  const noteKey = await deriveNoteKey(vaultKey, ctx.noteId);
  const aad = buildAad(ctx);
  let plain: ArrayBuffer;
  try {
    plain = await subtle.decrypt(
      { name: 'AES-GCM', iv: bundle.iv as unknown as BufferSource, additionalData: aad as unknown as BufferSource },
      noteKey,
      bundle.ciphertext as unknown as BufferSource
    );
  } catch {
    throw new Error('Note authentication failed');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8Decode(new Uint8Array(plain)));
  } catch {
    throw new Error('Note payload is corrupt');
  }
  const note = parsed as NotePlaintext;
  validateNote(note);
  return note;
}
