// THE REFERENCE'S CARD SHEET, for a page that is neither the Reference nor the
// pad (OTTO, 2026-11-11: "tie in our card database from the reference ... so
// you can see the most up to date data on the card like we use on the
// reference app. This way we are slowly tying all of the apps together").
//
// The markup is the Reference's #ref-detail, the cards and keywords are drawn
// by refcards.ts and the links behave as refsheet.ts makes them behave, so a
// card read here IS the card on the Reference: the same rules text, keywords,
// changelog and photo. This file only keeps the stack of what is open (Back
// returns from a keyword to the card it was opened from) and mounts the sheet.
// The pad does the same with its own copy of these few lines; it can move onto
// this one when it is next touched. Needs reference.css on the page.
import type { GameData } from './data';
import { fillPortraits, sheetHtml, sheetLabel, useCardData } from './refcards';
import {
  applyChangelogFilter, decorateSheetHead, drawsAdvanced, holdDetailHeight, noteSheetLeft, revealLog,
  runSheetClick, runSheetFocus, runSheetInput, runSheetKey, showDetailTab, type SheetKind, type SheetNav,
} from './refsheet';
import { mountCardImage, mountCardImageCopy } from './images';

type Look = { kind: SheetKind; key: string; tab?: string; scroll?: number; log?: boolean; advanced?: boolean };
let looks: Look[] = [];
let ready = false;

const sheet = (): HTMLElement | null => document.getElementById('ref-detail');
const content = (): HTMLElement | null => document.getElementById('ref-detail-content');
const scroller = (): HTMLElement | null => sheet()?.querySelector<HTMLElement>('.ref-detail-inner') ?? null;

const nav: SheetNav = {
  open: (kind, key, opts) => { open(kind, key, opts); },
  top: () => (sheet()?.hidden === false ? looks[looks.length - 1] : undefined),
  retarget: (key) => {
    const top = looks[looks.length - 1];
    if (!top) return;
    top.key = key;
    const html = sheetHtml(top.kind, top.key, { advanced: drawsAdvanced(top) });
    if (html !== null) paint(html, 0);
  },
};

function mount(): void {
  if (ready) return;
  ready = true;
  const el = document.createElement('div');
  el.id = 'ref-detail';
  el.hidden = true;
  el.innerHTML = `<div class="ref-detail-inner">
      <div class="ref-detail-tools">
        <button id="ref-detail-back" data-sheet="back" title="Back" hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg>
        </button>
        <button id="ref-detail-close" data-sheet="close" title="Close">✕</button>
      </div>
      <div id="ref-detail-content"></div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    if (t === el) return close();
    const own = t.closest<HTMLElement>('[data-sheet]');
    if (own) return own.dataset.sheet === 'back' ? back() : close();
    const dtab = t.closest<HTMLElement>('[data-dtab]');
    if (dtab) {
      ev.preventDefault();
      const top = looks[looks.length - 1];
      if (top) top.tab = dtab.dataset.dtab!;
      const c = content();
      if (c) showDetailTab(c, dtab.dataset.dtab!);
      return;
    }
    runSheetClick(ev, nav);
  });
  el.addEventListener('input', runSheetInput);
  el.addEventListener('focusin', runSheetFocus);
  document.addEventListener('keydown', (ev) => {
    if (sheet()?.hidden !== false) return;
    if (runSheetKey(ev)) return;
    if (ev.key === 'Escape') { ev.stopPropagation(); close(); }
  }, true);
}

function paint(html: string, scrollTop: number): void {
  const s = sheet();
  const c = content();
  if (!s || !c) return;
  c.innerHTML = html;
  decorateSheetHead(c);
  c.querySelectorAll<HTMLElement>('[data-img]').forEach((slot) => {
    const isThumb = !!slot.closest('.dthumb');
    (isThumb ? mountCardImageCopy : mountCardImage)(slot, slot.dataset.img!, isThumb ? 'dthumb-img' : 'ref-cardimg', {
      label: slot.dataset.imgLabel ?? '',
      wide: slot.dataset.imgWide === '1',
    });
  });
  fillPortraits(c, false);
  if (c.querySelector('.cl-list')) applyChangelogFilter(c);
  s.hidden = false;
  const sc = scroller();
  if (sc) sc.scrollTop = scrollTop;
  c.style.removeProperty('--dpanel-h');
  delete c.dataset.panelMax;
  holdDetailHeight(c);
  const b = document.getElementById('ref-detail-back') as HTMLButtonElement | null;
  const prev = looks.length >= 2 ? looks[looks.length - 2] : null;
  if (b) {
    b.hidden = !prev;
    const label = prev ? `Back to ${sheetLabel(prev.kind, prev.key)}` : 'Back';
    b.title = label;
    b.setAttribute('aria-label', label);
  }
}

function open(kind: SheetKind, key: string, opts: { log?: boolean } = {}): boolean {
  const v: Look = { kind, key, ...(opts.log ? { log: true } : {}) };
  const html = sheetHtml(kind, key, { advanced: drawsAdvanced(v) });
  if (html === null) return false;
  const s = sheet();
  if (!s) return false;
  if (s.hidden) looks = [];
  else {
    const top = looks[looks.length - 1];
    if (top && top.kind === kind && top.key === key) return true;
    const under = looks[looks.length - 2];
    if (under && under.kind === kind && under.key === key) { back(); return true; }
    if (top) {
      top.scroll = scroller()?.scrollTop ?? 0;
      noteSheetLeft(top);
    }
  }
  looks.push(v);
  paint(html, 0);
  if (v.log) revealLog();
  return true;
}

function back(): void {
  if (looks.length < 2) return close();
  looks.pop();
  const prev = looks[looks.length - 1];
  const html = sheetHtml(prev.kind, prev.key, { advanced: drawsAdvanced(prev) });
  if (html === null) return close();
  paint(html, prev.scroll ?? 0);
  if (prev.tab) { const c = content(); if (c) showDetailTab(c, prev.tab); }
}

function close(): void {
  const s = sheet();
  if (s) s.hidden = true;
  looks = [];
}

// Called once the page's data has loaded; refcards draws from it.
export function useSheetData(d: GameData): void {
  useCardData(d);
  mount();
}

// Opens a card's sheet, as tapping it on the Reference does. False when the
// card is not in the database (the page then shows its picture instead).
export function openCardSheet(id: string): boolean {
  mount();
  return open('card', id);
}
