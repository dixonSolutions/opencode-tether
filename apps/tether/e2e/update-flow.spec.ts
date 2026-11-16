import { expect, test, type Page } from '@playwright/test';
import { mockBackend, open, seed } from './helpers';

const RELEASE_API = 'https://api.github.com/repos/dixonSolutions/opencode-tether/releases/latest';

async function openUpdates(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Updates', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check', exact: true })).toBeVisible();
}

async function mockRelease(page: Page, tag: string) {
  await page.route(RELEASE_API, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tag_name: tag,
        name: tag,
        body: 'Mock release notes',
        html_url: 'https://github.com/dixonSolutions/opencode-tether/releases/tag/mock',
        assets: []
      })
    })
  );
}

test('shows the update banner for a newer release', async ({ page, baseURL }) => {
  await open(page, baseURL!);
  await mockRelease(page, 'v0.3.1');
  await openUpdates(page);

  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByText('Version 0.3.1 is available')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeVisible();
});

test('treats a main prerelease as older than the stable app version', async ({ page, baseURL }) => {
  await open(page, baseURL!);
  await mockRelease(page, 'v0.3.0-main.9');
  await openUpdates(page);

  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByText('You are on the latest version.')).toBeVisible();
  await expect(page.getByText(/Version .* is available/)).toHaveCount(0);
});

test('rejects an invalid release version', async ({ page, baseURL }) => {
  await open(page, baseURL!);
  await mockRelease(page, 'release-next');
  await openUpdates(page);

  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByText('GitHub returned an invalid release version.')).toBeVisible();
  await expect(page.getByText(/Version .* is available/)).toHaveCount(0);
});

test('compares with the host version in host mode', async ({ page, baseURL }) => {
  await mockBackend(page);
  await seed(page, baseURL!);
  await page.addInitScript(() => {
    const installMarker = () => {
      if (!document.head || document.querySelector('meta[name="opencode-tether-host"]')) return;
      const marker = document.createElement('meta');
      marker.name = 'opencode-tether-host';
      document.head.append(marker);
    };
    installMarker();
    const observer = new MutationObserver(installMarker);
    observer.observe(document, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 2_000);
  });
  let infoCalls = 0;
  await page.route('**/api/tether/info', (route) => {
    infoCalls++;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        name: 'opencode-tether',
        version: '0.3.2',
        mode: 'host',
        requiresAuth: false,
        upstream: { healthy: true, version: '1.0.0' }
      })
    });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Polish the interface' })).toBeVisible();
  await expect.poll(() => infoCalls).toBe(1);
  await mockRelease(page, 'v0.3.1');
  await openUpdates(page);

  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByText('You are on the latest version.')).toBeVisible();
  await expect(page.getByText(/Version .* is available/)).toHaveCount(0);
});
