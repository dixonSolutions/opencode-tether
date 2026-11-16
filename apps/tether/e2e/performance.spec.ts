import { test, expect } from '@playwright/test';
import { open } from './helpers';

test('settings interaction latency and overflow', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, baseURL!);
  const result = await page.evaluate(async () => {
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const start = performance.now();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true, bubbles: true }));
    let sheet: HTMLElement | null;
    do { await frame(); sheet = document.querySelector('[data-slot="sheet-content"]'); } while (!sheet);
    const mounted = performance.now() - start;
    getComputedStyle(sheet).transform;
    await frame();
    while (sheet.getAnimations({ subtree: true }).some(a => a.playState === 'running')) await frame();
    const settled = performance.now() - start;
    const toggle = sheet.querySelector('[role=switch]') as HTMLElement;
    const previous = toggle.getAttribute('aria-checked');
    const t = performance.now(); toggle.click();
    do { await frame(); } while (toggle.getAttribute('aria-checked') === previous);
    const toggleMs = performance.now() - t;
    const tab = [...sheet.querySelectorAll<HTMLElement>('[role=tab]')].find(el => el.textContent === 'About')!;
    const tabStart = performance.now(); tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); tab.click();
    do { await frame(); } while (tab.getAttribute('aria-selected') !== 'true');
    return { mounted, settled, toggleMs, tabMs: performance.now() - tabStart, overflow: document.documentElement.scrollWidth - innerWidth };
  });
  console.log('UI_PERFORMANCE', JSON.stringify(result));
  expect(result.toggleMs).toBeLessThan(50);
  expect(result.settled).toBeLessThan(process.env.PERF_BASELINE ? 1000 : 150);
  expect(result.tabMs).toBeLessThan(150);
  expect(result.overflow).toBeLessThanOrEqual(1);
});

test('a pointer toggle acknowledges immediately and persists the final value asynchronously', async ({ page, baseURL }) => {
  await open(page, baseURL!);
  await page.keyboard.press('Control+,');
  const toggle = page.getByRole('switch', { name: 'Show timestamps', exact: true });
  await expect(toggle).toBeVisible();
  await toggle.evaluate(el => {
    const state = window as unknown as { toggleLatency: number; toggleStart: number };
    el.addEventListener('click', () => { state.toggleStart = performance.now(); }, { capture: true });
    new MutationObserver(() => { state.toggleLatency = performance.now() - state.toggleStart; })
      .observe(el, { attributes: true, attributeFilter: ['aria-checked'] });
  });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => (window as unknown as { toggleLatency: number }).toggleLatency)).toBeLessThan(50);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('opencode-tether.store.v1')!).settings.showTimestamps)).toBe(true);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('opencode-tether.store.v1')!).settings.showTimestamps)).toBe(false);
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
});

test('Android settings keep accessible controls without expensive or flashing effects', async ({ page, baseURL }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { get: () => 'Android' }));
  await open(page, baseURL!);
  await page.keyboard.press('Control+,');
  await expect(page.locator('html')).toHaveClass(/is-android/);
  const sheet = page.locator('[data-slot="sheet-content"]');
  await expect(sheet).toBeVisible();
  expect(await sheet.evaluate(el => ({ animation: getComputedStyle(el).animationName, shadow: getComputedStyle(el).boxShadow })))
    .toEqual({ animation: 'none', shadow: 'none' });
  const overlay = page.locator('[data-slot="sheet-overlay"]');
  expect(await overlay.evaluate(el => getComputedStyle(el).backdropFilter)).toBe('none');
  const toggle = page.getByRole('switch', { name: 'Auto-scroll', exact: true });
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect(await toggle.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
});
