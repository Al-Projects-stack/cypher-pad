// Public entry for the crypto package
// Reexported modules cover keys vault notes recovery and encoding

export type {
  KdfParams,
  WrappedKeyBundle,
  EncryptedNoteBundle,
  NotePlaintext,
  NoteContext,
  SerializedWrapped,
  SerializedEncrypted
} from './types.js';

export {
  getSubtle,
  randomBytes,
  base64Encode,
  base64Decode,
  base64UrlEncode,
  base64UrlDecode,
  clearBytes,
  constantTimeEqual,
  utf8Encode,
  utf8Decode,
  hexEncode,
  hexDecode
} from './encoding.js';

export {
  DEFAULT_KDF_PARAMS,
  AUTH_INFO,
  KEK_INFO,
  generateSalt,
  validateKdfParams,
  deriveMasterKey,
  splitMasterKey,
  encodeAuthKey
} from './keys.js';

export { importVaultKey, wrapVaultKey, unwrapVaultKey, createVault } from './vault.js';

export {
  NOTE_KEY_INFO_PREFIX,
  buildAad,
  deriveNoteKey,
  encryptNote,
  decryptNote
} from './notes.js';

export {
  CROCKFORD_ALPHABET,
  RECOVERY_INFO,
  encodeCrockford,
  decodeCrockford,
  normalizeRecoveryInput,
  groupRecoveryText,
  generateRecoveryKey,
  parseRecoveryKey,
  wrapVaultWithRecovery,
  unwrapVaultWithRecovery
} from './recovery.js';

export {
  serializeWrapped,
  deserializeWrapped,
  serializeEncrypted,
  deserializeEncrypted
} from './serialize.js';
