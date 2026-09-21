import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { CipherpadDb, openDb } from './notes/db.js';
import { renderMarkdown } from './notes/markdown.js';
import { NoteSearch } from './notes/search.js';
import { createNote, deleteNote, listNotes, updateNote, type NoteView } from './notes/store.js';
import { startBackgroundSync, syncNow, type BackgroundHandle } from './sync/engine.js';
import { DEFAULT_SYNC_URL, SyncAccount } from './sync/account.js';
import { createVaultLocal, hasVault, lockVault, unlockVault, type OpenVault } from './vault/session.js';

type Mode = 'checking' | 'create' | 'unlock' | 'ready';

function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
}

export function App(): ReactElement {
  const [db] = useState<CipherpadDb>(() => openDb());
  const [mode, setMode] = useState<Mode>('checking');
  const [vault, setVault] = useState<OpenVault | null>(null);
  const [notes, setNotes] = useState<NoteView[]>([]);
  const [searchIndex] = useState<NoteSearch>(() => new NoteSearch());
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  const [preview, setPreview] = useState(false);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [account] = useState<SyncAccount>(() => new SyncAccount(DEFAULT_SYNC_URL));
  const [syncEmail, setSyncEmail] = useState('');
  const [syncPassword, setSyncPassword] = useState('');
  const [syncUrl, setSyncUrl] = useState(account.baseUrl);
  const [syncStatus, setSyncStatus] = useState('');
  const [accountTick, setAccountTick] = useState(0);
  const vaultRef = useRef<OpenVault | null>(null);
  const bgRef = useRef<BackgroundHandle | null>(null);
  void accountTick;

  useEffect(() => {
    let live = true;
    hasVault(db)
      .then((exists) => {
        if (live) setMode(exists ? 'unlock' : 'create');
      })
      .catch(() => {
        if (live) setError('Storage is unavailable');
      });
    return () => {
      live = false;
    };
  }, [db]);

  useEffect(() => {
    vaultRef.current = vault;
  }, [vault]);

  useEffect(() => {
    if (mode !== 'ready' || !vault) return;
    const handle = startBackgroundSync(
      account,
      () => db,
      () => vaultRef.current,
      15000,
      (summary) => {
        const current = vaultRef.current;
        if (current && summary.pushed + summary.pulled + summary.conflicts > 0) {
          void refresh(current).catch(() => undefined);
        }
      }
    );
    bgRef.current = handle;
    return () => handle.stop();
  }, [mode, vault, db, account]);

  async function refresh(v: OpenVault): Promise<void> {
    const all = await listNotes(db, v);
    setNotes(all);
    searchIndex.rebuild(all.map((n) => ({ noteId: n.noteId, title: n.title, body: n.body, tags: n.tags })));
  }

  async function handleCreateVault(): Promise<void> {
    setError('');
    if (!password) {
      setError('Password is required');
      return;
    }
    if (password !== repeat) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    try {
      const v = await createVaultLocal(db, password);
      setVault(v);
      setPassword('');
      setRepeat('');
      await refresh(v);
      setMode('ready');
    } catch {
      setError('Vault creation failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlock(): Promise<void> {
    setError('');
    if (!password) {
      setError('Password is required');
      return;
    }
    setBusy(true);
    try {
      const v = await unlockVault(db, password);
      setVault(v);
      setPassword('');
      await refresh(v);
      setMode('ready');
    } catch {
      setError('Wrong password, try again');
    } finally {
      setBusy(false);
    }
  }

  function handleLock(): void {
    if (vault) lockVault(vault);
    setVault(null);
    setNotes([]);
    searchIndex.clear();
    setSelectedId(null);
    setTitle('');
    setBody('');
    setTags('');
    setQuery('');
    setPreview(false);
    setMode('unlock');
  }

  function startNew(): void {
    setSelectedId(null);
    setTitle('');
    setBody('');
    setTags('');
    setPreview(false);
    setError('');
  }

  function openNote(note: NoteView): void {
    setSelectedId(note.noteId);
    setTitle(note.title);
    setBody(note.body);
    setTags(note.tags.join(', '));
    setPreview(false);
    setError('');
  }

  async function handleSave(): Promise<void> {
    if (!vault) return;
    setError('');
    setBusy(true);
    try {
      const draft = { title, body, tags: parseTags(tags) };
      if (selectedId) {
        const saved = await updateNote(db, vault, selectedId, draft);
        searchIndex.add({ noteId: saved.noteId, title: saved.title, body: saved.body, tags: saved.tags });
      } else {
        const saved = await createNote(db, vault, draft);
        setSelectedId(saved.noteId);
        searchIndex.add({ noteId: saved.noteId, title: saved.title, body: saved.body, tags: saved.tags });
      }
      await refresh(vault);
    } catch {
      setError('Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!vault || !selectedId) return;
    if (!window.confirm('Delete this note')) return;
    setBusy(true);
    try {
      await deleteNote(db, selectedId);
      searchIndex.remove(selectedId);
      startNew();
      await refresh(vault);
    } catch {
      setError('Delete failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleSyncRegister(): Promise<void> {
    if (!vault) return;
    setSyncStatus('');
    if (!syncEmail || !syncPassword) {
      setSyncStatus('Email and vault password are required');
      return;
    }
    setBusy(true);
    try {
      account.setBaseUrl(syncUrl);
      await account.registerLink(db, vault, syncPassword, syncEmail);
      setSyncPassword('');
      setAccountTick((t) => t + 1);
      setSyncStatus(`Linked as ${account.linkedEmail ?? syncEmail}`);
      await refresh(vault);
    } catch {
      setSyncStatus('Register failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleSyncLogin(): Promise<void> {
    setError('');
    if (!syncEmail || !syncPassword) {
      setError('Email and password are required');
      return;
    }
    setBusy(true);
    try {
      account.setBaseUrl(syncUrl);
      const v = await account.loginFresh(db, syncEmail, syncPassword);
      setVault(v);
      setSyncPassword('');
      setAccountTick((t) => t + 1);
      await refresh(v);
      setMode('ready');
    } catch {
      setError('Login failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleSyncNow(): Promise<void> {
    if (!vault) return;
    setSyncStatus('Syncing');
    try {
      const summary = await syncNow(account, db, vault);
      await refresh(vault);
      setSyncStatus(`Synced ${summary.pushed} pushed ${summary.pulled} pulled ${summary.conflicts} conflicts`);
    } catch {
      setSyncStatus('Sync failed');
    }
  }

  async function handleUnlink(): Promise<void> {
    await account.logout();
    setAccountTick((t) => t + 1);
    setSyncStatus('Not linked');
  }

  const visible = useMemo(() => {
    if (!query.trim()) return notes;
    const order = new Map(searchIndex.query(query).map((id, i) => [id, i]));
    return notes.filter((n) => order.has(n.noteId)).sort((a, b) => (order.get(a.noteId) ?? 0) - (order.get(b.noteId) ?? 0));
  }, [notes, query, searchIndex]);

  const previewHtml = useMemo(() => renderMarkdown(body), [body]);

  if (mode === 'checking') {
    return (
      <main style={styles.page}>
        <h1>Cipherpad</h1>
        <p>Loading local vault</p>
      </main>
    );
  }

  if (mode === 'create' || (mode === 'unlock' && !vault)) {
    const isCreate = mode === 'create';
    return (
      <main style={styles.page}>
        <h1>Cipherpad</h1>
        <p>{isCreate ? 'Create a vault to store notes on this device' : 'Vault is locked'}</p>
        <label style={styles.label}>
          Password
          <input
            style={styles.input}
            data-testid="password"
            type="password"
            value={password}
            autoComplete={isCreate ? 'new-password' : 'current-password'}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void (isCreate ? handleCreateVault() : handleUnlock());
            }}
          />
        </label>
        {isCreate && (
          <label style={styles.label}>
            Repeat password
            <input
              style={styles.input}
              data-testid="password-repeat"
              type="password"
              value={repeat}
              autoComplete="new-password"
              onChange={(e) => setRepeat(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreateVault();
              }}
            />
          </label>
        )}
        {error && <p style={styles.error}>{error}</p>}
        <button
          style={styles.primary}
          data-testid="vault-submit"
          disabled={busy}
          onClick={() => void (isCreate ? handleCreateVault() : handleUnlock())}
        >
          {busy ? 'Working' : isCreate ? 'Create vault' : 'Unlock'}
        </button>
        {isCreate && (
          <section style={styles.syncBox}>
            <h2>Have an account on another device</h2>
            <p>Log in to fetch the shared vault instead of creating a new one</p>
            <label style={styles.label}>
              Server
              <input
                style={styles.input}
                data-testid="sync-url"
                value={syncUrl}
                onChange={(e) => setSyncUrl(e.target.value)}
              />
            </label>
            <label style={styles.label}>
              Email
              <input
                style={styles.input}
                data-testid="sync-email"
                value={syncEmail}
                autoComplete="email"
                onChange={(e) => setSyncEmail(e.target.value)}
              />
            </label>
            <label style={styles.label}>
              Password
              <input
                style={styles.input}
                data-testid="sync-password"
                type="password"
                value={syncPassword}
                autoComplete="current-password"
                onChange={(e) => setSyncPassword(e.target.value)}
              />
            </label>
            <button style={styles.secondary} data-testid="sync-login" disabled={busy} onClick={() => void handleSyncLogin()}>
              Log in
            </button>
          </section>
        )}
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.h1}>Cipherpad</h1>
        <button style={styles.secondary} data-testid="lock-now" onClick={handleLock}>
          Lock now
        </button>
      </header>
      <section style={styles.syncBox}>
        <h2 style={styles.h2}>Sync account</h2>
        {account.linkedEmail && account.accessToken ? (
          <div style={styles.row}>
            <span>Linked as {account.linkedEmail}</span>
            <button style={styles.secondary} data-testid="sync-now" disabled={busy} onClick={() => void handleSyncNow()}>
              Sync now
            </button>
            <button style={styles.secondary} disabled={busy} onClick={() => void handleUnlink()}>
              Unlink
            </button>
          </div>
        ) : (
          <div style={styles.syncGrid}>
            <label style={styles.label}>
              Server
              <input
                style={styles.input}
                data-testid="sync-url"
                value={syncUrl}
                onChange={(e) => setSyncUrl(e.target.value)}
              />
            </label>
            <label style={styles.label}>
              Email
              <input
                style={styles.input}
                data-testid="sync-email"
                value={syncEmail}
                autoComplete="email"
                onChange={(e) => setSyncEmail(e.target.value)}
              />
            </label>
            <label style={styles.label}>
              Vault password
              <input
                style={styles.input}
                data-testid="sync-password"
                type="password"
                value={syncPassword}
                autoComplete="current-password"
                onChange={(e) => setSyncPassword(e.target.value)}
              />
            </label>
            <div style={styles.row}>
              <button style={styles.primary} data-testid="sync-register" disabled={busy} onClick={() => void handleSyncRegister()}>
                Register this device
              </button>
            </div>
          </div>
        )}
        {syncStatus && <p data-testid="sync-status">{syncStatus}</p>}
      </section>
      <input
        style={styles.input}
        data-testid="search"
        type="search"
        placeholder="Search notes"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div style={styles.columns}>
        <section style={styles.list}>
          <button style={styles.primary} data-testid="note-new" onClick={startNew}>
            New note
          </button>
          {visible.length === 0 && <p>No notes yet, create one</p>}
          {visible.map((n) => (
            <button
              key={n.noteId}
              data-testid={`note-item-${n.noteId}`}
              style={selectedId === n.noteId ? styles.selected : styles.card}
              onClick={() => openNote(n)}
            >
              <strong>{n.title || 'Untitled'}</strong>
              <small>{n.tags.join(', ')}</small>
            </button>
          ))}
        </section>
        <section style={styles.editor}>
          <label style={styles.label}>
            Title
            <input
              style={styles.input}
              data-testid="note-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label style={styles.label}>
            Tags, comma separated
            <input style={styles.input} value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>
          <div style={styles.row}>
            <button style={styles.secondary} onClick={() => setPreview((p) => !p)}>
              {preview ? 'Edit' : 'Preview'}
            </button>
            <button style={styles.primary} data-testid="note-save" disabled={busy} onClick={() => void handleSave()}>
              Save
            </button>
            {selectedId && (
              <button style={styles.danger} disabled={busy} onClick={() => void handleDelete()}>
                Delete
              </button>
            )}
          </div>
          {preview ? (
            <article style={styles.preview} dangerouslySetInnerHTML={{ __html: previewHtml }} />
          ) : (
            <textarea
              style={styles.textarea}
              data-testid="note-body"
              value={body}
              placeholder="Write markdown here"
              onChange={(e) => setBody(e.target.value)}
            />
          )}
          {error && <p style={styles.error}>{error}</p>}
        </section>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 960, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  h1: { margin: 0 },
  h2: { margin: '12px 0 0', fontSize: 18 },
  syncBox: { border: '1px solid #888', borderRadius: 8, padding: 12, marginTop: 12, display: 'grid', gap: 8 },
  syncGrid: { display: 'grid', gap: 8 },
  label: { display: 'grid', gap: 6, marginTop: 12 },
  input: { padding: 10, fontSize: 15, borderRadius: 8, border: '1px solid #888' },
  columns: { display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, marginTop: 16 },
  list: { display: 'grid', gap: 8, alignContent: 'start' },
  editor: { display: 'grid', gap: 8, alignContent: 'start' },
  card: { textAlign: 'left', padding: 10, borderRadius: 8, border: '1px solid #888', background: '#fff', cursor: 'pointer', display: 'grid', gap: 4 },
  selected: { textAlign: 'left', padding: 10, borderRadius: 8, border: '2px solid #1a2b3c', background: '#eef4fa', cursor: 'pointer', display: 'grid', gap: 4 },
  row: { display: 'flex', gap: 8 },
  textarea: { minHeight: 320, padding: 10, fontSize: 15, borderRadius: 8, border: '1px solid #888', fontFamily: 'inherit' },
  preview: { minHeight: 320, padding: 12, borderRadius: 8, border: '1px solid #888', background: '#fff' },
  primary: { padding: '10px 14px', borderRadius: 8, border: 'none', background: '#1a2b3c', color: '#fff', cursor: 'pointer' },
  secondary: { padding: '10px 14px', borderRadius: 8, border: '1px solid #1a2b3c', background: '#fff', cursor: 'pointer' },
  danger: { padding: '10px 14px', borderRadius: 8, border: '1px solid #a00', background: '#fff', color: '#a00', cursor: 'pointer' },
  error: { color: '#a00' }
};
