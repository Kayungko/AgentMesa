import { useMemo } from 'react';
import { readConfig } from './components/shell/route.js';
import { AppShell } from './components/shell/app-shell.js';
import { WidgetView } from './components/widget/widget-view.js';

export function App() {
  const config = useMemo(readConfig, []);
  return config.view === 'widget' ? <WidgetView config={config} /> : <AppShell config={config} />;
}
