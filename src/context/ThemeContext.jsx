import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Theme: 'light' | 'dark' | 'system'.
 *
 * `system` is a stored *choice*, not a stored appearance: it keeps following the
 * OS until the user picks explicitly, and `resolvedTheme` is what actually gets
 * applied to <html>.
 *
 * The very first application happens in an inline script in index.html, before
 * React loads. That is deliberate - a class applied from an effect would show a
 * flash of the light theme on every cold load in dark mode.
 */

const STORAGE_KEY = 'pg-manager:theme';

const ThemeContext = createContext(null);

const VALID = new Set(['light', 'dark', 'system']);

function readStoredTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return VALID.has(stored) ? stored : 'system';
  } catch {
    // Private browsing / blocked storage: fall back to the OS preference.
    return 'system';
  }
}

function prefersDark() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}

function systemTheme() {
  return prefersDark() ? 'dark' : 'light';
}

/**
 * Browser chrome (mobile status bar, PWA title bar) follows the active surface.
 * Must match the `theme-color` entries in index.html and the manifest.
 */
const THEME_COLORS = {
  light: '#eef1f7',
  dark: '#0b0f1f',
};

export function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  const resolved = theme === 'system' ? systemTheme() : theme;
  const root = document.documentElement;

  root.classList.toggle('dark', resolved === 'dark');

  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', THEME_COLORS[resolved]);
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(readStoredTheme);
  const [systemValue, setSystemValue] = useState(systemTheme);

  // Track the OS preference so a `system` theme reacts to a live switch.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(prefers-color-scheme: dark)');

    const onChange = (event) => {
      const next = event.matches ? 'dark' : 'light';
      setSystemValue(next);
      // Only follow along while the user has not made an explicit choice.
      if (readStoredTheme() === 'system') applyTheme('system');
    };

    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolvedTheme = theme === 'system' ? systemValue : theme;

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const changeTheme = useCallback((next) => {
    if (!VALID.has(next)) return;
    setTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Nothing to do - the choice still applies for this session.
    }
  }, []);

  const toggleTheme = useCallback(() => {
    changeTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  }, [resolvedTheme, changeTheme]);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme: changeTheme, toggleTheme }),
    [theme, resolvedTheme, changeTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>.');
  return ctx;
}

/** Exported for tests and for the Settings page's reset path. */
export { STORAGE_KEY as THEME_STORAGE_KEY };
