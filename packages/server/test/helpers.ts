import { randomBytes, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { buildApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import { loadSchemaSql, migrate, type DbLike } from '../src/db.js';
import { clearRateLimits } from '../src/rateLimit.js';

export interface TestContext {
  app: Awaited<ReturnType<typeof buildApp>>;
  db: DbLike;
  cfg: AppConfig;
  cleanup: () => Promise<void>;
}

export function b64urlOf(n: number): string {
  return randomBytes(n).toString('base64url');
}

export function testVectors(): { salt: string; authKey: string; iv: string; data: string } {
  return { salt: b64urlOf(16), authKey: b64urlOf(32), iv: b64urlOf(12), data: b64urlOf(48) };
}

export interface RegisteredUser {
  userId: string;
  email: string;
  accessToken: string;
  refreshCookie: string;
  vectors: { salt: string; authKey: string; iv: string; data: string };
}

export async function registerUser(app: FastifyInstance, email: string): Promise<RegisteredUser> {
  const vectors = testVectors();
  const reg = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      email,
      salt: vectors.salt,
      kdfIterations: 600000,
      authKey: vectors.authKey,
      wrappedVaultIv: vectors.iv,
      wrappedVaultData: vectors.data
    }
  });
  if (reg.statusCode !== 201) throw new Error('Test registration failed');
  const body = reg.json() as { userId: string; accessToken: string };
  const refreshCookie = refreshCookieFrom(reg) ?? '';
  if (!refreshCookie) throw new Error('Test registration cookie missing');
  return { userId: body.userId, email, accessToken: body.accessToken, refreshCookie, vectors };
}

export interface TestNote {
  id: string;
  baseRevision: number;
  revision: number;
  ciphertext: string;
  iv: string;
  deleted: boolean;
}

export function testNote(overrides: Partial<TestNote> = {}): TestNote {
  return {
    id: randomUUID(),
    baseRevision: 0,
    revision: 1,
    ciphertext: b64urlOf(64),
    iv: b64urlOf(12),
    deleted: false,
    ...overrides
  };
}

async function truncateAll(db: DbLike): Promise<void> {
  await db.query('DELETE FROM sessions', []);
  await db.query('DELETE FROM notes', []);
  await db.query('DELETE FROM users', []);
}

export async function createTestApp(): Promise<TestContext> {
  clearRateLimits();
  const realUrl = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'] ?? '';
  process.env['APP_ORIGIN'] = 'http://localhost:5173';
  process.env['JWT_SECRET'] = 'testsecret0123456789testsecret01';
  process.env['COOKIE_SECURE'] = 'false';
  const cfg = loadConfig(process.env);

  if (realUrl) {
    const pool = new Pool({ connectionString: realUrl });
    await migrate(pool);
    await truncateAll(pool);
    const app = await buildApp(cfg, pool, { logger: false });
    return {
      app,
      db: pool,
      cfg,
      cleanup: async () => {
        await truncateAll(pool);
        await pool.end();
      }
    };
  }

  const pglite = new PGlite();
  await pglite.exec(loadSchemaSql());
  const db: DbLike = {
    query: async <T = unknown>(text: string, params?: unknown[]) => {
      const res = await pglite.query<T>(text, params);
      return { rows: res.rows, rowCount: res.rowCount ?? null };
    }
  };
  const app = await buildApp(cfg, db, { logger: false });
  return {
    app,
    db,
    cfg,
    cleanup: async () => {
      await truncateAll(db);
      await pglite.close();
    }
  };
}

export function refreshCookieFrom(res: { headers: Record<string, unknown> }): string | null {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  for (const entry of list) {
    const s = String(entry);
    if (s.startsWith('cp_refresh=')) {
      const semi = s.indexOf(';');
      const pair = semi >= 0 ? s.slice(0, semi) : s;
      const value = pair.slice('cp_refresh='.length);
      if (value) return decodeURIComponent(value);
    }
  }
  return null;
}
