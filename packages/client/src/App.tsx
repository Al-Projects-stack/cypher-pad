import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { CipherpadDb, openDb } from './notes/db.js';
import { renderMarkdown } from './notes/markdown.js';
import { NoteSearch } from './notes/search.js';
import { createNote, deleteNote, listNotes, updateNote, type NoteView } from './notes/store.js';
import { startBackgroundSync, syncNow, type BackgroundHandle } from './sync/engine.js';
import { DEFAULT_SYNC_URL, SyncAccount } from './sync/account.js';
import { AUTOLOCK_OPTIONS, readAutoLockMs, startAutoLock, type AutoLockHandle } from './vault/autolock.js';
import { Landing } from './components/Landing.js';
import { AuthError, AuthShell, AuthSubmit, AuthSwitch, PasswordField } from './components/AuthCard.js';
import { fieldInput, fieldLabel, quietLink } from './styles/theme.js';
import { createVaultLocal, hasVault, lockVault, unlockVault, type OpenVault } from './vault/session.js';

type Mode = 'checking' | 'landing' | 'create' | 'login' | 'unlock' | 'ready';

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
  const [pendingRecovery, setPendingRecovery] = useState<string | null>(null);
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [showRecover, setShowRecover] = useState(false);
  const [recoverText, setRecoverText] = useState('');
  const [view, setView] = useState<'notes' | 'settings'>('notes');
  const [newPassword, setNewPassword] = useState('');
  const [newRepeat, setNewRepeat] = useState('');
  const [settingsStatus, setSettingsStatus] = useState('');
  const vaultRef = useRef<OpenVault | null>(null);
  const bgRef = useRef<BackgroundHandle | null>(null);
  const autoRef = useRef<AutoLockHandle | null>(null);
  const lockRef = useRef<() => void>(() => undefined);
  const [autoLockMs, setAutoLockMs] = useState<number>(() =>
    readAutoLockMs(typeof localStorage !== 'undefined' ? localStorage : null)
  );
  void accountTick;

  useEffect(() => {
    let live = true;
    hasVault(db)
      .then((exists) => {
        if (live) setMode(exists ? 'unlock' : 'landing');
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
    lockRef.current = handleLock;
  });

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
    const auto = startAutoLock(() => lockRef.current(), autoLockMs, typeof localStorage !== 'undefined' ? localStorage : null);
    autoRef.current = auto;
    return () => {
      handle.stop();
      auto.stop();
      autoRef.current = null;
    };
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
    setView('notes');
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
      const res = await account.registerLink(db, vault, syncPassword, syncEmail);
      setSyncPassword('');
      setAccountTick((t) => t + 1);
      setSyncStatus(`Linked as ${account.linkedEmail ?? syncEmail}`);
      setPendingRecovery(res.recoveryText);
      setRecoverySaved(false);
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

  async function handleRecover(): Promise<void> {
    setError('');
    if (!syncEmail || !recoverText || !syncPassword) {
      setError('Email plus recovery text plus new password are required');
      return;
    }
    setBusy(true);
    try {
      const v = await account.recoverFresh(db, syncEmail, recoverText, syncPassword, { overwrite: true });
      setVault(v);
      setSyncPassword('');
      setRecoverText('');
      setShowRecover(false);
      setAccountTick((t) => t + 1);
      await refresh(v);
      setMode('ready');
    } catch {
      setError('Recovery failed');
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

  async function handlePasswordChange(): Promise<void> {
    if (!vault) return;
    setSettingsStatus('');
    if (!newPassword) {
      setSettingsStatus('New password is required');
      return;
    }
    if (newPassword !== newRepeat) {
      setSettingsStatus('Passwords do not match');
      return;
    }
    setBusy(true);
    try {
      await account.changePassword(db, vault, newPassword);
      setNewPassword('');
      setNewRepeat('');
      setAccountTick((t) => t + 1);
      setSettingsStatus('Password updated');
    } catch {
      setSettingsStatus('Password change failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleRotateRecovery(): Promise<void> {
    if (!vault) return;
    setSettingsStatus('');
    setBusy(true);
    try {
      const text = await account.rotateRecovery(db, vault);
      setPendingRecovery(text);
      setRecoverySaved(false);
      setSettingsStatus('Recovery key rotated, save the new text');
    } catch {
      setSettingsStatus('Recovery rotation failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleExport(): Promise<void> {    if (!vault) return;
    setSettingsStatus('');
    try {
      const all = await listNotes(db, vault);
      const payload = {
        app: 'cipherpad',
        version: 1,
        exportedAt: new Date().toISOString(),
        notes: all.map((n) => ({
          title: n.title,
          body: n.body,
          tags: n.tags,
          createdAt: n.createdAt,
          updatedAt: n.updatedAt
        }))
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `cipherpad export ${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setSettingsStatus(`Exported ${all.length} notes as plaintext JSON`);
    } catch {
      setSettingsStatus('Export failed');
    }
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

  if (mode === 'landing') {
    return (
      <Landing
        onCreate={() => {
          setError('');
          setMode('create');
        }}
        onLogin={() => {
          setError('');
          setMode('login');
        }}
      />
    );
  }

  if (mode === 'create') {
    return (
      <AuthShell
        title="Create a vault"
        sub="One password seals notes on this device. Keep it safe, there is no reset without the recovery key shown next."
      >
        <PasswordField
          label="Password"
          value={password}
          testId="password"
          autoComplete="new-password"
          showStrength
          onChange={setPassword}
          onEnter={() => void handleCreateVault()}
        />
        <PasswordField
          label="Repeat password"
          value={repeat}
          testId="password-repeat"
          autoComplete="new-password"
          onChange={setRepeat}
          onEnter={() => void handleCreateVault()}
        />
        <AuthError message={error} />
        <AuthSubmit busy={busy} busyText="Working" idleText="Create vault" testId="vault-submit" onSubmit={() => void handleCreateVault()} />
        <AuthSwitch text="Already have an account?" action="Log in" testId="go-login" onSwitch={() => { setError(''); setMode('login'); }} />
      </AuthShell>
    );
  }

  if (mode === 'login') {
    return (
      <AuthShell
        title="Log in on this device"
        sub="Fetch the shared vault with email and password. Nothing new is created here."
      >
        <label style={fieldLabel}>
          Server
          <input
            style={fieldInput}
            data-testid="sync-url"
            value={syncUrl}
            onChange={(e) => setSyncUrl(e.target.value)}
          />
        </label>
        <label style={fieldLabel}>
          Email
          <input
            style={fieldInput}
            data-testid="sync-email"
            value={syncEmail}
            autoComplete="email"
            onChange={(e) => setSyncEmail(e.target.value)}
          />
        </label>
        <PasswordField
          label="Password"
          value={syncPassword}
          testId="sync-password"
          autoComplete="current-password"
          onChange={setSyncPassword}
          onEnter={() => void handleSyncLogin()}
        />
        <AuthError message={error} />
        <AuthSubmit busy={busy} busyText="Working" idleText="Log in" testId="sync-login" onSubmit={() => void handleSyncLogin()} />
        <AuthSwitch text="No vault yet?" action="Create one" testId="go-create" onSwitch={() => { setError(''); setMode('create'); }} />
      </AuthShell>
    );
  }

  if (mode === 'unlock' && !vault) {
    return (
      <AuthShell
        title="Vault is locked"
        sub="Unlock with the device password. Keys never leave this device."
      >
        <PasswordField
          label="Password"
          value={password}
          testId="password"
          autoComplete="current-password"
          onChange={setPassword}
          onEnter={() => void handleUnlock()}
        />
        <AuthError message={error} />
        <AuthSubmit busy={busy} busyText="Working" idleText="Unlock" testId="vault-submit" onSubmit={() => void handleUnlock()} />
        <div>
          <button style={quietLink} data-testid="forgot-toggle" onClick={() => setShowRecover((s) => !s)}>
            Forgot password
          </button>
          {showRecover && (
            <div>
              <p style={authNoteText}>Reset with the recovery key. This replaces the local vault copy.</p>
              <label style={fieldLabel}>
                Email
                <input
                  style={fieldInput}
                  data-testid="recover-email"
                  value={syncEmail}
                  autoComplete="email"
                  onChange={(e) => setSyncEmail(e.target.value)}
                />
              </label>
              <label style={fieldLabel}>
                Recovery key
                <input
                  style={fieldInput}
                  data-testid="recover-text"
                  value={recoverText}
                  autoComplete="off"
                  onChange={(e) => setRecoverText(e.target.value)}
                />
              </label>
              <PasswordField
                label="New password"
                value={syncPassword}
                testId="recover-password"
                autoComplete="new-password"
                onChange={setSyncPassword}
                onEnter={() => void handleRecover()}
              />
              <AuthSubmit busy={busy} busyText="Working" idleText="Reset password and replace local copy" testId="recover-submit" onSubmit={() => void handleRecover()} />
            </div>
          )}
        </div>
      </AuthShell>
    );
  }
  if (pendingRecovery && vault) {
    return (
      <main style={styles.page}>
        <h1>Save this recovery key</h1>
        <p>Write it down now. It is shown once and unlocks the vault if the password is lost.</p>
        <p data-testid="recovery-text" style={styles.recoveryText}>{pendingRecovery}</p>
        <label style={styles.row}>
          <input
            data-testid="recovery-confirm"
            type="checkbox"
            checked={recoverySaved}
            onChange={(e) => setRecoverySaved(e.target.checked)}
          />
          I wrote down the recovery key
        </label>
        <button
          style={styles.primary}
          data-testid="recovery-continue"
          disabled={!recoverySaved}
          onClick={() => setPendingRecovery(null)}
        >
          Continue
        </button>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.h1}>Cipherpad</h1>
        <div style={styles.row}>
          <button style={styles.secondary} data-testid="view-notes" disabled={view === 'notes'} onClick={() => setView('notes')}>
            Notes
          </button>
          <button style={styles.secondary} data-testid="view-settings" disabled={view === 'settings'} onClick={() => setView('settings')}>
            Settings
          </button>
          <button style={styles.secondary} data-testid="lock-now" onClick={handleLock}>
            Lock now
          </button>
        </div>
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
      {view === 'notes' && (
        <>
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
        </>
      )}
      {view === 'settings' && (
        <section style={styles.syncBox}>
          <h2 style={styles.h2}>Password</h2>
          <label style={styles.label}>
            New password
            <input
              style={styles.input}
              data-testid="settings-new-password"
              type="password"
              value={newPassword}
              autoComplete="new-password"
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>
          <label style={styles.label}>
            Repeat new password
            <input
              style={styles.input}
              data-testid="settings-new-repeat"
              type="password"
              value={newRepeat}
              autoComplete="new-password"
              onChange={(e) => setNewRepeat(e.target.value)}
            />
          </label>
          <div style={styles.row}>
            <button style={styles.primary} data-testid="settings-save-password" disabled={busy} onClick={() => void handlePasswordChange()}>
              Update password
            </button>
          </div>
          <h2 style={styles.h2}>Recovery key</h2>
          {account.accessToken ? (
            <div style={styles.row}>
              <button style={styles.secondary} data-testid="settings-rotate" disabled={busy} onClick={() => void handleRotateRecovery()}>
                Rotate recovery key
              </button>
            </div>
          ) : (
            <p>Link an account first to use recovery keys.</p>
          )}
          <h2 style={styles.h2}>Auto lock</h2>
          <p>Locks the vault after idle time. Locking clears keys from memory.</p>
          <label style={styles.label}>
            Idle timeout
            <select
              style={styles.input}
              data-testid="settings-autolock"
              value={String(autoLockMs)}
              onChange={(e) => {
                const ms = Number(e.target.value);
                setAutoLockMs(ms);
                autoRef.current?.setTimeoutMs(ms);
              }}
            >
              {AUTOLOCK_OPTIONS.map((o) => (
                <option key={o.ms} value={String(o.ms)}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <h2 style={styles.h2}>Export</h2>
          <p>Export writes every note as plaintext JSON. Store the file somewhere safe.</p>
          <div style={styles.row}>
            <button style={styles.secondary} data-testid="settings-export" onClick={() => void handleExport()}>
              Export notes
            </button>
          </div>
          {settingsStatus && <p data-testid="settings-status">{settingsStatus}</p>}
        </section>
      )}
    </main>
  );
}

const authNoteText: React.CSSProperties = { margin: '8px 0 0', color: '#5b7186', fontSize: 14 };

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
  error: { color: '#a00' },
  recoveryText: { fontSize: 20, letterSpacing: 2, padding: 16, borderRadius: 8, border: '2px dashed #1a2b3c', background: '#eef4fa' }
};
