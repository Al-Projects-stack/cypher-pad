export const AUTOLOCK_KEY = 'cipherpad.autolock.ms';
export const AUTOLOCK_DEFAULT_MS = 300000;

export const AUTOLOCK_OPTIONS: Array<{ label: string; ms: number }> = [
  { label: '1 minute', ms: 60000 },
  { label: '5 minutes', ms: 300000 },
  { label: '15 minutes', ms: 900000 },
  { label: '30 minutes', ms: 1800000 },
  { label: 'Never', ms: 0 }
];

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface AutoLockHandle {
  stop(): void;
  poke(): void;
  setTimeoutMs(ms: number): void;
  getTimeoutMs(): number;
}

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'scroll'] as const;

export function readAutoLockMs(storage: KeyValueStorage | null, fallback: number = AUTOLOCK_DEFAULT_MS): number {
  if (!storage) return fallback;
  const raw = storage.getItem(AUTOLOCK_KEY);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  if (parsed !== 0 && !AUTOLOCK_OPTIONS.some((o) => o.ms === parsed)) return fallback;
  return parsed;
}

export function startAutoLock(
  onLock: () => void,
  initialMs: number,
  storage: KeyValueStorage | null = typeof localStorage !== 'undefined' ? localStorage : null
): AutoLockHandle {
  let timeoutMs = initialMs;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function clear(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function arm(): void {
    clear();
    if (stopped || timeoutMs <= 0) return;
    timer = setTimeout(() => {
      timer = null;
      onLock();
    }, timeoutMs);
  }

  function onActivity(): void {
    if (!stopped) arm();
  }

  if (typeof window !== 'undefined') {
    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, onActivity, { passive: true });
    }
  }
  arm();

  return {
    stop() {
      stopped = true;
      clear();
      if (typeof window !== 'undefined') {
        for (const name of ACTIVITY_EVENTS) {
          window.removeEventListener(name, onActivity);
        }
      }
    },
    poke() {
      if (!stopped) arm();
    },
    setTimeoutMs(ms: number) {
      timeoutMs = ms;
      storage?.setItem(AUTOLOCK_KEY, String(ms));
      arm();
    },
    getTimeoutMs() {
      return timeoutMs;
    }
  };
}
