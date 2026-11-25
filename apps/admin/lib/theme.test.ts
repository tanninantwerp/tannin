import { describe, expect, it } from 'vitest';
import { effectiveTheme, NEXT_MODE } from './theme';

/**
 * The clock math. Worth pinning down exactly, since a boundary that is off
 * by one hour is invisible until somebody notices the screen changed at the
 * wrong moment and has no idea why.
 */

describe('effectiveTheme', () => {
  it('an explicit mode always wins, whatever the hour', () => {
    expect(effectiveTheme('light', new Date(2026, 0, 1, 2))).toBe('light');
    expect(effectiveTheme('dark', new Date(2026, 0, 1, 14))).toBe('dark');
  });

  it('is light through the day in auto', () => {
    for (const hour of [8, 12, 18]) {
      expect(effectiveTheme('auto', new Date(2026, 0, 1, hour)), String(hour)).toBe('light');
    }
  });

  it('is dark through the evening and night in auto', () => {
    for (const hour of [19, 23, 0, 3, 7]) {
      expect(effectiveTheme('auto', new Date(2026, 0, 1, hour)), String(hour)).toBe('dark');
    }
  });
});

describe('NEXT_MODE', () => {
  it('cycles auto → light → dark → auto', () => {
    expect(NEXT_MODE.auto).toBe('light');
    expect(NEXT_MODE.light).toBe('dark');
    expect(NEXT_MODE.dark).toBe('auto');
  });
});
