import type { FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import type { DbLike } from './db.js';
import { SYNC_IP, checkRateLimit } from './rateLimit.js';
import { requireAuthUser } from './routes_auth.js';
import { findNote, findUserById, pullNotes, storeNote } from './store.js';
import { decodeB64url, pullQuerySchema, pushSchema, type PushNote } from './validation.js';

const PULL_LIMIT = 200;

function toBuffer(b: Uint8Array): Buffer {
  return Buffer.from(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
}

function toB64url(v: Uint8Array | Buffer): string {
  return Buffer.from(v).toString('base64url');
}

interface AppliedNote {
  id: string;
  revision: number;
}

interface ServerVersion {
  revision: number;
  ciphertext: string;
  iv: string;
  deleted: boolean;
  updatedAt: string;
}

interface NoteConflict {
  id: string;
  server: ServerVersion | null;
}

export function registerSyncRoutes(app: FastifyInstance, db: DbLike, cfg: AppConfig): void {
  app.get('/auth/vault', async (req, reply) => {
    const auth = await requireAuthUser(req, cfg);
    if (!auth) return reply.code(401).send({ error: 'Invalid credentials' });
    const user = await findUserById(db, auth.userId);
    if (!user) return reply.code(401).send({ error: 'Invalid credentials' });
    const out: Record<string, unknown> = {
      salt: toB64url(user.salt),
      kdfIterations: user.kdf_iterations,
      kdfHash: user.kdf_hash,
      kdfAlgorithm: user.kdf_algorithm,
      kdfVersion: user.kdf_version,
      wrappedVaultIv: toB64url(user.wrapped_vault_iv),
      wrappedVaultData: toB64url(user.wrapped_vault_data)
    };
    if (user.wrapped_recovery_iv && user.wrapped_recovery_data) {
      out['wrappedRecoveryIv'] = toB64url(user.wrapped_recovery_iv);
      out['wrappedRecoveryData'] = toB64url(user.wrapped_recovery_data);
    }
    return reply.send(out);
  });

  app.get('/sync/pull', async (req, reply) => {
    const auth = await requireAuthUser(req, cfg);
    if (!auth) return reply.code(401).send({ error: 'Invalid credentials' });
    if (!checkRateLimit(`sync:${req.ip ?? 'unknown'}`, SYNC_IP)) {
      return reply.code(429).send({ error: 'Too many requests' });
    }
    const parsed = pullQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
    const rows = await pullNotes(db, auth.userId, parsed.data.cursor, PULL_LIMIT);
    const changes = rows.map((r) => ({
      id: r.id,
      revision: r.revision,
      ciphertext: toB64url(r.ciphertext),
      iv: toB64url(r.iv),
      deleted: r.deleted,
      updatedAt: (r.updated_at instanceof Date ? r.updated_at : new Date(r.updated_at)).toISOString()
    }));
    const nextCursor = rows.length > 0 ? String(rows[rows.length - 1]?.change_seq ?? parsed.data.cursor) : parsed.data.cursor;
    req.log.info({ userId: auth.userId, route: 'pull', count: changes.length }, 'sync pull');
    return reply.send({ changes, nextCursor });
  });

  app.post('/sync/push', async (req, reply) => {
    const auth = await requireAuthUser(req, cfg);
    if (!auth) return reply.code(401).send({ error: 'Invalid credentials' });
    if (!checkRateLimit(`sync:${req.ip ?? 'unknown'}`, SYNC_IP)) {
      return reply.code(429).send({ error: 'Too many requests' });
    }
    const parsed = pushSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
    const applied: AppliedNote[] = [];
    const conflicts: NoteConflict[] = [];
    for (const note of parsed.data.notes) {
      const result = await pushOne(db, auth.userId, note);
      if (result.ok) applied.push({ id: note.id, revision: note.revision });
      else conflicts.push({ id: note.id, server: result.server });
    }
    req.log.info({ userId: auth.userId, route: 'push', applied: applied.length, conflicts: conflicts.length }, 'sync push');
    if (conflicts.length > 0) return reply.code(409).send({ applied, conflicts });
    return reply.send({ applied, conflicts });
  });
}

async function pushOne(
  db: DbLike,
  userId: string,
  note: PushNote
): Promise<{ ok: true } | { ok: false; server: ServerVersion | null }> {
  const ciphertext = toBuffer(decodeB64url(note.ciphertext));
  const iv = toBuffer(decodeB64url(note.iv));
  const current = await findNote(db, userId, note.id);
  if (!current) {
    if (note.baseRevision !== 0) return { ok: false, server: null };
    await storeNote(db, userId, { id: note.id, revision: note.revision, ciphertext, iv, deleted: note.deleted, size: ciphertext.length + iv.length });
    return { ok: true };
  }
  if (current.revision !== note.baseRevision) {
    return {
      ok: false,
      server: {
        revision: current.revision,
        ciphertext: toB64url(current.ciphertext),
        iv: toB64url(current.iv),
        deleted: current.deleted,
        updatedAt: (current.updated_at instanceof Date ? current.updated_at : new Date(current.updated_at)).toISOString()
      }
    };
  }
  await storeNote(db, userId, { id: note.id, revision: note.revision, ciphertext, iv, deleted: note.deleted, size: ciphertext.length + iv.length });
  return { ok: true };
}
