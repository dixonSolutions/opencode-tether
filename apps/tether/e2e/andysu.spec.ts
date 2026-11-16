import { test, expect } from '@playwright/test';
import { open } from './helpers';

test('host Updates replaces APK updater, reflects states, and exposes only valid actions', async ({ page, baseURL }) => {
  await page.addInitScript(() => {
    const bridge = {
      onmessage: null as ((event: { data: string }) => void) | null,
      postMessage(raw: string) {
        const action = JSON.parse(raw).action;
        if (action === 'init') this.onmessage?.({ data: JSON.stringify({ type: 'init', mode: 'auto', status: { state: 'idle', runningVersion: '0.3.9' } }) });
      }
    };
    (window as unknown as { AndySU: typeof bridge }).AndySU = bridge;
  });
  await open(page, baseURL!);
  await page.keyboard.press('Control+,');
  await page.getByRole('tab', { name: 'Updates', exact: true }).click();
  await expect(page.getByTestId('running-version')).toHaveText('v0.3.9');
  await expect(page.getByText('Android updates are manual')).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'Update automatically' })).toBeChecked();
  for (const [state, text] of [['checking', 'Checking'], ['downloading', 'Downloading'], ['staged', 'applying automatically'], ['applying', 'Applying update'], ['up_to_date', 'Up to date'], ['error', 'Couldn’t check'], ['deferred', 'postponed'], ['shell_update', 'new app install']]) {
    await page.evaluate(state => {
      const bridge = (window as unknown as { AndySU: { onmessage: (e: { data: string }) => void } }).AndySU;
      bridge.onmessage({ data: JSON.stringify({ type: 'status', status: { state, release: '0.4.0', runningVersion: '0.3.9' } }) });
    }, state);
    await expect(page.getByTestId('update-status')).toContainText(text);
    await expect(page.getByRole('button', { name: 'Apply now', exact: true })).toHaveCount(state === 'staged' ? 1 : 0);
    await expect(page.getByRole('button', { name: 'Install', exact: true })).toHaveCount(state === 'shell_update' ? 1 : 0);
  }
});
