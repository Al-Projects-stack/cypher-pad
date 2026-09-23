import type { ReactElement } from 'react';
import type { NoteView } from '../notes/store.js';
import { accentButton, cardDanger, cardField, cardLabel, cardPrimary, cardSecondary, darkButton, darkInput, toolbarRow } from '../styles/theme.js';

export function formatNoteDate(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function snippetOf(body: string, length = 90): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (flat.length <= length) return flat;
  return `${flat.slice(0, length)}…`;
}

export function SyncStrip(props: {
  linkedEmail: string | null;
  hasToken: boolean;
  status: string;
  busy: boolean;
  serverUrl: string;
  email: string;
  password: string;
  onUrl: (value: string) => void;
  onEmail: (value: string) => void;
  onPassword: (value: string) => void;
  onRegister: () => void;
  onSyncNow: () => void;
  onUnlink: () => void;
}): ReactElement {
  const linked = props.linkedEmail !== null && props.hasToken;
  return (
    <div className="cp-syncstrip">
      <span className={linked ? 'cp-dot on' : 'cp-dot'} aria-hidden="true" />
      {linked ? (
        <>
          <span>Linked as {props.linkedEmail}</span>
          <button style={darkButton} data-testid="sync-now" disabled={props.busy} onClick={props.onSyncNow}>
            Sync now
          </button>
          <button style={darkButton} disabled={props.busy} onClick={props.onUnlink}>
            Unlink
          </button>
        </>
      ) : (
        <>
          <span>Not linked</span>
          <input
            style={{ ...darkInput, maxWidth: 220 }}
            data-testid="sync-url"
            value={props.serverUrl}
            aria-label="Server"
            placeholder="Server"
            onChange={(e) => props.onUrl(e.target.value)}
          />
          <input
            style={{ ...darkInput, maxWidth: 200 }}
            data-testid="sync-email"
            value={props.email}
            autoComplete="email"
            aria-label="Email"
            placeholder="Email"
            onChange={(e) => props.onEmail(e.target.value)}
          />
          <input
            style={{ ...darkInput, maxWidth: 160 }}
            data-testid="sync-password"
            type="password"
            value={props.password}
            autoComplete="current-password"
            aria-label="Vault password"
            placeholder="Vault password"
            onChange={(e) => props.onPassword(e.target.value)}
          />
          <button style={accentButton} data-testid="sync-register" disabled={props.busy} onClick={props.onRegister}>
            Register this device
          </button>
        </>
      )}
      {props.status !== '' && <span data-testid="sync-status">{props.status}</span>}
    </div>
  );
}

export interface NotesViewProps {
  notes: NoteView[];
  selectedId: string | null;
  query: string;
  title: string;
  body: string;
  tags: string;
  preview: boolean;
  previewHtml: string;
  busy: boolean;
  error: string;
  onQuery: (value: string) => void;
  onNew: () => void;
  onOpen: (note: NoteView) => void;
  onTitle: (value: string) => void;
  onBody: (value: string) => void;
  onTags: (value: string) => void;
  onPreview: () => void;
  onSave: () => void;
  onDelete: () => void;
}

export function NotesView(props: NotesViewProps): ReactElement {
  return (
    <div className="cp-grid">
      <aside className="cp-side">
        <input
          style={darkInput}
          data-testid="search"
          type="search"
          placeholder="Search notes"
          value={props.query}
          onChange={(e) => props.onQuery(e.target.value)}
        />
        <button style={accentButton} data-testid="note-new" onClick={props.onNew}>
          New note
        </button>
        <div className="cp-list" data-testid="note-list">
          {props.notes.length === 0 && <p className="cp-empty">No notes yet, create one</p>}
          {props.notes.map((n) => (
            <button
              key={n.noteId}
              data-testid={`note-item-${n.noteId}`}
              className="cp-note"
              aria-current={props.selectedId === n.noteId}
              onClick={() => props.onOpen(n)}
            >
              <span className="cp-note-title">{n.title !== '' ? n.title : 'Untitled'}</span>
              <span className="cp-note-snippet">{snippetOf(n.body) !== '' ? snippetOf(n.body) : 'Empty note'}</span>
              <span className="cp-note-meta">
                <span>{formatNoteDate(n.updatedAt)}</span>
                {n.tags.length > 0 && <span>{n.tags.join(', ')}</span>}
              </span>
            </button>
          ))}
        </div>
      </aside>
      <section className="cp-editor">
        <input
          style={cardTitleInput}
          data-testid="note-title"
          value={props.title}
          placeholder="Untitled"
          aria-label="Title"
          onChange={(e) => props.onTitle(e.target.value)}
        />
        <label style={cardLabel}>
          Tags, comma separated
          <input style={cardField} value={props.tags} onChange={(e) => props.onTags(e.target.value)} />
        </label>
        <div style={toolbarRow}>
          <button style={cardSecondary} onClick={props.onPreview}>
            {props.preview ? 'Edit' : 'Preview'}
          </button>
          <button style={cardPrimary} data-testid="note-save" disabled={props.busy} onClick={props.onSave}>
            Save
          </button>
          {props.selectedId !== null && (
            <button style={cardDanger} disabled={props.busy} onClick={props.onDelete}>
              Delete
            </button>
          )}
        </div>
        {props.preview ? (
          <article style={previewBox} dangerouslySetInnerHTML={{ __html: props.previewHtml }} />
        ) : (
          <textarea
            style={editorBox}
            data-testid="note-body"
            value={props.body}
            placeholder="Write markdown here"
            onChange={(e) => props.onBody(e.target.value)}
          />
        )}
        {props.error !== '' && <p style={formError}>{props.error}</p>}
      </section>
    </div>
  );
}

const cardTitleInput = {
  border: 'none',
  outline: 'none',
  fontSize: 26,
  fontWeight: 800,
  width: '100%',
  boxSizing: 'border-box',
  color: '#10202f',
  background: 'transparent'
} as const;

const editorBox = {
  minHeight: 340,
  padding: 12,
  fontSize: 15,
  lineHeight: 1.65,
  borderRadius: 10,
  border: '1px solid #b9c9d8',
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box'
} as const;

const previewBox = {
  minHeight: 340,
  padding: 12,
  borderRadius: 10,
  border: '1px solid #b9c9d8',
  lineHeight: 1.65
} as const;

const formError = {
  color: '#b4232a',
  fontSize: 14,
  margin: 0
} as const;
