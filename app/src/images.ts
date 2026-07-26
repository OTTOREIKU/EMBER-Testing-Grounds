import { assetUrl, cardImageUrl } from './data';

const cache = new Map<string, HTMLImageElement>();
const warmed = new Set<string>();
let warmState: { total: number; done: number; running: boolean } = { total: 0, done: 0, running: false };

export function warmProgress(): { total: number; done: number; running: boolean } {
  return { ...warmState };
}

// Pull every image in assets/ into the browser cache. The manifest is generated from the assets
// folder itself, so a new folder cannot be missed. Kept at a low concurrency with low fetch
// priority so it never competes with whatever the user is actually looking at.
export async function warmAllImages(concurrency = 6): Promise<void> {
  if (warmState.running) return;
  warmState.running = true;
  let list: string[] = [];
  try {
    const r = await fetch(assetUrl('manifest.json'));
    if (r.ok) list = ((await r.json()) as { images?: string[] }).images ?? [];
  } catch {
    list = [];
  }
  list = list.filter((p) => !warmed.has(p) && p !== 'manifest.json');
  warmState = { total: list.length, done: 0, running: true };
  if (!list.length) {
    warmState.running = false;
    return;
  }

  const queue = list.slice();
  const one = (): Promise<void> =>
    new Promise((resolve) => {
      const p = queue.shift();
      if (!p) return resolve();
      warmed.add(p);
      const img = new Image();
      (img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = 'low';
      img.decoding = 'async';
      const done = () => {
        warmState.done++;
        resolve();
      };
      img.onload = done;
      img.onerror = done;
      img.src = assetUrl(p);
    });
  const worker = async (): Promise<void> => {
    while (queue.length) await one();
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  warmState.running = false;
}

interface NetInfo {
  saveData?: boolean;
  effectiveType?: string;
}

// Bulk-warming pulls roughly 33 MB. That is free on a desktop and rude on a metered phone, and the
// reference sheet is built for exactly that phone. Skip it when the browser says the connection is
// metered or slow; images then load on demand as before. Browsers without the Network Information
// API report nothing, so they warm, which keeps desktop Safari and Firefox behaving as intended.
export function warmDecision(): { warm: boolean; reason: string } {
  const net = (navigator as Navigator & { connection?: NetInfo }).connection;
  if (!net) return { warm: true, reason: 'connection unknown, warming' };
  if (net.saveData) return { warm: false, reason: 'data saver is on' };
  if (net.effectiveType && /^(slow-2g|2g|3g)$/.test(net.effectiveType)) {
    return { warm: false, reason: `connection reports ${net.effectiveType}` };
  }
  return { warm: true, reason: `connection reports ${net.effectiveType ?? 'fast'}` };
}

// Wait until the page has settled, then start warming in the background.
export function warmAllImagesWhenIdle(): void {
  const decision = warmDecision();
  if (!decision.warm) {
    warmState = { total: 0, done: 0, running: false };
    return;
  }
  const start = () => {
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
    if (idle) idle(() => void warmAllImages());
    else setTimeout(() => void warmAllImages(), 400);
  };
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}

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
  if (!warmDecision().warm) return;
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
