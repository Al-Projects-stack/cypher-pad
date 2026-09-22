CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  salt BYTEA NOT NULL,
  kdf_iterations INTEGER NOT NULL,
  kdf_hash TEXT NOT NULL DEFAULT 'SHA-256',
  kdf_algorithm TEXT NOT NULL DEFAULT 'PBKDF2',
  kdf_version INTEGER NOT NULL DEFAULT 1,
  auth_verifier TEXT NOT NULL,
  recovery_verifier TEXT,
  wrapped_vault_iv BYTEA NOT NULL,
  wrapped_vault_data BYTEA NOT NULL,
  wrapped_recovery_iv BYTEA,
  wrapped_recovery_data BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip TEXT
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);

ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_verifier TEXT;

CREATE TABLE IF NOT EXISTS notes (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id UUID NOT NULL,
  revision INTEGER NOT NULL,
  ciphertext BYTEA NOT NULL,
  iv BYTEA NOT NULL,
  deleted BOOLEAN NOT NULL DEFAULT false,
  change_seq BIGSERIAL UNIQUE NOT NULL,
  size INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS notes_user_seq_idx ON notes(user_id, change_seq);
