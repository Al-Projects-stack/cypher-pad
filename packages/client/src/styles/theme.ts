import type { CSSProperties } from 'react';

export const palette = {
  ink: '#0e1621',
  deep: '#16222f',
  panel: '#1d2f41',
  line: '#33506b',
  paper: '#ffffff',
  mist: '#eef4fa',
  text: '#10202f',
  muted: '#5b7186',
  light: '#e8f1f8',
  faint: '#9fb4c7',
  accent: '#2dd4a7',
  accentInk: '#06382c',
  gold: '#f2b544',
  danger: '#e5484d'
} as const;

export const radii = {
  card: 16,
  field: 10,
  pill: 999
} as const;

export const pageShell: CSSProperties = {
  minHeight: '100vh',
  margin: 0,
  fontFamily: 'system-ui, sans-serif',
  color: palette.light,
  background: `radial-gradient(1200px 600px at 80% -10%, #24425e 0%, transparent 60%), radial-gradient(900px 500px at 10% 110%, #1d3a4a 0%, transparent 55%), linear-gradient(180deg, ${palette.ink} 0%, #0a1119 100%)`
};

export const centerWrap: CSSProperties = {
  maxWidth: 1080,
  margin: '0 auto',
  padding: '48px 24px 64px'
};

export const heroGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: 32,
  alignItems: 'center',
  marginTop: 40
};

export const eyebrow: CSSProperties = {
  display: 'inline-block',
  fontSize: 13,
  letterSpacing: 3,
  textTransform: 'uppercase',
  color: palette.accent,
  border: `1px solid ${palette.line}`,
  borderRadius: radii.pill,
  padding: '6px 14px'
};

export const heroTitle: CSSProperties = {
  fontSize: 'clamp(38px, 6vw, 64px)',
  lineHeight: 1.05,
  margin: '18px 0 12px'
};

export const heroSub: CSSProperties = {
  fontSize: 18,
  lineHeight: 1.6,
  color: palette.faint,
  maxWidth: 520
};

export const ctaRow: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  marginTop: 24
};

export const primaryCta: CSSProperties = {
  padding: '13px 26px',
  fontSize: 16,
  fontWeight: 700,
  borderRadius: radii.pill,
  border: 'none',
  background: palette.accent,
  color: palette.accentInk,
  cursor: 'pointer'
};

export const ghostCta: CSSProperties = {
  padding: '13px 26px',
  fontSize: 16,
  fontWeight: 600,
  borderRadius: radii.pill,
  border: `1px solid ${palette.line}`,
  background: 'transparent',
  color: palette.light,
  cursor: 'pointer'
};

export const featureGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 16,
  marginTop: 56
};

export const featureCard: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.04)',
  border: `1px solid ${palette.line}`,
  borderRadius: radii.card,
  padding: 20
};

export const featureTitle: CSSProperties = {
  margin: '10px 0 6px',
  fontSize: 17
};

export const featureText: CSSProperties = {
  margin: 0,
  fontSize: 14,
  lineHeight: 1.6,
  color: palette.faint
};

export const authCard: CSSProperties = {
  width: '100%',
  maxWidth: 460,
  margin: '8vh auto',
  background: palette.paper,
  color: palette.text,
  borderRadius: 20,
  padding: '36px 32px',
  boxShadow: '0 24px 80px rgba(0, 0, 0, 0.45)'
};

export const authLogo: CSSProperties = {
  width: 56,
  height: 56,
  borderRadius: 16,
  background: palette.ink,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 26,
  fontWeight: 800,
  color: palette.accent
};

export const authTitle: CSSProperties = {
  margin: '16px 0 4px',
  fontSize: 26
};

export const authSub: CSSProperties = {
  margin: '0 0 8px',
  color: palette.muted,
  fontSize: 15,
  lineHeight: 1.55
};

export const fieldLabel: CSSProperties = {
  display: 'grid',
  gap: 6,
  marginTop: 14,
  fontSize: 14,
  fontWeight: 600
};

