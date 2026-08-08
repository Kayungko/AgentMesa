import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

const desktopDir = resolve(__dirname, '..', '..');
const workspaceDir = resolve(desktopDir, '..', '..');
const outputDir = join(workspaceDir, '.tmpfiles');

test('launches widget, expands, and opens main workspace', async () => {
  test.setTimeout(60_000);
  console.log('launching electron');
  const electronExecutable = join(desktopDir, 'node_modules', 'electron', 'dist', 'electron.exe');
  const app = await electron.launch({
    executablePath: electronExecutable,
    args: [desktopDir],
    cwd: workspaceDir,
    env: {
      ...process.env,
      AGENTMESA_WORKSPACE: workspaceDir,
    },
  });

  try {
    console.log('waiting for widget');
    const widget = await app.firstWindow({ timeout: 15_000 });
    console.log('widget created', await widget.title());
    widget.on('console', (message) => console.log('renderer:', message.text()));
    await expect(widget.locator('.widget-summary')).toBeVisible({ timeout: 10_000 });
    await expect(widget.locator('.widget-summary__copy')).toContainText('AgentMesa');
    await expect.poll(async () => widget.evaluate(() => (globalThis as unknown as { outerWidth: number }).outerWidth)).toBe(220);
    await widget.screenshot({ path: join(outputDir, 'agentmesa-widget-collapsed.png') });

    console.log('expanding widget');
    await widget.locator('.widget-summary').click();
    await expect(widget.locator('.widget-header')).toBeVisible({ timeout: 10_000 });
    await expect(widget.locator('.connection')).toContainText('已连接');
    await expect.poll(async () => widget.evaluate(() => (globalThis as unknown as { outerHeight: number }).outerHeight)).toBe(520);
    await widget.screenshot({ path: join(outputDir, 'agentmesa-widget-expanded.png') });

    console.log('opening main window');
    await widget.getByRole('button', { name: '打开工作区' }).click();
    await expect.poll(() => app.windows().length, { timeout: 10_000 }).toBe(2);
    const main = app.windows().find((window) => window !== widget);
    expect(main).toBeDefined();
    await expect(main!.locator('.app-shell')).toBeVisible();
    await expect(main!.locator('.titlebar__brand')).toContainText('AgentMesa');
    await expect(main!.locator('.titlebar .connection')).toContainText('已连接');
    await main!.screenshot({ path: join(outputDir, 'agentmesa-main-window.png') });
  } finally {
    await app.close();
  }
});
