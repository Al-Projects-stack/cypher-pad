import type { ReactElement } from 'react';
import { AUTOLOCK_OPTIONS } from '../vault/autolock.js';
import { cardField, cardLabel, cardPrimary, cardSecondary, toolbarRow } from '../styles/theme.js';

export interface SettingsViewProps {
  busy: boolean;
  linked: boolean;
  autoLockMs: number;
  newPassword: string;
  newRepeat: string;
  settingsStatus: string;
  onNewPassword: (value: string) => void;
  onNewRepeat: (value: string) => void;
  onPasswordChange: () => void;
  onRotateRecovery: () => void;
  onAutoLock: (ms: number) => void;
  onExport: () => void;
}

export function SettingsView(props: SettingsViewProps): ReactElement {
  return (
    <div className="cp-cards">
      <section className="cp-card">
        <h2>Password</h2>
        <p>Rewrap the vault with a new password. Notes stay exactly as they are.</p>
        <label style={cardLabel}>
          New password
          <input
            style={cardField}
            data-testid="settings-new-password"
            type="password"
            value={props.newPassword}
            autoComplete="new-password"
            onChange={(e) => props.onNewPassword(e.target.value)}
          />
        </label>
        <label style={cardLabel}>
          Repeat new password
          <input
            style={cardField}
            data-testid="settings-new-repeat"
            type="password"
            value={props.newRepeat}
            autoComplete="new-password"
            onChange={(e) => props.onNewRepeat(e.target.value)}
          />
        </label>
        <div style={toolbarRow}>
          <button style={cardPrimary} data-testid="settings-save-password" disabled={props.busy} onClick={props.onPasswordChange}>
            Update password
          </button>
        </div>
      </section>
      <section className="cp-card">
        <h2>Recovery key</h2>
        {props.linked ? (
          <>
            <p>A new key replaces the old one everywhere. Save the new text at once.</p>
            <div style={toolbarRow}>
              <button style={cardSecondary} data-testid="settings-rotate" disabled={props.busy} onClick={props.onRotateRecovery}>
                Rotate recovery key
              </button>
            </div>
          </>
        ) : (
          <p>Link an account first to use recovery keys.</p>
        )}
      </section>
      <section className="cp-card">
        <h2>Auto lock</h2>
        <p>Locks the vault after idle time. Locking clears keys from memory.</p>
        <label style={cardLabel}>
          Idle timeout
          <select
            style={cardField}
            data-testid="settings-autolock"
            value={String(props.autoLockMs)}
            onChange={(e) => props.onAutoLock(Number(e.target.value))}
          >
            {AUTOLOCK_OPTIONS.map((o) => (
              <option key={o.ms} value={String(o.ms)}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </section>
      <section className="cp-card">
        <h2>Export</h2>
        <p>Export writes every note as plaintext JSON. Store the file somewhere safe.</p>
        <div style={toolbarRow}>
          <button style={cardSecondary} data-testid="settings-export" onClick={props.onExport}>
            Export notes
          </button>
        </div>
      </section>
      {props.settingsStatus !== '' && (
        <p data-testid="settings-status" style={statusLine}>
          {props.settingsStatus}
        </p>
      )}
    </div>
  );
}

const statusLine = {
  color: '#e8f1f8',
  fontSize: 14,
  margin: '4px 0 0'
} as const;
