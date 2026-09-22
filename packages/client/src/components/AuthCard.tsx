import { useState, type ReactElement, type ReactNode } from 'react';
import {
  authCard,
  authLogo,
  authSub,
  authTitle,
  capsWarn,
  fieldInput,
  fieldLabel,
  fieldRow,
  formError,
  pageShell,
  peekButton,
  quietLink,
  strengthCell,
  strengthLabel,
  strengthWrap,
  submitButton
} from '../styles/theme.js';

export function AuthShell(props: {
  title: string;
  sub: string;
  children: ReactNode;
}): ReactElement {
  return (
    <main style={{ ...pageShell, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '0 16px' }}>
      <div style={authCard}>
        <div style={authLogo} aria-hidden="true">
          C
        </div>
        <h1 style={authTitle}>{props.title}</h1>
        <p style={authSub}>{props.sub}</p>
        {props.children}
      </div>
    </main>
  );
}

export function AuthSubmit(props: { busy: boolean; busyText: string; idleText: string; testId: string; onSubmit: () => void }): ReactElement {
  return (
    <button
      style={{ ...submitButton, opacity: props.busy ? 0.65 : 1 }}
      data-testid={props.testId}
      disabled={props.busy}
      onClick={props.onSubmit}
    >
      {props.busy ? props.busyText : props.idleText}
    </button>
  );
}

export function AuthError(props: { message: string }): ReactElement | null {
  if (!props.message) return null;
  return <p style={formError}>{props.message}</p>;
}

export function AuthSwitch(props: { text: string; action: string; testId: string; onSwitch: () => void }): ReactElement {
  return (
    <button style={quietLink} data-testid={props.testId} onClick={props.onSwitch}>
      {props.text} {props.action}
    </button>
  );
}

export function scorePassword(value: string): number {
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 14) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value) || /[^a-zA-Z0-9]/.test(value)) score += 1;
  return Math.min(score, 4);
}

export function PasswordField(props: {
  label: string;
  value: string;
  testId: string;
  autoComplete: string;
  showStrength?: boolean;
  onChange: (value: string) => void;
  onEnter?: () => void;
}): ReactElement {
  const [visible, setVisible] = useState(false);
  const [caps, setCaps] = useState(false);
  const strength = scorePassword(props.value);

  return (
    <label style={fieldLabel}>
      {props.label}
      <span style={fieldRow}>
        <input
          style={{ ...fieldInput, paddingRight: 64 }}
          data-testid={props.testId}
          type={visible ? 'text' : 'password'}
          value={props.value}
          autoComplete={props.autoComplete}
          onChange={(e) => props.onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && props.onEnter) props.onEnter();
          }}
          onKeyUp={(e) => {
            let caps = false;
            const mod = (e.nativeEvent as unknown as { getModifierState?: unknown }).getModifierState;
            if (typeof mod === 'function') {
              try {
                caps = (mod as (key: string) => boolean).call(e.nativeEvent, 'CapsLock') === true;
              } catch {
                void 0;
              }
            }
            if (!caps) {
              caps = e.key.length === 1 && e.key >= 'A' && e.key <= 'Z' && e.shiftKey === false;
            }
            setCaps(caps);
          }}
        />
        <button
          style={peekButton}
          type="button"
          data-testid={`${props.testId}-peek`}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </span>
      {caps && <span style={capsWarn}>Caps lock is on</span>}
      {props.showStrength === true && props.value.length > 0 && (
        <span>
          <span style={strengthWrap} aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} style={strengthCell(strength > i)} />
            ))}
          </span>
          <span style={strengthLabel}>
            {strength <= 1 ? 'Weak, longer is stronger' : strength === 2 ? 'Fair' : strength === 3 ? 'Strong' : 'Very strong'} (rough guide only)
          </span>
        </span>
      )}
    </label>
  );
}
