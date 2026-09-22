import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import type { DbLike } from './db.js';
import { registerAuthRoutes } from './routes_auth.js';
import { registerSyncRoutes } from './routes_sync.js';

export interface BuildOptions {
  logger?: boolean;
}

export async function buildApp(cfg: AppConfig, db: DbLike, opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === true ? { level: cfg.LOG_LEVEL, redact: redactPaths() } : false,
    bodyLimit: 512 * 1024,
    trustProxy: false
  });

  await app.register(cookie);
  await app.register(cors, { origin: cfg.APP_ORIGIN, credentials: true, methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"]
      }
    },
    hsts: { maxAge: 31536000, includeSubDomains: true },
    frameguard: { action: 'deny' },
    noSniff: true
  });
  await app.register(rateLimit, { max: 300, timeWindow: 60 * 1000 });

  app.get('/health', async () => ({ ok: true }));

  registerAuthRoutes(app, db, cfg);
  registerSyncRoutes(app, db, cfg);

  app.setErrorHandler((err: FastifyError, _req, reply) => {
    const status = typeof err.statusCode === 'number' ? err.statusCode : 500;
    if (status >= 500) {
      reply.code(500).send({ error: 'Internal error' });
    } else {
      reply.code(status).send({ error: 'Invalid request' });
    }
  });

  return app;
}

function redactPaths(): string[] {
  return [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.body.authKey',
    'req.body.newAuthKey',
    'req.body.recoveryAuth',
    'req.body.newRecoveryVerifier',
    'req.body.wrappedVaultData',
    'req.body.wrappedVaultIv',
    'req.body.newWrappedVaultData',
    'req.body.newWrappedVaultIv',
    'req.body.wrappedRecoveryData',
    'req.body.newWrappedRecoveryData',
    'req.body.salt',
    'req.body.newSalt',
    'req.body.notes',
    'res.headers["set-cookie"]'
  ];
}
