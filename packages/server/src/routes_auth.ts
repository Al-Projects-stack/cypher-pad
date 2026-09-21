import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { DEFAULT_KDF_ITERATIONS, DUMMY_SALT_BYTES } from './constants.js';
import { dummyVerify, hashAuthKey, hashRefreshToken, newRefreshToken, signAccessToken, verifyAccessToken, verifyAuthKey } from './auth.js';
import type { AppConfig } from './config.js';
import type { DbLike } from './db.js';
import { LOGIN_ACCOUNT, LOGIN_IP, PRELOGIN_IP, REGISTER_IP, checkRateLimit } from './rateLimit.js';
import {
  createSession,
  createUser,
  deleteSessionByRefreshHash,
  deleteUserSessions,
  findSessionByRefreshHash,
  findUserByEmail,
  findUserById,
  updateUserCredentials
} from './store.js';
import { changePasswordSchema, decodeB64url, loginSchema, preloginSchema, registerSchema } from './validation.js';

export const REFRESH_COOKIE = 'cp_refresh';

function toBuffer(b: Uint8Array): Buffer {
  return Buffer.from(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
}

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function clientIp(req: FastifyRequest): string {
  return req.ip ?? 'unknown';
}

async function issueSession(
  db: DbLike,
  reply: FastifyReply,
  cfg: AppConfig,
  userId: string,
  email: string,
  ip: string | null
): Promise<string> {
  const refresh = newRefreshToken();
  const refreshHash = hashRefreshToken(refresh);
  const expiresAt = new Date(Date.now() + cfg.REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  await createSession(db, userId, refreshHash, expiresAt, ip);
  reply.setCookie(REFRESH_COOKIE, refresh, {
    httpOnly: true,
    secure: cfg.COOKIE_SECURE,
    sameSite: 'strict',
    path: '/',
    maxAge: cfg.REFRESH_TTL_DAYS * 24 * 60 * 60
  });
  return signAccessToken(userId, email, cfg.JWT_SECRET, cfg.ACCESS_TTL_SECONDS);
}

export async function requireAuthUser(
  req: FastifyRequest,
  cfg: AppConfig
): Promise<{ userId: string; email: string } | null> {
  const header = req.headers['authorization'];
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7);
  if (!token) return null;
  return verifyAccessToken(token, cfg.JWT_SECRET);
}

export function registerAuthRoutes(app: FastifyInstance, db: DbLike, cfg: AppConfig): void {
  app.post('/auth/register', async (req, reply) => {
    const ip = clientIp(req);
    if (!checkRateLimit(`register:${ip}`, REGISTER_IP)) {
      return reply.code(429).send({ error: 'Too many requests' });
    }
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request' });
    }
    const body = parsed.data;
    const existing = await findUserByEmail(db, body.email);
    if (existing) {
      return reply.code(409).send({ error: 'Email already registered' });
    }
    const authBytes = decodeB64url(body.authKey);
    const verifier = await hashAuthKey(authBytes);
    const user = await createUser(db, {
      email: body.email,
      salt: toBuffer(decodeB64url(body.salt)),
      kdfIterations: body.kdfIterations,
      authVerifier: verifier,
      wrappedVaultIv: toBuffer(decodeB64url(body.wrappedVaultIv)),
      wrappedVaultData: toBuffer(decodeB64url(body.wrappedVaultData)),
      wrappedRecoveryIv: body.wrappedRecoveryIv ? toBuffer(decodeB64url(body.wrappedRecoveryIv)) : null,
      wrappedRecoveryData: body.wrappedRecoveryData ? toBuffer(decodeB64url(body.wrappedRecoveryData)) : null
    });
    const accessToken = await issueSession(db, reply, cfg, user.id, user.email, ip);
    req.log.info({ userId: user.id, route: 'register' }, 'user registered');
    return reply.code(201).send({ userId: user.id, accessToken });
  });

  app.post('/auth/prelogin', async (req, reply) => {
    const ip = clientIp(req);
    if (!checkRateLimit(`prelogin:${ip}`, PRELOGIN_IP)) {
      return reply.code(429).send({ error: 'Too many requests' });
    }
    const parsed = preloginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request' });
    }
    const user = await findUserByEmail(db, parsed.data.email);
    if (!user) {
      const dummy = b64url(DUMMY_SALT_BYTES());
      return reply.send({
        salt: dummy,
        kdfIterations: DEFAULT_KDF_ITERATIONS,
        kdfHash: 'SHA-256',
        kdfAlgorithm: 'PBKDF2',
        kdfVersion: 1
      });
    }
    return reply.send({
      salt: Buffer.from(user.salt).toString('base64url'),
      kdfIterations: user.kdf_iterations,
      kdfHash: user.kdf_hash,
      kdfAlgorithm: user.kdf_algorithm,
      kdfVersion: user.kdf_version
    });
  });

  app.post('/auth/login', async (req, reply) => {
    const ip = clientIp(req);
    if (!checkRateLimit(`login-ip:${ip}`, LOGIN_IP)) {
      return reply.code(429).send({ error: 'Too many requests' });
    }
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request' });
    }
    if (!checkRateLimit(`login-acct:${parsed.data.email}`, LOGIN_ACCOUNT)) {
      return reply.code(429).send({ error: 'Too many requests' });
    }
    const user = await findUserByEmail(db, parsed.data.email);
    if (!user) {
      await dummyVerify();
      return reply.code(401).send({ error: 'Invalid credentials' });
    }
    const authBytes = decodeB64url(parsed.data.authKey);
    const ok = await verifyAuthKey(authBytes, user.auth_verifier);
    if (!ok) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }
    const accessToken = await issueSession(db, reply, cfg, user.id, user.email, ip);
    req.log.info({ userId: user.id, route: 'login' }, 'user login');
    return reply.send({ userId: user.id, accessToken });
  });

  app.post('/auth/refresh', async (req, reply) => {
    const raw = req.cookies[REFRESH_COOKIE];
    if (typeof raw !== 'string' || !raw) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }
    const hash = hashRefreshToken(raw);
    const session = await findSessionByRefreshHash(db, hash);
    if (!session || session.expires_at.getTime() < Date.now()) {
      if (session) await deleteSessionByRefreshHash(db, hash);
      reply.clearCookie(REFRESH_COOKIE, { path: '/' });
      return reply.code(401).send({ error: 'Invalid credentials' });
    }
    const user = await findUserById(db, session.user_id);
    if (!user) {
      await deleteSessionByRefreshHash(db, hash);
      reply.clearCookie(REFRESH_COOKIE, { path: '/' });
      return reply.code(401).send({ error: 'Invalid credentials' });
    }
    await deleteSessionByRefreshHash(db, hash);
    const accessToken = await issueSession(db, reply, cfg, user.id, user.email, clientIp(req));
    return reply.send({ userId: user.id, accessToken });
  });

  app.post('/auth/logout', async (req, reply) => {
    const raw = req.cookies[REFRESH_COOKIE];
    if (typeof raw === 'string' && raw) {
      await deleteSessionByRefreshHash(db, hashRefreshToken(raw));
    }
    reply.clearCookie(REFRESH_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.post('/auth/change_password', async (req, reply) => {
    const auth = await requireAuthUser(req, cfg);
    if (!auth) return reply.code(401).send({ error: 'Invalid credentials' });
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request' });
    }
    const user = await findUserById(db, auth.userId);
    if (!user) return reply.code(401).send({ error: 'Invalid credentials' });
    const newAuthBytes = decodeB64url(parsed.data.newAuthKey);
    const verifier = await hashAuthKey(newAuthBytes);
    await updateUserCredentials(db, user.id, {
      salt: toBuffer(decodeB64url(parsed.data.newSalt)),
      kdfIterations: parsed.data.newKdfIterations,
      authVerifier: verifier,
      wrappedVaultIv: toBuffer(decodeB64url(parsed.data.newWrappedVaultIv)),
      wrappedVaultData: toBuffer(decodeB64url(parsed.data.newWrappedVaultData)),
      wrappedRecoveryIv: parsed.data.newWrappedRecoveryIv
        ? toBuffer(decodeB64url(parsed.data.newWrappedRecoveryIv))
        : null,
      wrappedRecoveryData: parsed.data.newWrappedRecoveryData
        ? toBuffer(decodeB64url(parsed.data.newWrappedRecoveryData))
        : null
    });
    await deleteUserSessions(db, user.id);
    const accessToken = await issueSession(db, reply, cfg, user.id, user.email, clientIp(req));
    req.log.info({ userId: user.id, route: 'change_password' }, 'password changed');
    return reply.send({ userId: user.id, accessToken });
  });

  app.get('/auth/me', async (req, reply) => {
    const auth = await requireAuthUser(req, cfg);
    if (!auth) return reply.code(401).send({ error: 'Invalid credentials' });
    const user = await findUserById(db, auth.userId);
    if (!user) return reply.code(401).send({ error: 'Invalid credentials' });
    return reply.send({ userId: user.id, email: user.email });
  });
}
