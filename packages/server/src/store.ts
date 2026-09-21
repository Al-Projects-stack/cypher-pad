import { randomUUID } from 'node:crypto';
import type { DbLike } from './db.js';

export interface UserRow {
  id: string;
  email: string;
  salt: Buffer;
  kdf_iterations: number;
  kdf_hash: string;
  kdf_algorithm: string;
  kdf_version: number;
  auth_verifier: string;
  wrapped_vault_iv: Buffer;
  wrapped_vault_data: Buffer;
  wrapped_recovery_iv: Buffer | null;
  wrapped_recovery_data: Buffer | null;
}

export interface SessionRow {
  id: string;
  user_id: string;
  refresh_hash: string;
  expires_at: Date;
}

export async function findUserByEmail(db: DbLike, email: string): Promise<UserRow | null> {
  const res = await db.query<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
  return res.rows[0] ?? null;
}

export async function findUserById(db: DbLike, id: string): Promise<UserRow | null> {
  const res = await db.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
  return res.rows[0] ?? null;
}

export interface CreateUserInput {
  email: string;
  salt: Buffer;
  kdfIterations: number;
  authVerifier: string;
  wrappedVaultIv: Buffer;
  wrappedVaultData: Buffer;
  wrappedRecoveryIv: Buffer | null;
  wrappedRecoveryData: Buffer | null;
}

export async function createUser(db: DbLike, input: CreateUserInput): Promise<UserRow> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO users
     (id, email, salt, kdf_iterations, auth_verifier, wrapped_vault_iv, wrapped_vault_data, wrapped_recovery_iv, wrapped_recovery_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      input.email,
      input.salt,
      input.kdfIterations,
      input.authVerifier,
      input.wrappedVaultIv,
      input.wrappedVaultData,
      input.wrappedRecoveryIv,
      input.wrappedRecoveryData
    ]
  );
  const row = await findUserById(db, id);
  if (!row) throw new Error('User insert failed');
  return row;
}

export async function updateUserCredentials(
  db: DbLike,
  userId: string,
  input: {
    salt: Buffer;
    kdfIterations: number;
    authVerifier: string;
    wrappedVaultIv: Buffer;
    wrappedVaultData: Buffer;
    wrappedRecoveryIv: Buffer | null;
    wrappedRecoveryData: Buffer | null;
  }
): Promise<void> {
  await db.query(
    `UPDATE users SET salt = $2, kdf_iterations = $3, auth_verifier = $4,
     wrapped_vault_iv = $5, wrapped_vault_data = $6,
     wrapped_recovery_iv = $7, wrapped_recovery_data = $8, updated_at = now()
     WHERE id = $1`,
    [
      userId,
      input.salt,
      input.kdfIterations,
      input.authVerifier,
      input.wrappedVaultIv,
      input.wrappedVaultData,
      input.wrappedRecoveryIv,
      input.wrappedRecoveryData
    ]
  );
}

export async function createSession(
  db: DbLike,
  userId: string,
  refreshHash: string,
  expiresAt: Date,
  ip: string | null
): Promise<SessionRow> {
  const id = randomUUID();
  await db.query('INSERT INTO sessions (id, user_id, refresh_hash, expires_at, ip) VALUES ($1, $2, $3, $4, $5)', [
    id,
    userId,
    refreshHash,
    expiresAt,
    ip
  ]);
  return { id, user_id: userId, refresh_hash: refreshHash, expires_at: expiresAt };
}

export async function findSessionByRefreshHash(db: DbLike, refreshHash: string): Promise<SessionRow | null> {
  const res = await db.query<SessionRow>('SELECT id, user_id, refresh_hash, expires_at FROM sessions WHERE refresh_hash = $1', [
    refreshHash
  ]);
  return res.rows[0] ?? null;
}

export async function deleteSessionByRefreshHash(db: DbLike, refreshHash: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE refresh_hash = $1', [refreshHash]);
}

export async function deleteUserSessions(db: DbLike, userId: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

export async function deleteExpiredSessions(db: DbLike): Promise<void> {
  await db.query('DELETE FROM sessions WHERE expires_at < now()', []);
}

export interface NoteRow {
  user_id: string;
  id: string;
  revision: number;
  ciphertext: Buffer;
  iv: Buffer;
  deleted: boolean;
  change_seq: string;
  size: number;
  updated_at: Date;
}

export async function findNote(db: DbLike, userId: string, id: string): Promise<NoteRow | null> {
  const res = await db.query<NoteRow>('SELECT * FROM notes WHERE user_id = $1 AND id = $2', [userId, id]);
  return res.rows[0] ?? null;
}

export interface StoreNoteInput {
  id: string;
  revision: number;
  ciphertext: Buffer;
  iv: Buffer;
  deleted: boolean;
  size: number;
}

export async function storeNote(db: DbLike, userId: string, input: StoreNoteInput): Promise<NoteRow> {
  const existing = await findNote(db, userId, input.id);
  if (!existing) {
    await db.query(
      `INSERT INTO notes (user_id, id, revision, ciphertext, iv, deleted, size) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, input.id, input.revision, input.ciphertext, input.iv, input.deleted, input.size]
    );
  } else {
    await db.query(
      `UPDATE notes SET revision = $3, ciphertext = $4, iv = $5, deleted = $6, size = $7,
       change_seq = nextval('notes_change_seq_seq'), updated_at = now()
       WHERE user_id = $1 AND id = $2`,
      [userId, input.id, input.revision, input.ciphertext, input.iv, input.deleted, input.size]
    );
  }
  const row = await findNote(db, userId, input.id);
  if (!row) throw new Error('Note store failed');
  return row;
}

export async function pullNotes(db: DbLike, userId: string, cursor: string, limit: number): Promise<NoteRow[]> {
  const res = await db.query<NoteRow>(
    `SELECT * FROM notes WHERE user_id = $1 AND change_seq > $2 ORDER BY change_seq ASC LIMIT $3`,
    [userId, cursor, limit]
  );
  return res.rows;
}
