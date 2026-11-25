/**
 * Light and dark, switched by the clock rather than the device.
 *
 * There is no sunrise/sunset API here - just the hour on whatever device is
 * signed in. The window below is wide on purpose: `LIGHT_START` is well into
 * the morning and `LIGHT_END` is early evening, so the room being dim on a
 * grey afternoon or bright at 9pm in June does not flip the screen against
 * what the room actually looks like. It errs toward dark, the same way the
 * rest of this admin does - see the note at the top of globals.css.
 */

export type ThemeMode = 'auto' | 'light' | 'dark';
export type EffectiveTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'tannin-admin-theme';

const LIGHT_START_HOUR = 8;
const LIGHT_END_HOUR = 19;

/** What to actually render: the override if there is one, otherwise the clock. */
export function effectiveTheme(mode: ThemeMode, at: Date = new Date()): EffectiveTheme {
  if (mode !== 'auto') return mode;
  const hour = at.getHours();
  return hour >= LIGHT_START_HOUR && hour < LIGHT_END_HOUR ? 'light' : 'dark';
}

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'auto' || value === 'light' || value === 'dark';
}

/** Defaults to automatic - nobody has to find a setting for this to work. */
export function readStoredMode(): ThemeMode {
  if (typeof window === 'undefined') return 'auto';
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isThemeMode(stored) ? stored : 'auto';
}

export function storeMode(mode: ThemeMode): void {
  window.localStorage.setItem(THEME_STORAGE_KEY, mode);
}

export function applyTheme(theme: EffectiveTheme): void {
  document.documentElement.dataset.theme = theme;
}

export const NEXT_MODE: Record<ThemeMode, ThemeMode> = {
  auto: 'light',
  light: 'dark',
  dark: 'auto',
};
