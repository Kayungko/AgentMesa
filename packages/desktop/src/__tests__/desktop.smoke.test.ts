import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

// Minimal structural shape of the page's `document` for `evaluate()` callbacks:
// the desktop package typechecks without the DOM lib (Electron main process),
// so page-context access goes through a globalThis cast, as with outerWidth above.
type PageDocument = {
  querySelectorAll(selector: string): { length: number };
  querySelector(selector: string): { textContent: string | null } | null;
  documentElement: { dataset: Record<string, string> };
};

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
    // Frameless transparent windows report bounds + a small OS-managed border
    // on some Windows builds (220 → 223 observed); assert the contract size
    // with that tolerance instead of pixel-exact equality.
    const collapsedWidth = await widget.evaluate(() => (globalThis as unknown as { outerWidth: number }).outerWidth);
    expect(collapsedWidth).toBeGreaterThanOrEqual(220);
    expect(collapsedWidth).toBeLessThanOrEqual(224);
    await widget.screenshot({ path: join(outputDir, 'agentmesa-widget-collapsed.png') });

    console.log('expanding widget');
    await widget.locator('.widget-summary').click();
    await expect(widget.locator('.widget-header')).toBeVisible({ timeout: 10_000 });
    await expect(widget.locator('.connection')).toContainText('已连接');
    const expandedHeight = await widget.evaluate(() => (globalThis as unknown as { outerHeight: number }).outerHeight);
    expect(expandedHeight).toBeGreaterThanOrEqual(520);
    expect(expandedHeight).toBeLessThanOrEqual(524);
    await widget.screenshot({ path: join(outputDir, 'agentmesa-widget-expanded.png') });

    console.log('opening main window');
    await widget.getByRole('button', { name: '打开工作区' }).click();
    await expect.poll(() => app.windows().length, { timeout: 10_000 }).toBe(2);
    const main = app.windows().find((window) => window !== widget);
    expect(main).toBeDefined();
    main!.on('console', (message) => console.log('main renderer:', message.text()));
    await expect(main!.locator('.chat-shell')).toBeVisible();
    await expect(main!.locator('.conv-list')).toBeVisible();
    await expect(main!.locator('.titlebar__brand')).toContainText('AgentMesa');
    await expect(main!.locator('.titlebar .connection')).toContainText('已连接');
    await main!.screenshot({ path: join(outputDir, 'agentmesa-main-window.png') });

    // --- IM shell deep-check: open a meeting chat, verify bubbles + context panel.
    const meetingRow = main!.getByRole('button').filter({ hasText: 'IdleGame' }).first();
    if (await meetingRow.count()) {
      console.log('opening meeting chat');
      await meetingRow.click();
      await expect(main!.locator('.chat-head')).toBeVisible({ timeout: 10_000 });
      await expect(main!.locator('.chat-stream')).toBeVisible();
      await expect(main!.locator('.ctx-panel')).toBeVisible();
      await expect(main!.locator('.composer textarea')).toBeVisible();

      // Send a message as the human operator and verify the own-bubble render.
      console.log('sending a message to verify own bubble');
      await main!.locator('.composer textarea').fill('E2E 冒泡验证');
      await main!.locator('.composer textarea').press('Enter');
      const bubbleOk = await main!.locator('.chat-msg--own .bubble').filter({ hasText: 'E2E 冒泡验证' })
        .waitFor({ timeout: 10_000 })
        .then(() => true, () => false);
      if (!bubbleOk) {
        const sendError = await main!.locator('.chat-send-error').textContent().catch(() => null);
        const domCount = await main!.evaluate(() => (globalThis as unknown as { document: PageDocument }).document.querySelectorAll('.chat-msg--own .bubble').length);
        const domText = await main!.evaluate(() => (globalThis as unknown as { document: PageDocument }).document.querySelector('.chat-msg--own .bubble p')?.textContent ?? '(none)');
        console.log('DIAG send-error:', sendError ?? '(none)', '| own-bubble count:', domCount, '| first text:', domText);
        await main!.screenshot({ path: join(outputDir, 'agentmesa-diag-send-failed.png') });
      }
      expect(bubbleOk).toBe(true);
      await expect(main!.locator('.day-divider')).toBeVisible();
      await main!.screenshot({ path: join(outputDir, 'agentmesa-meeting-chat.png') });

      // Dark theme parity check on the new shell.
      await main!.evaluate(() => { (globalThis as unknown as { document: PageDocument }).document.documentElement.dataset.theme = 'dark'; });
      await main!.waitForTimeout(300);
      await main!.screenshot({ path: join(outputDir, 'agentmesa-meeting-chat-dark.png') });
      await main!.evaluate(() => { (globalThis as unknown as { document: PageDocument }).document.documentElement.dataset.theme = 'light'; });

      const roomRow = main!.getByRole('button').filter({ hasText: '测试群' }).first();
      if (await roomRow.count()) {
        console.log('opening room chat');
        await roomRow.click();
        await expect(main!.locator('.chat-head')).toBeVisible({ timeout: 10_000 });
        await main!.screenshot({ path: join(outputDir, 'agentmesa-room-chat.png') });
      }
    }
  } finally {
    await app.close();
  }
});
