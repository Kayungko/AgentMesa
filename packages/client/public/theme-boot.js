// Theme boot — runs as a classic (parser-blocking) script before first paint.
// CSP `script-src 'self'` forbids inline scripts, so this lives as an external
// file; it must stay tiny and dependency-free. Resolution order matches
// src/components/shell/theme.ts: persisted explicit choice, else OS preference.
// Keep in sync with normalizeTheme() there (this file is plain JS outside the
// module graph and cannot be imported by the vitest suite).
(function () {
  var stored = null;
  try { stored = localStorage.getItem('agentmesa.theme'); } catch (e) { /* file:// privacy mode fallback */ }
  var theme = stored === 'dark' || stored === 'light'
    ? stored
    : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
})();
