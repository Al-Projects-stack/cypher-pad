import type { ReactElement } from 'react';
import {
  centerWrap,
  ctaRow,
  eyebrow,
  featureCard,
  featureGrid,
  featureText,
  featureTitle,
  ghostCta,
  heroGrid,
  heroSub,
  heroTitle,
  pageShell,
  primaryCta
} from '../styles/theme.js';

interface LandingProps {
  onCreate: () => void;
  onLogin: () => void;
}

const FEATURES: Array<{ icon: string; title: string; text: string }> = [
  {
    icon: '◈',
    title: 'End to end encrypted',
    text: 'Notes are sealed in the browser before they travel. The server stores ciphertext only and can never read a word.'
  },
  {
    icon: '◉',
    title: 'Offline first',
    text: 'Every note lives in IndexedDB on the device. The app opens, reads, and writes with no connection at all.'
  },
  {
    icon: '⬣',
    title: 'Multi device sync',
    text: 'Devices merge in the background. When both sides edit offline, both copies survive for the reader to resolve.'
  },
  {
    icon: '⬔',
    title: 'Honest threat model',
    text: 'Limits are written down, not hidden: served code trust, metadata shape, and password strength bound the design.'
  }
];

export function Landing({ onCreate, onLogin }: LandingProps): ReactElement {
  return (
    <main style={pageShell}>
      <div style={centerWrap}>
        <span style={eyebrow}>Local first notes</span>
        <div style={heroGrid}>
          <div>
            <h1 style={heroTitle}>Cipherpad</h1>
            <p style={heroSub}>
              Private notes that stay yours. Encryption happens on this device, sync carries
              ciphertext only, and the server never sees titles, bodies, or tags.
            </p>
            <div style={ctaRow}>
              <button style={primaryCta} data-testid="landing-get-started" onClick={onCreate}>
                Create a vault
              </button>
              <button style={ghostCta} data-testid="landing-login" onClick={onLogin}>
                Log in on this device
              </button>
            </div>
          </div>
          <div aria-hidden="true" style={vaultArt}>
            <div style={vaultCard}>
              <div style={vaultBar} />
              <div style={vaultLine} />
              <div style={{ ...vaultLine, width: '62%' }} />
              <div style={vaultLock}>◈ sealed</div>
            </div>
          </div>
        </div>
        <div style={featureGrid}>
          {FEATURES.map((f) => (
            <div key={f.title} style={featureCard}>
              <div style={{ fontSize: 22 }}>{f.icon}</div>
              <h2 style={featureTitle}>{f.title}</h2>
              <p style={featureText}>{f.text}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

const vaultArt = {
  display: 'flex',
  justifyContent: 'center'
} as const;

const vaultCard = {
  width: 260,
  borderRadius: 20,
  padding: 28,
  background: 'rgba(255, 255, 255, 0.06)',
  border: '1px solid #33506b',
  boxShadow: '0 24px 80px rgba(0, 0, 0, 0.4)'
} as const;

const vaultBar = {
  height: 12,
  width: 96,
  borderRadius: 6,
  background: '#2dd4a7',
  marginBottom: 18
} as const;

const vaultLine = {
  height: 10,
  width: '88%',
  borderRadius: 5,
  background: '#33506b',
  marginBottom: 12
} as const;

const vaultLock = {
  marginTop: 18,
  display: 'inline-block',
  fontSize: 13,
  fontWeight: 700,
  color: '#06382c',
  background: '#2dd4a7',
  borderRadius: 999,
  padding: '6px 14px'
} as const;
