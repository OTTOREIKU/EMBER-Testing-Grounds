import './preload.css';
import { cancelWarm, warmAllImages, warmDecision } from './images';

// One record for the whole site, so the download is offered once rather than
// once per page. `done` records whether it finished or was skipped; either way
// the screen is not shown again, and the idle warm still tops up in the
// background on later visits.
const KEY = 'ember-preload';

interface Record {
  done: boolean;
  count: number;
  at: number;
}

function read(): Record | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as Partial<Record>;
    return typeof r.count === 'number' ? { done: !!r.done, count: r.count, at: r.at ?? 0 } : null;
  } catch {
    return null;
  }
}

function write(r: Record): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    // A private window with no storage is not a reason to fail the download.
  }
}

const mb = (bytes: number): string => `${(bytes / 1_048_576).toFixed(1)} MB`;

// Downloads every image the manifest lists, behind a progress screen, the first
// time anyone opens the site. The app boots underneath, so Skip is instant and
// nothing is broken by leaving early.
export async function runFirstVisitPreload(): Promise<void> {
  if (read()) return;
  // A metered or slow connection gets no blocking screen at all; the idle warm
  // already declines on the same test.
  if (!warmDecision().warm) return;

  const back = document.createElement('div');
  back.className = 'pl-back';
  back.innerHTML = `<div class="pl-panel" role="dialog" aria-modal="true" aria-live="polite">
    <h2 class="pl-title">Loading the card art</h2>
    <p class="pl-sub">Every card is being downloaded once, so browsing and comparing them is instant
      from here on. This happens on your first visit only.</p>
    <div class="pl-bar"><i></i></div>
    <p class="pl-count">Looking up what there is to fetch…</p>
    <button class="pl-skip">Skip for now</button>
  </div>`;
  const fill = back.querySelector<HTMLElement>('.pl-bar i')!;
  const count = back.querySelector<HTMLElement>('.pl-count')!;
  const skip = back.querySelector<HTMLButtonElement>('.pl-skip')!;
  document.body.appendChild(back);

  let skipped = false;
  const shut = (): void => {
    back.remove();
  };
  skip.addEventListener('click', () => {
    skipped = true;
    cancelWarm();
    shut();
  });

  const result = await warmAllImages(8, (t) => {
    if (skipped || !t.total) return;
    const pct = Math.round((t.done / t.total) * 100);
    fill.style.width = `${pct}%`;
    count.textContent = `${t.done} of ${t.total} · ${mb(t.bytes)}`;
  });

  if (!skipped) shut();
  // Nothing fetched means no manifest was served rather than a finished run, so
  // it is not recorded and the next real visit still gets the screen.
  if (result.total) write({ done: !skipped && result.done >= result.total, count: result.total, at: Date.now() });
}
