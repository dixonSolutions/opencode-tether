import { expect, type Page } from '@playwright/test';

const HOME = '/home/test';
const T0 = 1_700_000_000_000;
const PROJECTS = `${HOME}/Projects`;
const PROJECT = `${PROJECTS}/test-project`;

export interface MockOptions {
  onSession?: (url: URL) => void;
  permissions?: unknown[];
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

export async function mockBackend(page: Page, options: MockOptions = {}) {
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
    if (path === '/permission') return json(options.permissions ?? []);
    if (path === '/question') return json([]);
    if (path === '/event' || path === '/global/event') {
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

export async function seed(page: Page, baseURL: string) {
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

export async function open(page: Page, baseURL: string, options: MockOptions = {}) {
  await mockBackend(page, options);
  await seed(page, baseURL);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Polish the interface' })).toBeVisible();
}

