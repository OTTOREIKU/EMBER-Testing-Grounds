import { BASE } from './data';

export function registerOffline(): void {
  if (!('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) return;
  const go = (): void => {
    void navigator.serviceWorker.register(new URL(`${BASE}sw.js`, document.baseURI).href).catch(() => {});
  };
  if (document.readyState === 'complete') go();
  else window.addEventListener('load', go, { once: true });
}

