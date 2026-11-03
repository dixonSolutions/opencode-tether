import { test, expect, type Page } from '@playwright/test';

const HOME = '/home/test';
const T0 = 1_700_000_000_000;
const PROJECTS = `${HOME}/Projects`;
const PROJECT = `${PROJECTS}/test-project`;

interface MockOptions {
  onSession?: (url: URL) => void;
}

function node(name: string, parent: string) {
  const absolute = `${parent.replace(/\/+$/, '')}/${name}`;
  return { name, path: `${name}/`, absolute, type: 'directory', ignored: false };
}

const tree: Record<string, ReturnType<typeof node>[]> = {
  [HOME]: [node('Documents', HOME), node('Projects', HOME)],
  [PROJECTS]: [node('test-project', PROJECTS), node('notes', PROJECTS)],
  [PROJECT]: [node('src', PROJECT), node('docs', PROJECT)],
  [`${PROJECT}/src`]: [],
  [`${PROJECT}/docs`]: []
};

function session(id: string, title: string, updated = T0) {
  return {
    id,
    projectID: 'global',
    slug: title.toLowerCase().replace(/\s+/g, '-'),
    directory: HOME,
    title,
    version: '1.0.0',
    cost: 0.01,
    tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: updated - 60_000, updated }
  };
}

async function mockBackend(page: Page, options: MockOptions = {}) {
  const sessions = [session('ses_one', 'Polish the interface'), session('ses_two', 'Add directory picker', T0 - 1_000)];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/global/health') return json({ healthy: true, version: '1.0.0' });
    if (path === '/session/status') return json({});
    if (path === '/path') return json({ home: HOME, directory: HOME, worktree: '/' });
    if (path === '/file') {
      const target = url.searchParams.get('path') ?? HOME;
      return json(tree[target] ?? []);
    }
    if (path === '/find/file') return json([]);
    if (path === '/agent') return json([{ name: 'build', mode: 'primary', native: true, description: 'Default agent' }]);
    if (path === '/command') return json([]);
    if (path === '/config') return json({});
    if (path === '/project') {
      return json([
        {
          id: 'p1',
          worktree: `${PROJECTS}/test-project`,
          sandboxes: [`${HOME}/workers/other-worker`],
          time: { created: T0, updated: T0 }
        }
      ]);
    }
    if (path === '/provider') return json({ all: [] });
    if (path === '/permission' || path === '/question') return json([]);
    if (path === '/event') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': connected\n\n' });
    }
    if (path === '/session' && request.method() === 'GET') return json(sessions);
    if (path === '/session' && request.method() === 'POST') {
      options.onSession?.(url);
      const created = { ...session('ses_new', 'New session'), directory: url.searchParams.get('directory') ?? HOME };
      return json(created);
    }
    if (/^\/session\/[^/]+\/message$/.test(path)) {
      return json([
        {
          info: {
            id: 'msg_user',
            sessionID: 'ses_one',
            role: 'user',
            time: { created: Date.now() - 50_000 },
            modelID: 'test/model',
            agent: 'build'
          },
          parts: [{ id: 'part_user', sessionID: 'ses_one', messageID: 'msg_user', type: 'text', text: 'Make the options comfortable.' }]
        },
        {
          info: {
            id: 'msg_assistant',
            sessionID: 'ses_one',
            role: 'assistant',
            time: { created: Date.now() - 40_000, completed: Date.now() - 30_000 },
            modelID: 'test/model',
            agent: 'build',
            cost: 0.001,
            tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } }
          },
          parts: [
            { id: 'part_assistant', sessionID: 'ses_one', messageID: 'msg_assistant', type: 'text', text: 'The controls are now larger and easier to reach.' }
          ]
        }
      ]);
    }
    if (/^\/session\/[^/]+\/(todo|diff)$/.test(path)) return json([]);
    if (/^\/session\/[^/]+$/.test(path) && request.method() === 'GET') {
      return json(sessions.find((item) => path.endsWith(item.id)) ?? sessions[0]);
    }
    return route.continue();
  });
}

async function seed(page: Page, baseURL: string) {
  await page.addInitScript(({ url }) => {
    localStorage.setItem(
      'opencode-tether.store.v1',
      JSON.stringify({
        settings: {
          remotes: [{ id: 'test', name: 'Test host', url, kind: 'remote', createdAt: Date.now(), lastUsedAt: Date.now() }],
          defaultRemoteId: 'test',
          lastRemoteId: 'test',
          theme: 'dark',
          showReasoning: false,
          showToolDetails: false,
          showTimestamps: false,
          sendKey: 'enter',
          notifications: false,
          autoReconnect: false,
          autoScroll: true,
          compact: false,
          haptics: false,
          favorites: [],
          lastAgent: 'build',
          lastModel: null,
          lastDirectory: {}
        },
        'lastSession:test': 'ses_one'
      })
    );
  }, { url: baseURL });
}

async function open(page: Page, baseURL: string, options: MockOptions = {}) {
  await mockBackend(page, options);
  await seed(page, baseURL);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Polish the interface' })).toBeVisible();
}

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
