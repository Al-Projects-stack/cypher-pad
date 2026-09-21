import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().default(''),
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  JWT_SECRET: z.string().min(32).default('0123456789abcdef0123456789abcdef'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  COOKIE_SECURE: z.coerce.boolean().default(false),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info')
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return EnvSchema.parse({
    DATABASE_URL: env['DATABASE_URL'] ?? '',
    APP_ORIGIN: env['APP_ORIGIN'],
    JWT_SECRET: env['JWT_SECRET'],
    PORT: env['PORT'],
    ACCESS_TTL_SECONDS: env['ACCESS_TTL_SECONDS'],
    REFRESH_TTL_DAYS: env['REFRESH_TTL_DAYS'],
    COOKIE_SECURE: env['COOKIE_SECURE'],
    LOG_LEVEL: env['LOG_LEVEL']
  });
}
