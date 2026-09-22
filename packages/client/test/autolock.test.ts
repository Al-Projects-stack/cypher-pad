import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOLOCK_DEFAULT_MS,
  AUTOLOCK_KEY,
  readAutoLockMs,
  startAutoLock,
  type KeyValueStorage
} from '../src/vault/autolock.js';

function memoryStorage(seed: Record<string, string> = {}): KeyValueStorage {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v)
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('auto lock', () => {
  it('fires after idle timeout', () => {
    vi.useFakeTimers();
    const onLock = vi.fn();
    const handle = startAutoLock(onLock, 60000, memoryStorage());
    try {
      vi.advanceTimersByTime(59999);
      expect(onLock).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onLock).toHaveBeenCalledTimes(1);
    } finally {
      handle.stop();
    }
  });

  it('resets on activity', () => {
    vi.useFakeTimers();
    const onLock = vi.fn();
    const handle = startAutoLock(onLock, 60000, memoryStorage());
    try {
      vi.advanceTimersByTime(50000);
      window.dispatchEvent(new window.Event('pointerdown'));
      vi.advanceTimersByTime(50000);
      expect(onLock).not.toHaveBeenCalled();
      vi.advanceTimersByTime(10000);
      expect(onLock).toHaveBeenCalledTimes(1);
    } finally {
      handle.stop();
    }
  });

  it('stays unlocked when set to never', () => {
    vi.useFakeTimers();
    const onLock = vi.fn();
    const handle = startAutoLock(onLock, 0, memoryStorage());
    try {
      vi.advanceTimersByTime(3600000);
      expect(onLock).not.toHaveBeenCalled();
    } finally {
      handle.stop();
    }
  });

  it('persists timeout changes', () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const onLock = vi.fn();
    const handle = startAutoLock(onLock, 60000, storage);
    try {
      handle.setTimeoutMs(900000);
      expect(storage.getItem(AUTOLOCK_KEY)).toBe('900000');
      expect(handle.getTimeoutMs()).toBe(900000);
    } finally {
      handle.stop();
    }
  });

  it('reads stored timeout with safe fallback', () => {
    expect(readAutoLockMs(memoryStorage(), 111)).toBe(111);
    expect(readAutoLockMs(memoryStorage({ [AUTOLOCK_KEY]: '900000' }), 111)).toBe(900000);
    expect(readAutoLockMs(memoryStorage({ [AUTOLOCK_KEY]: 'nope' }), 111)).toBe(111);
    expect(readAutoLockMs(memoryStorage({ [AUTOLOCK_KEY]: '424242' }), 111)).toBe(111);
    expect(readAutoLockMs(null, AUTOLOCK_DEFAULT_MS)).toBe(AUTOLOCK_DEFAULT_MS);
  });
});
