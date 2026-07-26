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

function show(build: string): void {
  if (document.getElementById('update-toast')) return;
  if (localStorage.getItem(DISMISS_KEY) === build) return;

  const box = document.createElement('div');
  box.id = 'update-toast';
  box.setAttribute('role', 'status');
  box.innerHTML = `
    <div class="ut-bar"></div>
    <div class="ut-body">
      <b>New version available</b>
      <p>The tool has been updated since you opened this page. Reload to pick up the changes. Your board is saved, so nothing is lost.</p>
      <div class="ut-actions">
        <button class="ut-reload">Reload now</button>
        <button class="ut-later">Later</button>
      </div>
    </div>`;
  box.querySelector('.ut-reload')!.addEventListener('click', () => location.reload());
  box.querySelector('.ut-later')!.addEventListener('click', () => {
    localStorage.setItem(DISMISS_KEY, build);
    box.remove();
  });

  // On the tabletop it slots into the left column directly above the info box, so it pushes the
  // box down rather than covering it. The reference sheet has no such column, so it floats.
  const infoBox = document.getElementById('inspect-box');
  if (infoBox?.parentElement) {
    infoBox.parentElement.insertBefore(box, infoBox);
  } else {
    box.classList.add('ut-floating');
    document.body.appendChild(box);
  }
}

// Poll for a newer deploy. Silent when version.json is missing, which is the case in dev.
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
