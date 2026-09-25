import './updates.css';
import { BASE } from './data';

declare const __BUILD_ID__: string;

const POLL_MS = 5 * 60 * 1000;
const DISMISS_KEY = 'ember-update-dismissed';

// THE "NEW VERSION" NOTICE, one component for every page (redone 2026-09-24
// after an audit: the landing and the Match Centre never showed it, the board
// showed it mid-multiplayer-game, and the pad's survived into a table). Each
// page says only WHERE it sits and WHEN it may show; this file finds the newer
// build, draws the notice, and keeps it placed. Placements, as OTTO chose them:
//   landing       the status line's right end becomes NEW VERSION · RELOAD
//   reference     bottom-left card; full width across the bottom on a phone
//   pad           a card in the column under EMBER PAD, screens before a table
//   tabletop      above the left rail's inspector, never in a multiplayer room
//   match centre  top of the lobby column, never once a room is joined
export interface UpdateOptions {
  // May the notice show right now. Checked on every sync, so a notice already
  // up is taken away the moment this turns false (a table opens, a room joins).
  when?: () => boolean;
  // Put the notice where it belongs. Absent: a floating card. If it leaves the
  // notice outside the document (the spot does not exist on this screen), the
  // notice simply is not shown until a later sync finds the spot.
  place?: (notice: HTMLElement) => void;
  // The one-line status-line form (the landing page): no text, no Later.
  compact?: boolean;
  // A class for the page's own spacing around an in-flow notice.
  className?: string;
  // One more sentence after the message ("Your board is saved.").
  note?: string;
}

let options: UpdateOptions = {};
// The newer build found and not yet dismissed.
let pending: string | null = null;

// From the site root, not beside the page: the pad lives in /pad/ and has no
// version.json of its own.
function versionUrl(): string {
  return new URL(`${BASE}version.json`, document.baseURI).href;
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

function dismissed(build: string): boolean {
  try { return localStorage.getItem(DISMISS_KEY) === build; } catch { return false; }
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

function buildNotice(): HTMLElement {
  if (options.compact) {
    const b = document.createElement('button');
    b.id = 'update-notice';
    b.className = 'upd-status';
    b.type = 'button';
    b.innerHTML = 'NEW VERSION · RELOAD <i aria-hidden="true">›</i>';
    b.addEventListener('click', () => void hardReload());
    return b;
  }
  const box = document.createElement('div');
  box.id = 'update-notice';
  box.className = `upd ${options.place ? 'inline' : 'float'}${options.className ? ` ${options.className}` : ''}`;
  box.setAttribute('role', 'status');
  box.innerHTML = `
    <div class="upd-k">NEW VERSION</div>
    <p>The site was updated since this page opened.${options.note ? ` ${options.note}` : ''}</p>
    <div class="upd-actions">
      <button type="button" class="upd-go">Reload</button>
      <button type="button" class="upd-later">Later</button>
    </div>`;
  box.querySelector('.upd-go')!.addEventListener('click', () => void hardReload());
  box.querySelector('.upd-later')!.addEventListener('click', () => {
    if (pending) {
      try { localStorage.setItem(DISMISS_KEY, pending); } catch { /* the notice still goes */ }
    }
    pending = null;
    syncUpdateNotice();
  });
  return box;
}

// Show, place, or take away the notice to match the moment. Pages that redraw
// their screen wholesale (the pad, the Match Centre) or change what is allowed
// (a room joined) call this after they do; it is cheap when nothing changed.
export function syncUpdateNotice(): void {
  const current = document.getElementById('update-notice');
  const allowed = !!pending && (options.when?.() ?? true);
  if (!allowed) {
    current?.remove();
    return;
  }
  if (current) return;
  const notice = buildNotice();
  if (options.place) options.place(notice);
  else document.body.appendChild(notice);
}

// One check, now. The pad calls it on the way out of a game, so a build that
// landed mid-game is offered the moment the sheet is put down.
export async function checkForUpdates(): Promise<void> {
  const mine = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : null;
  if (!mine) return;
  const live = await liveBuild();
  if (live && live !== mine && !dismissed(live)) pending = live;
  syncUpdateNotice();
}

export function watchForUpdates(opts: UpdateOptions = {}): void {
  const mine = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : null;
  if (!mine) return;
  options = opts;
  const check = () => checkForUpdates();
  window.setTimeout(() => void check(), 30_000);
  window.setInterval(() => void check(), POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void check();
  });
}
