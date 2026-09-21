import { readMeta, writeMeta, type CipherpadDb } from '../notes/db.js';
import {
  applyPulledNote,
  createConflictCopy,
  getDirtyNotes,
  markPushed,
  rebaseNote,
  type PulledChange
} from '../notes/store.js';
import type { OpenVault } from '../vault/session.js';
import type { SyncAccount } from './account.js';
import { SyncHttpError, type PushResult } from './api.js';

export interface SyncSummary {
  pushed: number;
  pulled: number;
  conflicts: number;
}

async function withAuth<T>(account: SyncAccount, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof SyncHttpError && err.status === 401) {
      const ok = await account.refresh();
      if (!ok) throw err;
      return run();
    }
    throw err;
  }
}

async function pushDirty(account: SyncAccount, db: CipherpadDb, vault: OpenVault): Promise<SyncSummary> {
  const dirty = await getDirtyNotes(db);
  if (dirty.length === 0) return { pushed: 0, pulled: 0, conflicts: 0 };
  let pushed = 0;
  let conflicts = 0;
  const payload = dirty.map((d) => ({ ...d }));
  try {
    const res = await withAuth(account, () => account.client.push(payload));
    for (const a of res.applied) {
      await markPushed(db, a.id, a.revision);
      pushed += 1;
    }
    return { pushed, pulled: 0, conflicts };
  } catch (err) {
    if (err instanceof SyncHttpError && err.status === 409 && err.body) {
      const body: PushResult = err.body;
      for (const a of body.applied) {
        await markPushed(db, a.id, a.revision);
        pushed += 1;
      }
      for (const c of body.conflicts) {
        conflicts += 1;
        if (c.server === null) {
          await rebaseNote(db, c.id, 0);
        } else {
          await createConflictCopy(db, vault, { ...c.server, id: c.id });
        }
      }
      return { pushed, pulled: 0, conflicts };
    }
    throw err;
  }
}

async function pullRemote(account: SyncAccount, db: CipherpadDb, vault: OpenVault): Promise<SyncSummary> {
  let pulled = 0;
  let conflicts = 0;
  let cursor = (await readMeta(db, 'syncCursor')) ?? '0';
  for (let page = 0; page < 50; page++) {
    const res = await withAuth(account, () => account.client.pull(cursor));
    for (const change of res.changes) {
      const item: PulledChange = { ...change };
      const outcome = await applyPulledNote(db, vault, item);
      if (outcome === 'inserted' || outcome === 'updated') pulled += 1;
      if (outcome === 'conflict') {
        conflicts += 1;
        await createConflictCopy(db, vault, item);
      }
    }
    if (res.changes.length === 0 || res.nextCursor === cursor) {
      cursor = res.nextCursor;
      break;
    }
    cursor = res.nextCursor;
  }
  await writeMeta(db, 'syncCursor', cursor);
  return { pushed: 0, pulled, conflicts };
}

export async function syncNow(account: SyncAccount, db: CipherpadDb, vault: OpenVault): Promise<SyncSummary> {
  if (!account.accessToken) {
    const ok = await account.refresh();
    if (!ok) throw new SyncHttpError(401, 'Not linked');
  }
  const push = await pushDirty(account, db, vault);
  const pull = await pullRemote(account, db, vault);
  return { pushed: push.pushed, pulled: pull.pulled, conflicts: push.conflicts + pull.conflicts };
}

export interface BackgroundHandle {
  stop(): void;
  syncNow(): Promise<SyncSummary>;
}

export function startBackgroundSync(
  account: SyncAccount,
  getDb: () => CipherpadDb | null,
  getVault: () => OpenVault | null,
  intervalMs = 15000,
  onSettled?: (summary: SyncSummary) => void
): BackgroundHandle {
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function runOnce(): Promise<SyncSummary> {
    const db = getDb();
    const vault = getVault();
    if (!db || !vault || !account.accessToken) return { pushed: 0, pulled: 0, conflicts: 0 };
    if (running) return { pushed: 0, pulled: 0, conflicts: 0 };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { pushed: 0, pulled: 0, conflicts: 0 };
    running = true;
    try {
      const summary = await syncNow(account, db, vault);
      if (onSettled) {
        try {
          onSettled(summary);
        } catch {
          void 0;
        }
      }
      return summary;
    } catch {
      return { pushed: 0, pulled: 0, conflicts: 0 };
    } finally {
      running = false;
    }
  }

  if (typeof window !== 'undefined') {
    timer = setInterval(() => void runOnce(), intervalMs);
    window.addEventListener('online', () => void runOnce());
  }

  return {
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
    syncNow: runOnce
  };
}
