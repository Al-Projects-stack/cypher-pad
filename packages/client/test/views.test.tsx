import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotesView, SyncStrip, formatNoteDate, snippetOf } from '../src/components/NotesView.js';
import { SettingsView } from '../src/components/SettingsView.js';
import type { NoteView } from '../src/notes/store.js';

afterEach(() => {
  cleanup();
});

const SAMPLE: NoteView[] = [
  {
    noteId: 'a1',
    title: 'Shopping',
    body: 'Buy milk and eggs for the week ahead',
    tags: ['home'],
    revision: 1,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z'
  },
  {
    noteId: 'b2',
    title: '',
    body: 'Untitled body text',
    tags: [],
    revision: 2,
    createdAt: '2026-09-02T10:00:00.000Z',
    updatedAt: '2026-09-21T10:00:00.000Z'
  }
];

function noop(): void {
  void 0;
}

describe('notes view', () => {
  it('lists notes with snippets and opens on click', () => {
    const onOpen = vi.fn();
    const onNew = vi.fn();
    render(
      <NotesView
        notes={SAMPLE}
        selectedId={null}
        query=""
        title=""
        body=""
        tags=""
        preview={false}
        previewHtml=""
        busy={false}
        error=""
        onQuery={noop}
        onNew={onNew}
        onOpen={onOpen}
        onTitle={noop}
        onBody={noop}
        onTags={noop}
        onPreview={noop}
        onSave={noop}
        onDelete={noop}
      />
    );
    expect(screen.getByText('Shopping')).toBeTruthy();
    expect(screen.getByText('Untitled')).toBeTruthy();
    fireEvent.click(screen.getByTestId('note-item-a1'));
    expect(onOpen).toHaveBeenCalledWith(SAMPLE[0]);
    fireEvent.click(screen.getByTestId('note-new'));
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it('shows empty state and save flow', () => {
    const onSave = vi.fn();
    render(
      <NotesView
        notes={[]}
        selectedId={null}
        query=""
        title="Draft"
        body="hello"
        tags=""
        preview={false}
        previewHtml=""
        busy={false}
        error="Save failed"
        onQuery={noop}
        onNew={noop}
        onOpen={noop}
        onTitle={noop}
        onBody={noop}
        onTags={noop}
        onPreview={noop}
        onSave={onSave}
        onDelete={noop}
      />
    );
    expect(screen.getByText('No notes yet, create one')).toBeTruthy();
    expect(screen.getByText('Save failed')).toBeTruthy();
    fireEvent.click(screen.getByTestId('note-save'));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('formats helpers without crashing', () => {
    expect(formatNoteDate('not a date')).toBe('');
    expect(formatNoteDate('2026-09-20T10:00:00.000Z')).not.toBe('');
    expect(snippetOf('   ')).toBe('');
    expect(snippetOf('x'.repeat(200)).endsWith('…')).toBe(true);
  });
});

describe('sync strip', () => {
  it('shows register form when unlinked', () => {
    const onRegister = vi.fn();
    render(
      <SyncStrip
        linkedEmail={null}
        hasToken={false}
        status=""
        busy={false}
        serverUrl=""
        email=""
        password=""
        onUrl={noop}
        onEmail={noop}
        onPassword={noop}
        onRegister={onRegister}
        onSyncNow={noop}
        onUnlink={noop}
      />
    );
    expect(screen.getByText('Not linked')).toBeTruthy();
    fireEvent.click(screen.getByTestId('sync-register'));
    expect(onRegister).toHaveBeenCalledTimes(1);
  });

  it('shows linked state with status', () => {
    const onSyncNow = vi.fn();
    render(
      <SyncStrip
        linkedEmail="a@b.c"
        hasToken={true}
        status="Synced 1 pushed 0 pulled 0 conflicts"
        busy={false}
        serverUrl=""
        email=""
        password=""
        onUrl={noop}
        onEmail={noop}
        onPassword={noop}
        onRegister={noop}
        onSyncNow={onSyncNow}
        onUnlink={noop}
      />
    );
    expect(screen.getByText('Linked as a@b.c')).toBeTruthy();
    fireEvent.click(screen.getByTestId('sync-now'));
    expect(onSyncNow).toHaveBeenCalledTimes(1);
  });
});

describe('settings view', () => {
  it('renders all sections and wires actions', () => {
    const onPasswordChange = vi.fn();
    const onRotateRecovery = vi.fn();
    const onExport = vi.fn();
    const onAutoLock = vi.fn();
    render(
      <SettingsView
        busy={false}
        linked={true}
        autoLockMs={300000}
        newPassword=""
        newRepeat=""
        settingsStatus="Password updated"
        onNewPassword={noop}
        onNewRepeat={noop}
        onPasswordChange={onPasswordChange}
        onRotateRecovery={onRotateRecovery}
        onAutoLock={onAutoLock}
        onExport={onExport}
      />
    );
    fireEvent.click(screen.getByTestId('settings-save-password'));
    fireEvent.click(screen.getByTestId('settings-rotate'));
    fireEvent.click(screen.getByTestId('settings-export'));
    fireEvent.change(screen.getByTestId('settings-autolock'), { target: { value: '60000' } });
    expect(onPasswordChange).toHaveBeenCalledTimes(1);
    expect(onRotateRecovery).toHaveBeenCalledTimes(1);
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(onAutoLock).toHaveBeenCalledWith(60000);
    expect(screen.getByText('Password updated')).toBeTruthy();
  });

  it('asks to link before recovery', () => {
    render(
      <SettingsView
        busy={false}
        linked={false}
        autoLockMs={0}
        newPassword=""
        newRepeat=""
        settingsStatus=""
        onNewPassword={noop}
        onNewRepeat={noop}
        onPasswordChange={noop}
        onRotateRecovery={noop}
        onAutoLock={noop}
        onExport={noop}
      />
    );
    expect(screen.getByText('Link an account first to use recovery keys.')).toBeTruthy();
  });
});
