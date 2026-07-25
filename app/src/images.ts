import { cardImageUrl } from './data';

const cache = new Map<string, HTMLImageElement>();

export function loadCardImage(id: string): HTMLImageElement {
  let img = cache.get(id);
  if (!img) {
    img = new Image();
    img.src = cardImageUrl(id);
    cache.set(id, img);
  }
  return img;
}

export function isCardImageReady(id: string): boolean {
  const img = cache.get(id);
  return !!img && img.complete && img.naturalWidth > 0;
}

export function mountCardImage(slot: HTMLElement, id: string, className: string): void {
  const img = loadCardImage(id);
  img.className = className;
  img.alt = '';
  img.onerror = () => img.remove();
  slot.replaceChildren(img);
}

export function preloadCardImages(ids: string[]): void {
  const queue = ids.slice();
  const schedule =
    (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback ??
    ((cb: () => void) => setTimeout(cb, 60));
  const step = () => {
    for (let i = 0; i < 12 && queue.length; i++) loadCardImage(queue.shift()!);
    if (queue.length) schedule(step);
  };
  schedule(step);
}
