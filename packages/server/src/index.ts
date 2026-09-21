import { createPool, loadSchemaSql, migrate, type DbLike } from './db.js';
import { loadConfig, type AppConfig } from './config.js';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.DATABASE_URL) throw new Error('Missing DATABASE_URL');
  const pool = createPool(cfg.DATABASE_URL);
  await migrate(pool);
  const app = await buildApp(cfg, pool, { logger: true });
  await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { buildApp, loadConfig, createPool, loadSchemaSql, migrate, type DbLike, type AppConfig };
