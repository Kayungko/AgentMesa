import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  Tray,
} from 'electron';
import type { NativeImage } from 'electron';
import { DeskServer } from '@agentmesa/desk';
import {
  addWorkspace,
  getActiveWorkspace,
  listWorkspaces,
} from '@agentmesa/core';
import type { MesaWorkspace } from '@agentmesa/protocol';

const WIDGET_COLLAPSED = { width: 220, height: 52 };
const WIDGET_EXPANDED = { width: 380, height: 520 };

let desk: DeskServer | undefined;
let mainWindow: BrowserWindow | undefined;
let widgetWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;
let baseUrl = '';
let sessionToken = '';

function rendererUrl(view: 'widget' | 'main', path = '/') {
  const indexPath = join(__dirname, '..', '..', 'client', 'dist', 'index.html');
  const url = new URL(pathToFileURL(indexPath));
  url.searchParams.set('view', view);
  url.searchParams.set('baseUrl', baseUrl);
  url.searchParams.set('token', sessionToken);
  url.hash = path;
  return url.toString();
}

function preloadPath() {
  return join(__dirname, 'preload.js');
}

function commonWebPreferences() {
  return {
    preload: preloadPath(),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
  };
}

// App icons live in packages/desktop/assets (see icon.svg, the source file the
// PNGs were rendered from). nativeImage can't load SVG directly, so we ship
// pre-rendered PNGs; falls back to undefined when a size is missing.
function loadAssetIcon(file: string): NativeImage | undefined {
  const iconPath = join(__dirname, '..', 'assets', file);
  return existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined;
}

function placeWidget(window: BrowserWindow) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const bounds = display.workArea;
  const size = window.getBounds();
  window.setPosition(
    bounds.x + bounds.width - size.width - 18,
    bounds.y + 18,
    false,
  );
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  const icon = loadAssetIcon('icon-256.png');
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    show: false,
    transparent: true,
    frame: false,
    roundedCorners: true,
    ...(icon ? { icon } : {}),
    webPreferences: commonWebPreferences(),
  });
  mainWindow.removeMenu();
  mainWindow.loadURL(rendererUrl('main')).catch(console.error);
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
  return mainWindow;
}

function createWidgetWindow() {
  if (widgetWindow && !widgetWindow.isDestroyed()) return widgetWindow;
  const icon = loadAssetIcon('icon-64.png');
  widgetWindow = new BrowserWindow({
    ...WIDGET_COLLAPSED,
    minWidth: WIDGET_COLLAPSED.width,
    minHeight: WIDGET_COLLAPSED.height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    roundedCorners: true,
    ...(icon ? { icon } : {}),
    webPreferences: commonWebPreferences(),
  });
  widgetWindow.setAlwaysOnTop(true, 'floating');
  widgetWindow.loadURL(rendererUrl('widget')).catch(console.error);
  widgetWindow.once('ready-to-show', () => {
    if (!widgetWindow) return;
    placeWidget(widgetWindow);
    widgetWindow.showInactive();
  });
  widgetWindow.on('closed', () => {
    widgetWindow = undefined;
  });
  return widgetWindow;
}

// Microsoft's recommended notification-area size ladder (100-300% scaling).
const TRAY_SIZES = [16, 20, 24, 32, 40, 48] as const;

function trayIcon(): NativeImage {
  // The tray shows the bare monogram on a transparent plate (no background)
  // so it sits naturally in the notification area. Windows renders tray icons
  // at 16px and scales for 125-300% DPI, so we ship the full official size
  // ladder and pick the raster closest to the display's effective size.
  const scaleFactor = screen.getPrimaryDisplay().scaleFactor || 1;
  const target = Math.round(16 * scaleFactor);
  const size = TRAY_SIZES.reduce(
    (best, s) => (Math.abs(s - target) < Math.abs(best - target) ? s : best),
    16,
  );
  const asset = loadAssetIcon(`icon-tray-${size}.png`) ?? loadAssetIcon('icon-16.png');
  if (asset) return asset;
  return pixelArtFallback();
}

