// Transport serialization between binary bundles and JSON safe text
// Server stores only opaque text plus version markers

import { base64UrlEncode, base64UrlDecode } from './encoding.js';
import type {
  EncryptedNoteBundle,
  SerializedEncrypted,
  SerializedWrapped,
  WrappedKeyBundle
} from './types.js';

export function serializeWrapped(b: WrappedKeyBundle): SerializedWrapped {
  if (b.version !== 1) throw new Error('Unsupported wrapped key version');
  return { iv: base64UrlEncode(b.iv), data: base64UrlEncode(b.data) };
}

export function deserializeWrapped(o: SerializedWrapped): WrappedKeyBundle {
  const iv = base64UrlDecode(o.iv);
  const data = base64UrlDecode(o.data);
  if (iv.length !== 12) throw new Error('Invalid wrap IV size');
  if (data.length === 0) throw new Error('Invalid wrapped data');
  return { iv, data, version: 1 };
}

export function serializeEncrypted(b: EncryptedNoteBundle): SerializedEncrypted {
  if (b.version !== 1) throw new Error('Unsupported note version');
  return { iv: base64UrlEncode(b.iv), ciphertext: base64UrlEncode(b.ciphertext) };
}

export function deserializeEncrypted(o: SerializedEncrypted): EncryptedNoteBundle {
  const iv = base64UrlDecode(o.iv);
  const ciphertext = base64UrlDecode(o.ciphertext);
  if (iv.length !== 12) throw new Error('Invalid note IV size');
  if (ciphertext.length === 0) throw new Error('Invalid ciphertext');
  return { iv, ciphertext, version: 1 };
}
