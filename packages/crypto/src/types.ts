// Core shapes shared across the crypto package
// All prose here avoids dash characters per project docs rule

export interface KdfParams {
  algorithm: 'PBKDF2';
  hash: 'SHA-256';
  iterations: number;
  saltBytes: number;
  outputBytes: number;
  version: 1;
}

export interface WrappedKeyBundle {
  iv: Uint8Array;
  data: Uint8Array;
  version: 1;
}

export interface EncryptedNoteBundle {
  iv: Uint8Array;
  ciphertext: Uint8Array;
  version: 1;
}

export interface NotePlaintext {
  title: string;
  body: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface NoteContext {
  userId: string;
  noteId: string;
  revision: number;
}

export interface SerializedWrapped {
  iv: string;
  data: string;
}

export interface SerializedEncrypted {
  iv: string;
  ciphertext: string;
}
