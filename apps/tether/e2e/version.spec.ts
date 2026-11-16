import { expect, test } from '@playwright/test';
import { compareVersions } from '../src/lib/api/version';

test.describe('release version comparison', () => {
  test('orders prereleases before their stable release', () => {
    expect(compareVersions('0.3.0-main.9', '0.3.0')).toBe(-1);
    expect(compareVersions('0.3.0', '0.3.0-main.9')).toBe(1);
  });

  test('compares prerelease identifiers using SemVer precedence', () => {
    expect(compareVersions('1.0.0-alpha.2', '1.0.0-alpha.10')).toBe(-1);
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1);
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBe(-1);
    expect(compareVersions('v1.2.3+build.4', '1.2.3+build.9')).toBe(0);
  });

  test('rejects malformed versions instead of reporting an update', () => {
    expect(compareVersions('release-next', '0.3.0')).toBeNull();
    expect(compareVersions('1.0.0-01', '1.0.0')).toBeNull();
    expect(compareVersions('1.0', '0.9.0')).toBeNull();
  });
});
