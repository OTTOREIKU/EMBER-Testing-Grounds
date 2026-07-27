export interface CacheStats {
  assets: number;
  runtime: number;
}

export function registerOffline(): void {
  if (!('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) return;
  const go = (): void => {
    void navigator.serviceWorker.register(new URL('sw.js', document.baseURI).href).catch(() => {});
  };
  if (document.readyState === 'complete') go();
  else window.addEventListener('load', go, { once: true });
}

export function cacheStats(timeoutMs = 1500): Promise<CacheStats | null> {
  return new Promise((resolve) => {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return resolve(null);
    const timer = setTimeout(() => {
      navigator.serviceWorker.removeEventListener('message', onMsg);
      resolve(null);
    }, timeoutMs);
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; counts?: Record<string, number> };
      if (d?.type !== 'ember-cache-stats') return;
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener('message', onMsg);
      resolve({ assets: d.counts?.['ember-assets-v1'] ?? 0, runtime: d.counts?.['ember-runtime-v1'] ?? 0 });
    };
    navigator.serviceWorker.addEventListener('message', onMsg);
    navigator.serviceWorker.controller.postMessage('ember-cache-stats');
  });
}
