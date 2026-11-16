import { test, expect, type Page } from '@playwright/test';

import { open } from './helpers';

const HOME = '/home/test';
const PROJECTS = `${HOME}/Projects`;
const PROJECT = `${PROJECTS}/test-project`;

const sheet = (page: Page) => page.locator('[data-slot="sheet-content"]').filter({ hasText: /./ }).last();
const dialog = (page: Page) => page.locator('[data-slot="dialog-content"]');

async function visibleSheet(page: Page) {
  const sheet = page.locator('[data-slot="sheet-content"]:visible');
  await expect(sheet).toHaveCount(1);
  await expect(sheet).toHaveAttribute('data-side', 'left');
  const box = await sheet.boundingBox();
  expect(box?.x ?? 1).toBeLessThanOrEqual(1);
  return sheet;
}

async function closeVisibleSheet(page: Page) {
  const sheet = await visibleSheet(page);
  const close = sheet.getByRole('button', { name: 'Close', exact: true });
  await expect(close).toContainText('Close');
  const box = await close.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(36);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(36);
  await close.click();
  await expect(page.locator('[data-slot="sheet-content"]')).toHaveCount(0);
}

test('desktop keeps one left sidebar and readable, comfortable controls', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, baseURL!);
  await expect(page.getByRole('button', { name: 'Choose folder' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New session', exact: true }).first()).toBeVisible();
  const rowFont = await page.getByRole('button', { name: 'Open Polish the interface' }).evaluate((el) => parseFloat(getComputedStyle(el.querySelector('span') ?? el).fontSize));
  expect(rowFont).toBeGreaterThanOrEqual(14);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test('mobile sessions, settings, remotes, and details all open on the left with a clear Close button', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, baseURL!);
  const menu = page.getByRole('button', { name: 'Open sessions', exact: true });

  await menu.click();
  await expect(await visibleSheet(page)).toContainText('All folders');
  await closeVisibleSheet(page);

  await menu.click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(await visibleSheet(page)).toContainText('Appearance');
  await closeVisibleSheet(page);

  await menu.click();
  await page.getByRole('button', { name: 'Remotes', exact: true }).click();
  await expect(await visibleSheet(page)).toContainText('Better remote access');
  await closeVisibleSheet(page);

  await page.locator('header').getByRole('button', { name: 'Toggle session panel', exact: true }).click();
  await expect(await visibleSheet(page)).toContainText('Session details');
  await closeVisibleSheet(page);
});

test('project picker starts at home, searches folders, and creates the session in the chosen directory', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let createdDirectory: string | null = null;
  await open(page, baseURL!, { onSession: (url) => (createdDirectory = url.searchParams.get('directory')) });
  await page.getByRole('button', { name: 'Open sessions', exact: true }).click();
  await page.getByRole('button', { name: 'Choose folder' }).click();

  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByText('Choose a folder')).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: 'Home', exact: true })).toBeVisible();
  await expect(dialog(page).getByText('Projects', { exact: true })).toBeVisible();
  await expect(dialog(page).getByText('other-worker', { exact: true })).toHaveCount(0);
  await expect(dialog(page).getByRole('button', { name: 'Close', exact: true })).toBeVisible();

  const search = dialog(page).getByRole('textbox', { name: 'Search folders' });
  await search.fill('test-project');
  const result = dialog(page).locator('button').filter({ hasText: 'Projects/test-project' }).first();
  await expect(result).toBeVisible({ timeout: 10_000 });
  await result.click();
  await expect(dialog(page).getByText(`Selected: ${PROJECT}`)).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Use this folder', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Choose folder' })).toContainText('test-project');
  await page.getByRole('button', { name: 'New session', exact: true }).first().click();
  await expect.poll(() => createdDirectory).toBe(PROJECT);
});

test('recent folders are offered after a choice, open in one tap, and can be removed', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, baseURL!);
  await page.getByRole('button', { name: 'Choose folder' }).click();
  await dialog(page).getByRole('textbox', { name: 'Search folders' }).fill('test-project');
  await dialog(page).locator('button').filter({ hasText: 'Projects/test-project' }).first().click();
  await dialog(page).getByRole('button', { name: 'Use this folder', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Choose folder' }).click();
  await expect(dialog(page).getByText('Recent', { exact: true })).toBeVisible();
  const recent = dialog(page).getByRole('button', { name: /test-project/ }).first();
  await expect(recent).toBeVisible();

  await dialog(page).getByRole('button', { name: `Remove ${PROJECT} from recent folders` }).click();
  await expect(dialog(page).getByText('Recent', { exact: true })).toHaveCount(0);
});

test('sessions waiting on a permission are pinned under Needs you and open on click', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, baseURL!, {
    permissions: [
      { id: 'per_1', sessionID: 'ses_two', permission: 'bash', patterns: ['npm test'], metadata: {}, always: ['npm *'] }
    ]
  });
  await expect(page.getByText('Needs you', { exact: false }).first()).toBeVisible();
  const waiting = page.getByRole('button', { name: /Add directory picker.*Waiting for bash/ });
  await expect(waiting).toBeVisible();
  await waiting.click();
  await expect(page.getByRole('heading', { name: 'Add directory picker' })).toBeVisible();
});

test('layout has no horizontal overflow and touch controls reach 44px at phone, tablet, and desktop widths', async ({ page, baseURL }) => {
  const browser = page.context().browser()!;
  for (const [width, height, touch] of [[320, 568, true], [390, 844, true], [834, 1112, true], [1440, 900, false]] as const) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch });
    const view = await context.newPage();
    await open(view, baseURL!);
    const overflow = await view.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow, `overflow at ${width}px`).toBe(false);
    if (touch) {
      const tooSmall = await view.evaluate(() =>
        [...document.querySelectorAll('button:not([data-slot="switch"]), input, textarea')]
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
          })
          .filter((element) => element.getBoundingClientRect().height < 43)
          .map((element) => ({ tag: element.tagName, text: (element.textContent ?? '').trim().slice(0, 40), height: element.getBoundingClientRect().height }))
      );
      expect(tooSmall, `small controls at ${width}px`).toEqual([]);
      if (width === 390 || width === 320) {
        await view.getByRole('button', { name: 'Open sessions', exact: true }).click();
        const sheetControls = await view.locator('[data-slot="sheet-content"]').evaluate((node) =>
          [...node.querySelectorAll('button:not([data-slot="switch"]), input, textarea')]
            .filter((element) => {
              const rect = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
            })
            .filter((element) => element.getBoundingClientRect().height < 43)
            .map((element) => ({ text: (element.textContent ?? '').trim().slice(0, 40), height: element.getBoundingClientRect().height }))
        );
        expect(sheetControls, 'small controls in the sessions sheet').toEqual([]);
        const close = view.locator('[data-slot="sheet-content"]').getByRole('button', { name: 'Close', exact: true });
        const closeBox = await close.boundingBox();
        expect(closeBox?.height ?? 0).toBeGreaterThanOrEqual(44);
        await close.click();
      }
    }
    await context.close();
  }
});
