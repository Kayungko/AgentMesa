import { useCallback, useEffect, useState } from 'react';

/**
 * Theme activation for the Notion warm-paper / dark token pairs
 * (`tokens.css` `[data-theme="dark"]` overrides).
 *
 * State model — two-state with sticky user override:
 * - First paint is decided by `public/theme-boot.js` (parser-blocking, CSP-safe):
 *   persisted explicit choice, else OS preference via matchMedia.
 * - A manual toggle persists `agentmesa.theme` to localStorage and permanently
 *   overrides the OS default.
 * - Cross-window sync: Electron IPC broadcast (theme:set → theme:changed);
 *   plain-browser dev falls back to the `storage` event. The IPC path is the
 *   only reliable one under file:// where cross-window storage events are not
 *   guaranteed.
 */

export type Theme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'agentmesa.theme';

/** Coerce any persisted/IPC value into a Theme; anything invalid is light. */
export function normalizeTheme(value: unknown): Theme {
  return value === 'dark' ? 'dark' : 'light';
}

/** Read the boot-resolved theme (already set on <html> before React mounts). */
export function currentTheme(): Theme {
  return normalizeTheme(document.documentElement.dataset.theme);
}

/** Apply to <html> AND persist — the write side of the sticky override. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // localStorage unavailable (file:// privacy edge) — attr still applied.
  }
}

/** Toggle + notify the main process so the other window follows along. */
export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  void window.agentmesa?.setTheme(next);
  return next;
}

/**
 * Keep this window's data-theme in sync with the other window's choice.
 * Mount once at the App root (covers both main and widget views — the widget
 * has no toggle UI but must follow the broadcast).
 */
export function useThemeSync(): void {
  useEffect(() => {
    // Electron path: IPC broadcast from the main process relay.
    const unsubscribe = window.agentmesa?.onThemeChanged?.((theme) => {
      // Apply attr only — the originating window already persisted; writing
      // again here would be redundant (and could race).
      document.documentElement.dataset.theme = normalizeTheme(theme);
    });
    if (unsubscribe) {
      return unsubscribe;
    }
    // Plain-browser dev path: storage events between same-origin windows.
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY && event.newValue) {
        document.documentElement.dataset.theme = normalizeTheme(event.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
}

/** Reactive theme for the toggle button; optimistically updates on toggle. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  useThemeSync();
  useEffect(() => {
    // Keep the icon truthful when a remote broadcast flips the attr.
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);
  const toggle = useCallback(() => {
    setTheme(toggleTheme());
  }, []);
  return [theme, toggle];
}
