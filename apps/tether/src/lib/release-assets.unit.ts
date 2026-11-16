// Installed clients (v0.3.0 and earlier) run the Updates tab's own asset picking against
// `releases/latest` and download the first asset whose name ends in `.apk`. A live AndySU host
// APK must therefore never be attached to a version release. These tests pin that down against a
// verbatim copy of the old picker, and against the release workflow that decides what is attached.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { assetFor, type ReleaseAsset } from './release-assets';

// Verbatim from v0.3.0 UpdatePanel.svelte (assetFor), the code already in users' hands.
function legacyAssetFor(release: { assets: ReleaseAsset[] }, kind: 'apk' | 'flatpak' | 'deb' | 'rpm' | 'appimage'): string | null {
  const match = release.assets.find((asset) => asset.name.toLowerCase().endsWith(`.${kind}`) || (kind === 'flatpak' && asset.name.toLowerCase().endsWith('.flatpak')));
  return match?.browser_download_url ?? null;
}

const workflow = readFileSync('../../.github/workflows/release.yml', 'utf8');
const live = workflow.slice(workflow.indexOf('\n  andysu-live:'));
const version = '0.3.0';
const asset = (name: string): ReleaseAsset => ({ name, browser_download_url: `https://github.com/dixonSolutions/opencode-tether/releases/download/v${version}/${name}` });

// What the existing release job attaches to a version release (the names its steps produce).
const versionRelease = [
  `opencode-tether-${version}-android-universal.apk`,
  `ai.opencode.tether-${version}.flatpak`,
  `opencode-tether_${version}_amd64.deb`,
  `opencode-tether-${version}-1.x86_64.rpm`,
  `opencode-tether-${version}-desktop-x86_64`,
  'opencode-tether-x86_64-unknown-linux-musl',
  'SHA256SUMS'
].map(asset);

// The live host APK's name as the workflow gives it.
const liveName = /LIVE_APK=([^\s"]+)/.exec(live)?.[1] ?? '';

test('the extracted picker behaves exactly like the old one', () => {
  for (const kind of ['apk', 'flatpak', 'deb', 'rpm', 'appimage'] as const) {
    expect(assetFor(versionRelease, kind)).toBe(legacyAssetFor({ assets: versionRelease }, kind));
  }
});

test('the old picker takes the plain APK from a version release', () => {
  expect(legacyAssetFor({ assets: versionRelease }, 'apk')).toContain(`opencode-tether-${version}-android-universal.apk`);
});

test('the live APK is named, and it would fool the old picker if it were on a version release', () => {
  expect(liveName).toMatch(/\.apk$/);
  // Why it must not be there: whatever its position, the old picker can select it.
  const first = [asset(liveName), ...versionRelease];
  expect(legacyAssetFor({ assets: first }, 'apk')).toContain(liveName);
});

test('the release workflow never attaches the live APK to a version release', () => {
  expect(live.length).toBeGreaterThan(100);
  // The only upload target in the live job is the channel's own release.
  const uploads = [...live.matchAll(/gh release upload (\S+)/g)].map((m) => m[1]);
  expect(uploads.length).toBeGreaterThan(0);
  for (const target of uploads) expect(target).toBe('channel-live-arm64');
  // No step in the live job publishes through the version-release action or names the version tag.
  expect(live).not.toContain('softprops/action-gh-release');
  for (const m of live.matchAll(/gh release (upload|create|edit|delete) (\S+)/g)) expect(m[2]).toBe('channel-live-arm64');
  // And the version release's own file list is built from the other jobs' artifacts only.
  const release = workflow.slice(workflow.indexOf('\n  release:'), workflow.indexOf('\n  # AndySU:'));
  expect(release).not.toMatch(/andysu|host\.apk|channel-live|live-arm64/i);
});

test('nothing the existing release waits for depends on the live job', () => {
  const needs = /\n  release:[\s\S]*?needs: (\[[^\]]*\])/.exec(workflow)?.[1] ?? '';
  expect(needs).not.toContain('andysu');
  const others = workflow.slice(0, workflow.indexOf('\n  andysu-live:'));
  expect(others).not.toContain('andysu-live');
});

test('the channel release is a prerelease, so releases/latest (all old clients read) never returns it', () => {
  expect(live).toContain('--prerelease --latest=false');
});
