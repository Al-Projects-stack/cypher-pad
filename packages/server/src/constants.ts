import { randomBytes } from 'node:crypto';

export const DEFAULT_KDF_ITERATIONS = 600000;

export function DUMMY_SALT_BYTES(): Uint8Array {
  return randomBytes(16);
}
