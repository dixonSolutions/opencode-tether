/** Preload outside the input/render turn; cancellation prevents work after unmount. */
export function idlePreload(load: () => Promise<unknown>): () => void {
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(() => { void load(); });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(() => { void load(); }, 500);
  return () => clearTimeout(id);
}
