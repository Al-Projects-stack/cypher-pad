import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

export interface DbLike {
  query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

export function createPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl });
}

export function loadSchemaSql(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const primary = join(here, 'schema.sql');
  try {
    return readFileSync(primary, 'utf8');
  } catch {
    const fallback = join(here, '..', 'src', 'schema.sql');
    return readFileSync(fallback, 'utf8');
  }
}

export async function migrate(db: DbLike): Promise<void> {
  const sql = loadSchemaSql();
  await db.query(sql, []);
}

const MIGRATE_LOCK_KEY = 829371;

export async function migrateLocked(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATE_LOCK_KEY]);
    await client.query(loadSchemaSql());
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATE_LOCK_KEY]);
    } finally {
      client.release();
    }
  }
}