function pixelArtFallback(): NativeImage {
  const size = 16;
  const data = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const inside = x >= 2 && x <= 13 && y >= 2 && y <= 13;
      data[offset] = inside ? 139 : 0;
      data[offset + 1] = inside ? 124 : 0;
      data[offset + 2] = inside ? 255 : 0;
      data[offset + 3] = inside ? 255 : 0;
    }
  }
  return nativeImage.createFromBuffer(data, { width: size, height: size });
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('AgentMesa');
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: '显示小组件',
      click: () => {
        const window = createWidgetWindow();
        placeWidget(window);
        window.showInactive();
      },
    },
    { label: '打开工作区', click: () => openMain('/') },
    { type: 'separator' },
    {
      label: '退出 AgentMesa',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]));
  tray.on('click', () => {
    const window = createWidgetWindow();
    if (window.isVisible()) window.hide();
    else {
      placeWidget(window);
      window.showInactive();
    }
  });
}

function openMain(path = '/') {
  const window = createMainWindow();
  if (path !== '/') window.loadURL(rendererUrl('main', path)).catch(console.error);
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function registerIpc() {
  ipcMain.handle('widget:toggle', () => {
    const window = createWidgetWindow();
    if (window.isVisible()) window.hide();
    else window.showInactive();
  });
  ipcMain.handle('widget:hide', () => widgetWindow?.hide());
  ipcMain.handle('widget:expanded', (_event, expanded: boolean) => {
    const window = createWidgetWindow();
    const size = expanded ? WIDGET_EXPANDED : WIDGET_COLLAPSED;
    window.setSize(size.width, size.height, true);
    placeWidget(window);
  });
  ipcMain.handle('main:open', (_event, path?: string) => openMain(path));
  ipcMain.handle('main:minimize', () => mainWindow?.minimize());
  ipcMain.handle('main:toggle-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.handle('main:close', () => mainWindow?.hide());
}

function resolveStartupWorkspace(): string {
  const envRoot = process.env['AGENTMESA_WORKSPACE']?.trim();
  if (envRoot) return resolve(envRoot);
  const active = getActiveWorkspace();
  if (active) return active.rootDir;
  return resolve(process.cwd());
}

function reloadRendererWindows() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(rendererUrl('main', '')).catch(console.error);
  }
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.loadURL(rendererUrl('widget')).catch(console.error);
  }
}

async function createDeskForWorkspace(rootDir: string): Promise<void> {
  // Adopt the startup workspace into the registry so the switcher can show it.
  const registered = listWorkspaces().some((workspace) => workspace.rootDir === rootDir);
  if (!registered) {
    try {
      addWorkspace({ rootDir });
    } catch {
      // Not an initialized AgentMesa workspace — leave it out of the registry.
    }
  }

  if (desk) {
    await desk.stop();
    desk = undefined;
  }

  desk = new DeskServer(rootDir, 0, {
    host: '127.0.0.1',
    sessionToken,
    writeActor: {
      id: 'user:desktop',
      type: 'user',
      roles: ['owner'],
      client: 'agentmesa-desktop',
    },
    onActivateWorkspace: async (workspace: MesaWorkspace) => {
      await createDeskForWorkspace(workspace.rootDir);
    },
  });
  await desk.start();
  baseUrl = `http://127.0.0.1:${desk.getPort()}`;
  reloadRendererWindows();
}

async function startRuntime() {
  sessionToken = randomBytes(32).toString('hex');
  const rootDir = resolveStartupWorkspace();
  await createDeskForWorkspace(rootDir);
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => openMain('/'));
  app.whenReady().then(async () => {
    await startRuntime();
    registerIpc();
    createTray();
    createWidgetWindow();
  }).catch((error) => {
    console.error(error);
    app.quit();
  });
}

app.on('window-all-closed', () => undefined);
app.on('before-quit', () => {
  quitting = true;
});
app.on('will-quit', () => {
  ipcMain.removeHandler('widget:toggle');
  ipcMain.removeHandler('widget:hide');
  ipcMain.removeHandler('widget:expanded');
  ipcMain.removeHandler('main:open');
  ipcMain.removeHandler('main:minimize');
  ipcMain.removeHandler('main:toggle-maximize');
  ipcMain.removeHandler('main:close');
  desk?.stop().catch(console.error);
});
