import { expect, test, type Page } from '@playwright/test';

async function registerAndCreateFreeProject(page: Page) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const slug = `e2e-${suffix}`;
  await page.goto('/create');

  await page.getByRole('button', { name: /register|sign up|регистра/i }).click();
  await page.getByPlaceholder('developer@example.com').fill(`e2e-${suffix}@example.com`);
  await page.locator('input[type="password"]').fill('E2E-password-12345!');
  await page.locator('input[type="checkbox"]').check();
  await page.locator('form button[type="submit"]').click();

  await expect(page.locator('input[placeholder="frontend-redesign"]')).toBeVisible();
  const requiredInputs = page.locator('form input[required]');
  await requiredInputs.first().fill(`E2E ${suffix}`);
  await page.locator('input[placeholder="frontend-redesign"]').fill(slug);
  await page.locator('form button[type="submit"]').click();

  await expect(page.getByText('API Token', { exact: true })).toBeVisible();
  const publicKey = await page.locator('input[readonly]').evaluateAll((nodes) => {
    const values = nodes.map((node) => (node as HTMLInputElement).value);
    return values.find((value) => value.startsWith('vb_pub_')) || '';
  });
  expect(publicKey).toMatch(/^vb_pub_/);

  const workspaceId = await page.evaluate(() => localStorage.getItem('vibeus_workspace_id') || '');
  expect(workspaceId).not.toBe('');
  return { publicKey, workspaceId, slug };
}


test('register -> free project -> one-time credentials', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Primary account journey runs once on desktop');
  await registerAndCreateFreeProject(page);
});


test('enterprise task board switches light/dark theme and remembers the choice', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Enterprise board journey runs once on desktop');
  const { slug } = await registerAndCreateFreeProject(page);

  await page.goto('/app');
  const project = page.locator('article').filter({ hasText: slug });
  await expect(project).toBeVisible();
  await project.getByRole('button', { name: /board|доска/i }).click();

  const shell = page.locator('.enterprise-board-host');
  await expect(page.locator('.enterprise-board-modal')).toBeVisible();
  await expect(shell).toHaveClass(/vibe-theme-(?:light|dark)/);
  await expect(page.locator('.enterprise-board-stage .spatial-kanban')).toBeVisible();

  const before = await shell.getAttribute('class');
  const beforeTheme = before?.includes('vibe-theme-light') ? 'light' : 'dark';
  const afterTheme = beforeTheme === 'light' ? 'dark' : 'light';

  await shell.locator('header button').first().click();
  await expect(shell).toHaveClass(new RegExp(`vibe-theme-${afterTheme}`));
  await expect.poll(async () => page.evaluate(() => localStorage.getItem('vibus_board_theme'))).toBe(afterTheme);

  await shell.locator('header button').last().click();
  await expect(page.locator('.enterprise-board-modal')).toHaveCount(0);
  await project.getByRole('button', { name: /board|доска/i }).click();
  await expect(page.locator('.enterprise-board-host')).toHaveClass(new RegExp(`vibe-theme-${afterTheme}`));
});


test('international checkout requires country and blocks current EEA/UK scope', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Billing decision flow runs once on desktop');
  const { workspaceId } = await registerAndCreateFreeProject(page);
  const success = 'http://localhost:5173/app?payment=return&market=global';
  const cancel = 'http://localhost:5173/app?payment=cancel&market=global';

  await page.goto(`/billing/international?workspace=${encodeURIComponent(workspaceId)}&tier=solo&success=${encodeURIComponent(success)}&cancel=${encodeURIComponent(cancel)}`);
  await expect(page.getByRole('heading', { name: /international checkout/i })).toBeVisible();
  await page.locator('select').selectOption('DE');
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: /continue to secure payment/i }).click();
  await expect(page.getByText(/not yet offered in the EEA or UK/i)).toBeVisible();

  await page.locator('select').selectOption('US');
  await page.getByRole('button', { name: /continue to secure payment/i }).click();
  await page.waitForURL(/payment=return/);
});


test('standalone public widget mounts in Shadow DOM and exposes compact feedback form', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'Widget journey is intentionally exercised on mobile viewport');
  const { publicKey, slug } = await registerAndCreateFreeProject(page);

  await page.goto('/');
  await page.evaluate(({ publicKey, slug }) => {
    document.querySelectorAll('vibus-widget, vibeus-widget').forEach((node) => node.remove());
    const script = document.createElement('script');
    script.src = 'http://localhost:8000/static/vibus-widget.umd.cjs';
    script.dataset.project = slug;
    script.dataset.publicKey = publicKey;
    script.dataset.server = 'http://localhost:8000';
    script.dataset.mode = 'public_feedback';
    document.body.appendChild(script);
  }, { publicKey, slug });

  const widget = page.locator('vibus-widget');
  await expect(widget).toBeAttached();
  await expect.poll(async () => widget.evaluate((el: any) => Boolean(el.shadowRoot?.querySelector('#vibeWidgetBtn')))).toBe(true);
  await widget.evaluate((el: any) => (el.shadowRoot?.querySelector('#vibeWidgetBtn') as HTMLElement | null)?.click());
  await expect.poll(async () => widget.evaluate((el: any) => el.shadowRoot?.textContent?.includes('Send feedback') || el.shadowRoot?.textContent?.includes('Отправить'))).toBe(true);
  await expect.poll(async () => widget.evaluate((el: any) => el.shadowRoot?.querySelector('[data-vibus-root]')?.className || '')).toMatch(/vibe-theme-(?:light|dark)/);

  const box = await widget.evaluate((el: any) => {
    const panel = el.shadowRoot?.querySelector('.spatial-kanban') as HTMLElement | null;
    if (!panel) return null;
    const rect = panel.getBoundingClientRect();
    return { width: rect.width, height: rect.height, viewport: window.innerWidth };
  });
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(box!.viewport);
});
