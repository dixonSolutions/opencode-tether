interface ParsedVersion {
  core: [string, string, string];
  prerelease: string[] | null;
}

function parseVersion(input: string): ParsedVersion | null {
  const version = input.startsWith('v') ? input.slice(1) : input;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(version);
  if (!match) return null;

  const prerelease = match[4]?.split('.') ?? null;
  if (prerelease?.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) return null;
  return { core: [match[1], match[2], match[3]], prerelease };
}

function compareNumericStrings(a: string, b: string): number {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

function comparePrerelease(a: string[] | null, b: string[] | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined || b[i] === undefined) return a[i] === b[i] ? 0 : a[i] === undefined ? -1 : 1;
    const aNumeric = /^\d+$/.test(a[i]);
    const bNumeric = /^\d+$/.test(b[i]);
    if (aNumeric && bNumeric) {
      const result = compareNumericStrings(a[i], b[i]);
      if (result !== 0) return result;
    } else if (aNumeric !== bNumeric) {
      return aNumeric ? -1 : 1;
    } else if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1;
    }
  }
  return 0;
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const parsedA = parseVersion(a);
  const parsedB = parseVersion(b);
  if (!parsedA || !parsedB) return null;

  for (let i = 0; i < 3; i++) {
    const result = compareNumericStrings(parsedA.core[i], parsedB.core[i]);
    if (result !== 0) return result as -1 | 1;
  }
  return comparePrerelease(parsedA.prerelease, parsedB.prerelease) as -1 | 0 | 1;
}
