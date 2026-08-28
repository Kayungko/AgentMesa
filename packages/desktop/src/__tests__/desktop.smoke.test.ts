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
    // Regression: transparent frameless windows can miss `ready-to-show`
    // (Electron issue #7227), which left the widget un-placed at (0,0).
    // Assert it actually got placed by one of the show paths.
    const [screenX, screenY] = await widget.evaluate(() => {
      const w = globalThis as unknown as { screenX: number; screenY: number };
      return [w.screenX, w.screenY];
    });
    expect([screenX, screenY]).not.toEqual([0, 0]);
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
    await expect(main!.locator('.rail')).toBeVisible();
    await expect(main!.locator('.conv-list')).toBeVisible();
    await expect(main!.locator('.titlebar__brand')).toContainText('AgentMesa');
    await expect(main!.locator('.titlebar .connection')).toContainText('已连接');
    await main!.screenshot({ path: join(outputDir, 'agentmesa-main-window.png') });

    // New-session is a modal now: open it, assert, close with Escape.
    console.log('verifying new-session modal');
    await main!.getByRole('button', { name: '新建会话' }).first().click();
    await expect(main!.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
    await main!.keyboard.press('Escape');
    await expect(main!.getByRole('dialog')).toHaveCount(0);

    // --- IM shell deep-check: open a meeting chat, verify bubbles + context panel.
    const meetingRow = main!.getByRole('button').filter({ hasText: 'IdleGame' }).first();
    if (await meetingRow.count()) {
      console.log('opening meeting chat');
      await meetingRow.click();
      await expect(main!.locator('.chat-head')).toBeVisible({ timeout: 10_000 });
      await expect(main!.locator('.chat-stream')).toBeVisible();
      // The context panel lives in a slide-in drawer (default closed).
      await main!.getByRole('button', { name: '详情' }).click();
      await main!.waitForTimeout(250);
      await expect(main!.locator('.ctx-panel')).toBeVisible();
      await expect(main!.locator('.composer textarea')).toBeVisible();

      // Send a message as the human operator and verify the own-bubble render.
      console.log('sending a message to verify own bubble');
      await main!.locator('.composer textarea').fill('E2E 冒泡验证');
      await main!.locator('.composer textarea').press('Enter');
      let bubbleOk = true;
      try {
        await expect
          .poll(
            () => main!.locator('.chat-msg--own .bubble').filter({ hasText: 'E2E 冒泡验证' }).count(),
            { timeout: 10_000 },
          )
          .toBeGreaterThan(0);
      } catch {
        bubbleOk = false;
      }
      if (!bubbleOk) {
        const sendError = await main!.locator('.chat-send-error').textContent().catch(() => null);
        const domCount = await main!.evaluate(() => (globalThis as unknown as { document: PageDocument }).document.querySelectorAll('.chat-msg--own .bubble').length);
        const domText = await main!.evaluate(() => (globalThis as unknown as { document: PageDocument }).document.querySelector('.chat-msg--own .bubble p')?.textContent ?? '(none)');
        const diag = await main!.evaluate(() => {
          const g = globalThis as unknown as { document: PageDocument; getComputedStyle: (el: unknown) => Record<string, string> };
          const msg = g.document.querySelector('.chat-msg');
          const bubble = g.document.querySelector('.chat-msg .bubble');
          const stream = g.document.querySelector('.chat-stream');
          const pick = (el: unknown, props: string[]) => {
            if (!el) return null;
            const cs = g.getComputedStyle(el);
            return Object.fromEntries(props.map((p) => [p, cs[p]]));
          };
          return {
            msg: pick(msg, ['display', 'opacity', 'visibility', 'height', 'width']),
            bubble: pick(bubble, ['display', 'opacity', 'visibility', 'background', 'height']),
            stream: pick(stream, ['height', 'overflowY', 'scrollTop', 'scrollHeight']),
            msgRect: (() => { const r = (msg as unknown as { getBoundingClientRect: () => Record<string, number> } | null)?.getBoundingClientRect(); return r ? { top: r.top, left: r.left, height: r.height } : null; })(),
            streamRect: (() => { const r = (stream as unknown as { getBoundingClientRect: () => Record<string, number> } | null)?.getBoundingClientRect(); return r ? { top: r.top, left: r.left, height: r.height, width: r.width } : null; })(),
            html: (g.document.querySelector('.chat-stream') as unknown as { innerHTML: string } | null)?.innerHTML.slice(0, 600),
          };
        });
        console.log('DIAG send-error:', sendError ?? '(none)', '| own-bubble count:', domCount, '| first text:', domText, '| styles:', JSON.stringify(diag));
        await main!.screenshot({ path: join(outputDir, 'agentmesa-diag-send-failed.png') });
        await main!.locator('.chat-stream').screenshot({ path: join(outputDir, 'agentmesa-diag-stream-el.png') });
      }
      expect(bubbleOk).toBe(true);
      await expect(main!.locator('.day-divider').first()).toBeVisible();
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
