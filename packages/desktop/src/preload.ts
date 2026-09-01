import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('agentmesa', {
  toggleWidget: () => ipcRenderer.invoke('widget:toggle'),
  openMain: (path?: string) => ipcRenderer.invoke('main:open', path),
  setWidgetExpanded: (expanded: boolean) => ipcRenderer.invoke('widget:expanded', expanded),
  hideWidget: () => ipcRenderer.invoke('widget:hide'),
  minimizeMain: () => ipcRenderer.invoke('main:minimize'),
  toggleMaximizeMain: () => ipcRenderer.invoke('main:toggle-maximize'),
  closeMain: () => ipcRenderer.invoke('main:close'),
  setTheme: (theme: 'light' | 'dark') => ipcRenderer.invoke('theme:set', theme),
  onThemeChanged: (callback: (theme: 'light' | 'dark') => void) => {
    const listener = (_event: unknown, theme: 'light' | 'dark') => callback(theme);
    ipcRenderer.on('theme:changed', listener);
    return () => {
      ipcRenderer.off('theme:changed', listener);
    };
  },
});
