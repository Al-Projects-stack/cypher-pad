import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash, type BinaryLike } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const SCRYPT_SALT_BYTES = 16;

function scryptKey(password: Uint8Array, salt: Uint8Array): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password as unknown as BinaryLike, salt as unknown as BinaryLike, SCRYPT_KEYLEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P
    }, (err, derived) => {
      if (err) reject(err);
      else resolve(derived as Buffer);
    });
  });
}

export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function hashAuthKey(authKey: Uint8Array): Promise<string> {
  if (authKey.length !== 32) throw new Error('Invalid proof size');
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const derived = await scryptKey(authKey, salt);
  return [
    'scrypt',
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString('base64url'),
    derived.toString('base64url')
  ].join('$');
}

function parseVerifier(stored: string): { salt: Buffer; hash: Buffer } | null {
  const parts = stored.split('$');
  if (parts.length !== 6) return null;
  if (parts[0] !== 'scrypt') return null;
  try {
    const salt = Buffer.from(parts[4] ?? '', 'base64url');
    const hash = Buffer.from(parts[5] ?? '', 'base64url');
    if (salt.length !== SCRYPT_SALT_BYTES) return null;
    if (hash.length !== SCRYPT_KEYLEN) return null;
    return { salt, hash };
  } catch {
    return null;
  }
}

export async function verifyAuthKey(authKey: Uint8Array, stored: string): Promise<boolean> {
  const parsed = parseVerifier(stored);
  if (!parsed) return false;
  if (authKey.length !== 32) return false;
  try {
    const derived = await scryptKey(authKey, parsed.salt);
    if (derived.length !== parsed.hash.length) return false;
    return timingSafeEqual(derived, parsed.hash);
  } catch {
    return false;
  }
}

export async function dummyVerify(): Promise<void> {
  const fakeKey = randomBytes(32);
  const fakeSalt = randomBytes(SCRYPT_SALT_BYTES);
  try {
    await scryptKey(fakeKey, fakeSalt);
  } catch {
    return;
  }
}

export async function signAccessToken(
  userId: string,
  email: string,
  secret: string,
  ttlSeconds: number
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ sub: userId, email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer('cipherpad')
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key);
}

export async function verifyAccessToken(
  token: string,
  secret: string
): Promise<{ userId: string; email: string } | null> {
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key, { issuer: 'cipherpad' });
    const sub = payload['sub'];
    const email = payload['email'];
    if (typeof sub !== 'string' || typeof email !== 'string') return null;
    return { userId: sub, email };
  } catch {
    return null;
  }
}