export const fieldInput: CSSProperties = {
  padding: 12,
  fontSize: 15,
  borderRadius: radii.field,
  border: '1px solid #b9c9d8',
  width: '100%',
  boxSizing: 'border-box'
};

export const fieldRow: CSSProperties = {
  position: 'relative'
};

export const peekButton: CSSProperties = {
  position: 'absolute',
  right: 8,
  top: '50%',
  transform: 'translateY(-50%)',
  border: 'none',
  background: 'transparent',
  color: palette.muted,
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  padding: '4px 8px'
};

export const capsWarn: CSSProperties = {
  fontSize: 13,
  color: '#8a5a00',
  background: '#fff4d6',
  borderRadius: 8,
  padding: '6px 10px',
  marginTop: 6
};

export const formError: CSSProperties = {
  color: palette.danger,
  fontSize: 14,
  marginTop: 12
};

export const submitButton: CSSProperties = {
  width: '100%',
  marginTop: 18,
  padding: 13,
  fontSize: 16,
  fontWeight: 700,
  borderRadius: radii.field,
  border: 'none',
  background: palette.ink,
  color: '#fff',
  cursor: 'pointer'
};

export const quietLink: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: palette.muted,
  fontSize: 14,
  cursor: 'pointer',
  marginTop: 14,
  textDecoration: 'underline'
};

export const strengthWrap: CSSProperties = {
  display: 'flex',
  gap: 4,
  marginTop: 8
};

export function strengthCell(filled: boolean): CSSProperties {
  return {
    height: 6,
    flex: 1,
    borderRadius: 3,
    background: filled ? palette.accent : '#d7e2ec'
  };
}

export const strengthLabel: CSSProperties = {
  fontSize: 12,
  color: palette.muted,
  marginTop: 4
};

export const cardField: CSSProperties = {
  padding: 10,
  fontSize: 15,
  borderRadius: radii.field,
  border: '1px solid #b9c9d8',
  width: '100%',
  boxSizing: 'border-box'
};

export const cardLabel: CSSProperties = {
  display: 'grid',
  gap: 6,
  fontSize: 13,
  fontWeight: 700,
  color: palette.muted
};

export const cardPrimary: CSSProperties = {
  padding: '10px 18px',
  fontSize: 15,
  fontWeight: 700,
  borderRadius: radii.field,
  border: 'none',
  background: palette.ink,
  color: '#fff',
  cursor: 'pointer'
};

export const cardSecondary: CSSProperties = {
  padding: '10px 18px',
  fontSize: 15,
  fontWeight: 600,
  borderRadius: radii.field,
  border: '1px solid #b9c9d8',
  background: '#fff',
  color: palette.text,
  cursor: 'pointer'
};

export const cardDanger: CSSProperties = {
  padding: '10px 18px',
  fontSize: 15,
  fontWeight: 600,
  borderRadius: radii.field,
  border: '1px solid #e5484d',
  background: '#fff',
  color: '#b4232a',
  cursor: 'pointer'
};

export const darkInput: CSSProperties = {
  padding: 10,
  fontSize: 14,
  borderRadius: radii.field,
  border: `1px solid ${palette.line}`,
  background: 'rgba(255, 255, 255, 0.06)',
  color: palette.light,
  width: '100%',
  boxSizing: 'border-box'
};

export const darkButton: CSSProperties = {
  padding: '9px 16px',
  fontSize: 14,
  fontWeight: 600,
  borderRadius: radii.field,
  border: `1px solid ${palette.line}`,
  background: 'transparent',
  color: palette.light,
  cursor: 'pointer',
  whiteSpace: 'nowrap'
};

export const accentButton: CSSProperties = {
  padding: '9px 16px',
  fontSize: 14,
  fontWeight: 700,
  borderRadius: radii.field,
  border: 'none',
  background: palette.accent,
  color: palette.accentInk,
  cursor: 'pointer',
  whiteSpace: 'nowrap'
};

export const toolbarRow: CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  alignItems: 'center'
};
