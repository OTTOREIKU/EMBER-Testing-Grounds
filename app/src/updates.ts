import './updates.css';

declare const __BUILD_ID__: string;

const POLL_MS = 5 * 60 * 1000;
const DISMISS_KEY = 'ember-update-dismissed';

function versionUrl(): string {
  return new URL('version.json', document.baseURI).href;
}

async function liveBuild(): Promise<string | null> {
  try {
    const r = await fetch(`${versionUrl()}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = (await r.json()) as { build?: string };
    return j.build ?? null;
  } catch {
    return null;
  }
}

// A plain location.reload() is enough for code and data, which the Service
// Worker serves network-first, and the build hashes every script and stylesheet
// anyway. It is not enough for images: those are served cache-first from a
// cache the Worker never clears, and their filenames are stable, so a redrawn
// card keeps its old picture until the caches go. Taking the update clears them
// and refreshes the Worker, which is what a hard refresh did by hand.
//
// This does mean dropping the warmed image cache, which is the bulk of what is
// stored. It refills on its own at idle, and skips refilling on a metered or
// slow connection, so the cost lands on a deliberate update rather than on
// every visit.
async function hardReload(): Promise<void> {
  try {
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch (err) {
    void err;
  }
  location.reload();
}

function show(build: string): void {
  if (document.getElementById('update-toast')) return;
  if (localStorage.getItem(DISMISS_KEY) === build) return;

  const infoBox = document.getElementById('inspect-box');
  const box = document.createElement('div');
  box.id = 'update-toast';
  box.setAttribute('role', 'status');
  box.innerHTML = `
    <div class="ut-bar"></div>
    <div class="ut-body">
      <b>New version available</b>
      <p>The tool has been updated since you opened this page. Reload to pick up the changes.${infoBox ? ' Your board is saved, so nothing is lost.' : ''}</p>
      <div class="ut-actions">
        <button class="ut-reload">Reload now</button>
        <button class="ut-later">Later</button>
      </div>
    </div>`;
  box.querySelector('.ut-reload')!.addEventListener('click', () => void hardReload());
  box.querySelector('.ut-later')!.addEventListener('click', () => {
    localStorage.setItem(DISMISS_KEY, build);
    box.remove();
  });

  if (infoBox?.parentElement) {
    infoBox.parentElement.insertBefore(box, infoBox);
  } else {
    box.classList.add('ut-floating');
    document.body.appendChild(box);
  }
}

export function watchForUpdates(): void {
  const mine = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : null;
  if (!mine) return;
  const check = async () => {
    const live = await liveBuild();
    if (live && live !== mine) show(live);
  };
  window.setTimeout(() => void check(), 30_000);
  window.setInterval(() => void check(), POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void check();
  });
}
