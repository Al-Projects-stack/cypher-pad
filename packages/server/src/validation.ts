import { z } from 'zod';

function b64urlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  let b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const mod = b64.length % 4;
  if (mod === 2) b64 += '==';
  else if (mod === 3) b64 += '=';
  else if (mod !== 0) return null;
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function b64urlBytes(min: number, max: number) {
  return z
    .string()
    .min(4)
    .max(8192)
    .refine((v) => {
      const b = b64urlToBytes(v);
      return b !== null && b.length >= min && b.length <= max;
    }, 'Invalid encoded field');
}

function b64urlBlob(minBytes: number, maxBytes: number) {
  const maxChars = Math.ceil(maxBytes / 3) * 4 + 4;
  return z
    .string()
    .min(4)
    .max(maxChars)
    .refine((v) => {
      const b = b64urlToBytes(v);
      return b !== null && b.length >= minBytes && b.length <= maxBytes;
    }, 'Invalid encoded field');
}

const emailField = z.string().trim().toLowerCase().email().max(254);

export const registerSchema = z.object({
  email: emailField,
  salt: b64urlBytes(16, 64),
  kdfIterations: z.number().int().min(1000).max(2000000),
  authKey: b64urlBytes(32, 32),
  wrappedVaultIv: b64urlBytes(12, 12),
  wrappedVaultData: b64urlBytes(48, 2048),
  wrappedRecoveryIv: b64urlBytes(12, 12).optional(),
  wrappedRecoveryData: b64urlBytes(48, 2048).optional(),
  recoveryAuth: b64urlBytes(32, 32).optional()
});

export const preloginSchema = z.object({
  email: emailField
});

export const recoveryStartSchema = z.object({
  email: emailField
});

export const loginSchema = z.object({
  email: emailField,
  authKey: b64urlBytes(32, 32)
});

export const changePasswordSchema = z.object({  newSalt: b64urlBytes(16, 64),
  newKdfIterations: z.number().int().min(1000).max(2000000),
  newAuthKey: b64urlBytes(32, 32),
  newWrappedVaultIv: b64urlBytes(12, 12),
  newWrappedVaultData: b64urlBytes(48, 2048),
  newWrappedRecoveryIv: b64urlBytes(12, 12).optional(),
  newWrappedRecoveryData: b64urlBytes(48, 2048).optional()
});

export const rotateRecoverySchema = z.object({
  newWrappedRecoveryIv: b64urlBytes(12, 12),
  newWrappedRecoveryData: b64urlBytes(48, 2048),
  newRecoveryVerifier: b64urlBytes(32, 32)
});

export const recoverSchema = z
  .object({
    email: emailField,
    recoveryAuth: b64urlBytes(32, 32),
    newSalt: b64urlBytes(16, 64),
    newKdfIterations: z.number().int().min(1000).max(2000000),
    newAuthKey: b64urlBytes(32, 32),
    newWrappedVaultIv: b64urlBytes(12, 12),
    newWrappedVaultData: b64urlBytes(48, 2048),
    newWrappedRecoveryIv: b64urlBytes(12, 12).optional(),
    newWrappedRecoveryData: b64urlBytes(48, 2048).optional(),
    newRecoveryVerifier: b64urlBytes(32, 32).optional()
  })
  .refine((v) => {
    const parts = [v.newWrappedRecoveryIv, v.newWrappedRecoveryData, v.newRecoveryVerifier];
    const present = parts.filter((p) => p !== undefined).length;
    return present === 0 || present === 3;
  }, 'Invalid recovery rotation');

export type RegisterInput = z.infer<typeof registerSchema>;
export type PreloginInput = z.infer<typeof preloginSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

const noteIdField = z.string().uuid().max(36);

export const pushNoteSchema = z
  .object({
    id: noteIdField,
    baseRevision: z.number().int().min(0).max(1000000),
    revision: z.number().int().min(1).max(1000001),
    ciphertext: b64urlBlob(16, 400000),
    iv: b64urlBytes(12, 12),
    deleted: z.boolean()
  })
  .refine((n) => n.revision >= n.baseRevision, 'Invalid revision step');

export const pushSchema = z.object({
  notes: z.array(pushNoteSchema).min(1).max(100)
});

export const pullQuerySchema = z.object({
  cursor: z
    .string()
    .regex(/^\d{1,20}$/)
    .default('0')
});

export type PushInput = z.infer<typeof pushSchema>;
export type PushNote = z.infer<typeof pushNoteSchema>;

export function decodeB64url(value: string): Uint8Array {
  const b = b64urlToBytes(value);
  if (!b) throw new Error('Invalid encoded field');
  return b;
}
