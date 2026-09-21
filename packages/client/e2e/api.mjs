const port = Number(process.env.E2E_API_PORT ?? 3001);
process.env.PORT = String(port);
process.env.APP_ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:5173';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'e2e test secret 0123456789abcdef';
process.env.COOKIE_SECURE = 'false';

const server = await import('@cipherpad/server');
const cfg = server.loadConfig(process.env);

let db;
let closeDb = async () => undefined;
const realUrl = process.env.TEST_DATABASE_URL ?? '';
if (realUrl) {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: realUrl });
  await server.migrate(pool);
  await pool.query('DELETE FROM sessions', []);
  await pool.query('DELETE FROM notes', []);
  await pool.query('DELETE FROM users', []);
  db = pool;
  closeDb = async () => {
    await pool.end();
  };
} else {
  const { PGlite } = await import('@electric-sql/pglite');
  const pglite = new PGlite();
  await pglite.exec(server.loadSchemaSql());
  db = {
    query: async (text, params) => {
      const res = await pglite.query(text, params);
      return { rows: res.rows, rowCount: res.rowCount ?? null };
    }
  };
  closeDb = async () => {
    await pglite.close();
  };
}

const app = await server.buildApp(cfg, db, { logger: false });
await app.listen({ port, host: '127.0.0.1' });

process.on('SIGTERM', () => void closeDb().finally(() => process.exit(0)));
process.on('SIGINT', () => void closeDb().finally(() => process.exit(0)));
