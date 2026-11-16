import { expect, test } from '@playwright/test';
import { open } from './helpers';

test('closing while PTY creation is pending disposes the late PTY', async ({ page, baseURL }) => {
  let resolvePtyStarted!: () => void;
  const ptyStarted = new Promise<void>((resolve) => (resolvePtyStarted = resolve));
  const deleted: string[] = [];
  const directories: string[] = [];

  await open(page, baseURL!);
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/pty' && request.method() === 'POST') {
      directories.push(`${request.method()}:${url.searchParams.get('directory')}`);
      resolvePtyStarted();
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'pty-late' }) });
      return;
    }
    if (url.pathname === '/pty/pty-late' && request.method() === 'DELETE') {
      directories.push(`${request.method()}:${url.searchParams.get('directory')}`);
      deleted.push('pty-late');
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await route.fallback();
  });

  await page.locator('header').getByRole('button', { name: 'Session actions' }).click();
  await page.getByRole('menuitem', { name: 'Terminal' }).click();
  await ptyStarted;
  await page.getByRole('button', { name: 'Close terminal' }).click();
  await expect(page.locator('[data-slot="sheet-content"]')).toHaveCount(0);
  await expect.poll(() => deleted).toEqual(['pty-late']);
  expect(directories).toEqual(['POST:/home/test', 'DELETE:/home/test']);
});

test('PTY startup errors remain visible without an automatic retry loop', async ({ page, baseURL }) => {
  let ptyCreates = 0;
  await open(page, baseURL!);
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/pty' && request.method() === 'POST') {
      ptyCreates += 1;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'pty unavailable' }) });
      return;
    }
    await route.fallback();
  });

  await page.locator('header').getByRole('button', { name: 'Session actions' }).click();
  await page.getByRole('menuitem', { name: 'Terminal' }).click();
  await expect(page.getByText('pty unavailable')).toBeVisible();
  await page.waitForTimeout(600);
  expect(ptyCreates).toBe(1);
});

test('terminal authentication rejection stops reconnect attempts promptly', async ({ page, baseURL }) => {
  let tokenRequests = 0;
  await open(page, baseURL!);
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/pty' && request.method() === 'POST') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'pty-auth' }) });
      return;
    }
    if (url.pathname === '/pty/pty-auth/connect-token' && request.method() === 'POST') {
      tokenRequests += 1;
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'unauthorized' }) });
      return;
    }
    await route.fallback();
  });

  await page.locator('header').getByRole('button', { name: 'Session actions' }).click();
  await page.getByRole('menuitem', { name: 'Terminal' }).click();
  await expect(page.getByText(/Terminal authentication was rejected/)).toBeVisible();
  await page.waitForTimeout(600);
  expect(tokenRequests).toBe(1);
  await expect(page.getByRole('button', { name: 'retry connection' })).toBeVisible();
});

test('unexpected terminal disconnect resumes the same PTY from its output cursor', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  let ptyCreates = 0;
  let connects = 0;
  let tickets = 0;
  const connectUrls: string[] = [];
  const ptyDirectories: string[] = [];
  await open(page, baseURL!);
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.startsWith('/pty')) ptyDirectories.push(`${request.method()}:${url.searchParams.get('directory')}`);
    if (url.pathname === '/pty' && request.method() === 'POST') {
      ptyCreates += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'pty-stable' }) });
      return;
    }
    if (/^\/pty\/[^/]+\/connect-token$/.test(url.pathname)) {
      tickets += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ticket: `test-ticket-${tickets}` }) });
      return;
    }
    if (request.method() === 'DELETE' && /^\/pty\//.test(url.pathname)) {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    if (request.method() === 'PUT' && /^\/pty\//.test(url.pathname)) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'pty-stable' }) });
      return;
    }
    await route.fallback();
  });
  await page.routeWebSocket(/\/pty\/[^/]+\/connect/, (socket) => {
    connects += 1;
    connectUrls.push(socket.url());
    if (connects === 1) {
      socket.send('hé🙂');
      socket.send('\0{"cursor":4}');
      void socket.close({ code: 1000, reason: 'test disconnect' });
    } else if (connects === 2) {
      socket.send('世界');
      socket.send('\0{"cursor":6}');
    } else {
      socket.send('\0{"cursor":6}');
    }
  });

  await page.locator('header').getByRole('button', { name: 'Session actions' }).click();
  await page.getByRole('menuitem', { name: 'Terminal' }).click();
  await expect(page.getByRole('status')).toContainText('retry 1/6');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await expect.poll(() => connects).toBe(2);
  await expect.poll(() => ptyCreates).toBe(1);
  await expect.poll(() => tickets).toBe(2);
  const first = new URL(connectUrls[0]);
  const second = new URL(connectUrls[1]);
  expect(second.pathname).toBe(first.pathname);
  expect(second.pathname).toBe('/pty/pty-stable/connect');
  expect(first.searchParams.get('directory')).toBe('/home/test');
  expect(second.searchParams.get('directory')).toBe('/home/test');
  expect(second.searchParams.get('cursor')).toBe('4');
  expect(second.searchParams.get('ticket')).toBe('test-ticket-2');
  expect(ptyDirectories.every((entry) => entry.endsWith(':/home/test'))).toBe(true);
  await expect(page.getByRole('status')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => connects).toBe(3);
  expect(ptyCreates).toBe(1);
  expect(new URL(connectUrls[2]).searchParams.get('cursor')).toBe('6');
  await page.getByRole('button', { name: 'Close terminal' }).click();
});

test('a PTY removed by a host restart stops reconnecting and reports that the shell is gone', async ({ page, baseURL }) => {
  let ptyCreates = 0;
  let tokenRequests = 0;
  let connects = 0;
  await open(page, baseURL!);
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/pty' && request.method() === 'POST') {
      ptyCreates += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'pty-gone' }) });
      return;
    }
    if (url.pathname === '/pty/pty-gone/connect-token' && request.method() === 'POST') {
      tokenRequests += 1;
      if (tokenRequests === 1) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ticket: 'ticket-first' }) });
      } else {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'PTY not found' }) });
      }
      return;
    }
    if (url.pathname === '/pty/pty-gone' && request.method() === 'GET') {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'PTY not found' }) });
      return;
    }
    if (url.pathname === '/pty/pty-gone' && request.method() === 'PUT') {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'PTY not found' }) });
      return;
    }
    await route.fallback();
  });
  await page.routeWebSocket(/\/pty\/pty-gone\/connect/, (socket) => {
    connects += 1;
    socket.send('\0{"cursor":0}');
    void socket.close({ code: 1000, reason: 'host restarted' });
  });

  await page.locator('header').getByRole('button', { name: 'Session actions' }).click();
  await page.getByRole('menuitem', { name: 'Terminal' }).click();
  await expect(page.getByText(/no longer available/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'start new shell' })).toBeVisible();
  await page.waitForTimeout(700);
  expect(ptyCreates).toBe(1);
  expect(tokenRequests).toBe(2);
  expect(connects).toBe(1);
});
