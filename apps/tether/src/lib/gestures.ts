export interface SwipeOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  minDistance?: number;
  maxDuration?: number;
  ignore?: string;
}

const DEFAULT_IGNORE = 'pre, textarea, input, select, .xterm, [data-no-swipe]';

export function swipe(node: HTMLElement, initial: SwipeOptions = {}) {
  let options = initial;
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let tracking = false;

  function onStart(event: TouchEvent) {
    if (event.touches.length !== 1) {
      tracking = false;
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(options.ignore ?? DEFAULT_IGNORE)) {
      tracking = false;
      return;
    }
    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    startTime = Date.now();
    tracking = true;
  }

  function onEnd(event: TouchEvent) {
    if (!tracking) return;
    tracking = false;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    const minDistance = options.minDistance ?? 72;
    const maxDuration = options.maxDuration ?? 700;
    if (Math.abs(dx) < minDistance || Math.abs(dx) < Math.abs(dy) * 1.6) return;
    if (Date.now() - startTime > maxDuration) return;
    if (dx < 0) options.onSwipeLeft?.();
    else options.onSwipeRight?.();
  }

  function onCancel() {
    tracking = false;
  }

  node.addEventListener('touchstart', onStart, { passive: true });
  node.addEventListener('touchend', onEnd, { passive: true });
  node.addEventListener('touchcancel', onCancel, { passive: true });

  return {
    update(next: SwipeOptions) {
      options = next;
    },
    destroy() {
      node.removeEventListener('touchstart', onStart);
      node.removeEventListener('touchend', onEnd);
      node.removeEventListener('touchcancel', onCancel);
    }
  };
}
