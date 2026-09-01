import { useMemo } from 'react';
import { readConfig } from './components/shell/route.js';
import { AppShell } from './components/shell/app-shell.js';
import { WidgetView } from './components/widget/widget-view.js';
import { useThemeSync } from './components/shell/theme.js';

export function App() {
  const config = useMemo(readConfig, []);
  // Follow theme broadcasts from the other window (widget has no toggle UI;
  // main needs it even before its Titlebar mounts).
  useThemeSync();
  return config.view === 'widget' ? <WidgetView config={config} /> : <AppShell config={config} />;
}
