'use client';

import { useEffect, useState } from 'react';
import { applyTheme, effectiveTheme, NEXT_MODE, readStoredMode, storeMode, type ThemeMode } from '@/lib/theme';

const SYMBOL: Record<ThemeMode, string> = {
  auto: '◐',
  light: '☀',
  dark: '☾',
};

const LABEL: Record<ThemeMode, string> = {
  auto: 'Automatic',
  light: 'Light',
  dark: 'Dark',
};

/**
 * One button, three states: Auto follows the clock (see lib/theme.ts), Light
 * and Dark pin it. Tapping cycles auto → light → dark → auto, same order a
 * thumb would want to try them in.
 *
 * Auto keeps checking. A shift is hours long, so if the page is left open
 * across the light/dark boundary it should cross it without a reload - a
 * minute is often enough to notice, and cheap enough to poll for. The
 * visibility listener catches the case a throttled background tab misses.
 */
export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>('auto');

  useEffect(() => {
    setMode(readStoredMode());
  }, []);

  useEffect(() => {
    applyTheme(effectiveTheme(mode));
    if (mode !== 'auto') return;

    const recheck = () => applyTheme(effectiveTheme('auto'));
    const id = window.setInterval(recheck, 60_000);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [mode]);

  function cycle() {
    const next = NEXT_MODE[mode];
    storeMode(next);
    setMode(next);
  }

  return (
    <button
      onClick={cycle}
      title={`Theme: ${LABEL[mode]} - tap for ${LABEL[NEXT_MODE[mode]]}`}
      aria-label={`Theme: ${LABEL[mode]}. Tap to switch to ${LABEL[NEXT_MODE[mode]]}.`}
      className="btn btn-quiet min-h-11 w-11 px-0 text-base"
    >
      <span aria-hidden="true">{SYMBOL[mode]}</span>
    </button>
  );
}
