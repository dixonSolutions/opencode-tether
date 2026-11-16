// Picks a download from a GitHub release's asset list. The Updates tab of every installed
// version runs a copy of this logic against `releases/latest`, so what is attached to a version
// release matters for clients already in users' hands: see release-assets.unit.ts.

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size?: number;
}

export type AssetKind = 'apk' | 'flatpak' | 'deb' | 'rpm' | 'appimage';

export function assetFor(assets: ReleaseAsset[], kind: AssetKind): string | null {
  const match = assets.find(
    (asset) => asset.name.toLowerCase().endsWith(`.${kind}`) || (kind === 'flatpak' && asset.name.toLowerCase().endsWith('.flatpak'))
  );
  return match?.browser_download_url ?? null;
}
