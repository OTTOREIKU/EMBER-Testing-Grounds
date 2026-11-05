// The lore Archive under the Factions tab, and the reader it opens.
//
// The pieces are the community translations of Queti's own lore, built into
// data/lore.json by tools/lore/build_lore.py (story and notes already HTML).
// They read in the page, never as a PDF download (OTTO, 2026-11-05). The
// reader sits at #lore/<slug>, so a piece can be linked and Back closes it.
import './lore.css';
import { assetUrl, dataUrl } from './data';
import { esc } from './refcards';

export interface LorePiece {
  slug: string;
  title: string;
  zh: string;
  shelf: 'featured' | 'world' | 'stories' | 'designers';
  kicker: string;
  hook: string;
  factions: string[];
  words: number;
  html: string;
  notes: string;
  art?: string;
  quote?: string;
  part?: number;
  // The Chronology reads as a timeline, the interview as a conversation.
  layout?: 'timeline' | 'interview';
  eras?: { id: string; label: string; years: string }[];
  // Glossary notes this piece uses: id -> [term, Chinese name, definition].
  gloss?: Record<string, [string, string, string]>;
}

const SHELVES: { key: LorePiece['shelf']; label: string; note?: string }[] = [
  { key: 'world', label: 'The world' },
  { key: 'stories', label: 'Stories', note: 'a two-part story' },
  { key: 'designers', label: 'From the designers' },
];

const FAC_SHORT: Record<string, string> = { RDL: 'RDL', UN: 'UN', GOF: 'GoF' };

const CREDIT =
  'Unofficial fan translation for the EMBER community. EMBER: Obsidian Protocol, its setting and its ' +
  'characters are © Beijing Queti Technology Co., Ltd. This is not an official Queti publication.';

let pieces: LorePiece[] | null = null;
let loading: Promise<void> | null = null;

const artUrl = (name: string) => assetUrl(`lore/${name}.webp`);
const withAssets = (html: string) => html.replaceAll('{ASSETS}', assetUrl(''));

// Loads once; `then` runs whenever the pieces are in, so a render that came
// first can draw the Archive a moment later.
export function loadLore(then?: () => void): void {
  if (!loading) {
    loading = fetch(dataUrl('lore.json'))
      .then((r) => r.json() as Promise<LorePiece[]>)
      .then((list) => {
        pieces = list;
      })
      .catch(() => {
        pieces = [];
      });
  }
  if (then) void loading.then(then);
}

const facTags = (p: LorePiece) =>
  p.factions.map((f) => `<span class="tag lore-fac" data-fac="${esc(f)}">${esc(FAC_SHORT[f] ?? f)}</span>`).join('');

function cover(p: LorePiece): string {
  if (p.art) {
    return `<div class="lore-art${p.art === 'opv-diagram' ? ' is-diagram' : ''}"><img src="${artUrl(p.art)}" alt="" loading="lazy"></div>`;
  }
  return `<div class="lore-quote">${esc(p.quote ?? p.title)}</div>`;
}

function tile(p: LorePiece): string {
  const tags = facTags(p);
  return `<article class="lore-tile" data-lore="${esc(p.slug)}" tabindex="0" role="button" aria-label="Read ${esc(p.title)}">
    ${cover(p)}
    <div class="lore-tbody">
      <div class="lore-kick-row"><span class="lore-kicker">${esc(p.kicker)}</span>${p.part ? `<span class="ui-badge">Part ${p.part}</span>` : ''}</div>
      <div class="lore-ttl">${esc(p.title)}</div>
      <div class="lore-hook">${esc(p.hook)}</div>
      ${tags ? `<div class="lore-tags">${tags}</div>` : ''}
    </div>
  </article>`;
}

function featured(p: LorePiece): string {
  const tags = facTags(p);
  return `<article class="lore-feat" data-lore="${esc(p.slug)}" tabindex="0" role="button" aria-label="Read ${esc(p.title)}">
    <div class="lore-feat-img">${p.art ? `<img src="${artUrl(p.art)}" alt="" loading="lazy">` : ''}</div>
    <div class="lore-feat-txt">
      <div class="lore-kicker">${esc(p.kicker)}</div>
      <div class="lore-feat-ttl">${esc(p.title)}</div>
      <div class="lore-hook">${esc(p.hook)}</div>
      ${tags ? `<div class="lore-tags">${tags}</div>` : ''}
      <span class="lore-btn">Read the ${esc(p.title.replace(/^EMBER World /, '').toLowerCase())} <span class="ui-go" aria-hidden="true">›</span></span>
    </div>
  </article>`;
}

const norm = (s: string) => s.toLowerCase();

function matches(p: LorePiece, q: string): boolean {
  if (!q) return true;
  return norm(`${p.title} ${p.zh} ${p.hook} ${p.kicker}`).includes(q);
}

// The Archive, as it sits under the faction tiles. Empty until the pieces are
// in, and when a search finds none of them.
export function loreArchiveHtml(q = ''): string {
  if (!pieces?.length) return '';
  const shown = pieces.filter((p) => matches(p, norm(q)));
  if (!shown.length) return '';
  const feat = shown.filter((p) => p.shelf === 'featured');
  const shelves = SHELVES.map((s) => {
    const list = shown.filter((p) => p.shelf === s.key);
    if (!list.length) return '';
    return `<p class="ref-count lore-shelf-h">${esc(s.label)}${s.note ? ` <small>· ${esc(s.note)}</small>` : ''}</p>
      <div class="lore-shelf lore-shelf-${s.key}">${list.map(tile).join('')}</div>`;
  }).join('');
  return `<section class="lore-archive">
    <p class="ref-count">Archive <small>· fan translations</small></p>
    ${feat.map(featured).join('')}
    ${shelves}
  </section>`;
}

// ---- the reader ------------------------------------------------------------

let reader: HTMLElement | null = null;
let current: LorePiece | null = null;
let gpop: HTMLElement | null = null;
let gFrom: HTMLElement | null = null;
let pushed = false;
let lockedAt = 0;

function order(): LorePiece[] {
  if (!pieces) return [];
  const rank = (p: LorePiece) => (p.shelf === 'featured' ? 0 : SHELVES.findIndex((s) => s.key === p.shelf) + 1);
  return [...pieces].sort((a, b) => rank(a) - rank(b));
}

function shelfLabel(p: LorePiece): string {
  return p.shelf === 'featured' ? 'Start here' : SHELVES.find((s) => s.key === p.shelf)?.label ?? '';
}

function readerHtml(p: LorePiece): string {
  const list = order();
  const i = list.findIndex((x) => x.slug === p.slug);
  const prev = i > 0 ? list[i - 1] : undefined;
  const next = i >= 0 && i < list.length - 1 ? list[i + 1] : undefined;
  // The tile's picture heads the reader only when the story does not show it
  // further down anyway (SOUP and the interview carry theirs in the text).
  const hero = !!p.art && !p.html.includes(`lore/${p.art}.webp`);
  const head = `<div class="lore-r-ttl">
      <div class="lore-kicker">${esc(p.kicker)}</div>
      <h1>${esc(p.title)}</h1>
      <div class="lore-r-meta">${esc(p.zh)} · fan translation</div>
    </div>`;
  return `<div class="lore-r-top">
      <button class="ui-home lore-r-close" data-lore-close type="button"><b>‹</b> Factions</button>
      <span class="lore-r-crumb">Archive / <b>${esc(shelfLabel(p))}</b></span>
      <span class="lore-r-prog" aria-hidden="true"></span>
    </div>
    ${hero ? `<header class="lore-r-hero"><img src="${artUrl(p.art!)}" alt="">${head}</header>` : `<header class="lore-r-plain">${head}</header>`}
    ${p.eras ? timelineBar(p) : ''}
    <article class="lore-prose${p.layout ? ` is-${p.layout}` : ''}">${withAssets(p.html)}</article>
    <div class="lore-foot${p.layout ? ` is-${p.layout}` : ''}">
    ${p.notes ? `<details class="lore-notes"><summary><span>Translator's notes</span><span class="lore-notes-hint">Show</span><span class="ui-go" aria-hidden="true">›</span></summary><div class="lore-notes-body">${withAssets(p.notes)}</div></details>` : ''}
    <nav class="lore-next">
      ${prev ? `<a class="ui-row tap" data-lore="${esc(prev.slug)}" href="#lore/${esc(prev.slug)}"><span class="ui-go" aria-hidden="true">‹</span><span class="ui-row-name"><small>Previous</small><b>${esc(prev.title)}</b></span></a>` : '<span></span>'}
      ${next ? `<a class="ui-row tap r" data-lore="${esc(next.slug)}" href="#lore/${esc(next.slug)}"><span class="ui-row-name"><small>Next</small><b>${esc(next.title)}</b></span><span class="ui-go" aria-hidden="true">›</span></a>` : '<span></span>'}
    </nav>
    <p class="lore-credit">${esc(CREDIT)}</p>
    </div>`;
}

// The Chronology's own bar: jump to an era, or keep only one faction's entries.
function timelineBar(p: LorePiece): string {
  const eras = (p.eras ?? [])
    .map((e) => `<button type="button" class="ref-facet" data-tl-era="${esc(e.id)}">${esc(e.label)}<span class="fc-n">${esc(e.years)}</span></button>`)
    .join('');
  const facs = ['RDL', 'UN', 'GOF']
    .map((f) => `<button type="button" class="ref-facet" data-fac="${f}" data-tl-fac="${f}" aria-pressed="false">${FAC_SHORT[f]}</button>`)
    .join('');
  return `<nav class="tl-bar" aria-label="Timeline"><div class="tl-row">${eras}</div><div class="tl-row tl-facs"><span>Only</span>${facs}</div></nav>`;
}

function filterTimeline(fac: string | null): void {
  if (!reader) return;
  reader.querySelectorAll<HTMLElement>('[data-tl-fac]').forEach((b) => {
    const on = b.dataset.tlFac === fac;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  reader.querySelectorAll<HTMLElement>('.tl-e').forEach((e) => {
    e.hidden = !!fac && !(e.dataset.f ?? '').split(' ').includes(fac);
  });
  reader.querySelectorAll<HTMLElement>('.tl-era').forEach((s) => {
    s.hidden = !s.querySelector('.tl-e:not([hidden])');
  });
}

function jumpToEra(id: string): void {
  const sec = reader?.querySelector<HTMLElement>(`#tl-${CSS.escape(id)}`);
  if (!reader || !sec) return;
  if (sec.hidden) filterTimeline(null);
  const offset = (reader.querySelector<HTMLElement>('.lore-r-top')?.offsetHeight ?? 0) + (reader.querySelector<HTMLElement>('.tl-bar')?.offsetHeight ?? 0);
  reader.scrollTo({ top: sec.getBoundingClientRect().top - reader.getBoundingClientRect().top + reader.scrollTop - offset - 8, behavior: 'smooth' });
}

// ---- glossary notes --------------------------------------------------------
// The first use of a term in a piece is a button; a tap opens its note under
// it (a sheet at the foot of the screen on a phone). One note at a time.

function openGloss(btn: HTMLElement): void {
  const g = current?.gloss?.[btn.dataset.g ?? ''];
  if (!reader || !g) return;
  const same = gFrom === btn;
  closeGloss(false);
  if (same) return; // a second tap on the same term closes it
  const [term, zh, def] = g;
  gpop = document.createElement('div');
  gpop.className = 'lore-gpop';
  gpop.setAttribute('role', 'dialog');
  gpop.setAttribute('aria-label', term);
  gpop.innerHTML = `<button type="button" class="dlg-close" data-gloss-close aria-label="Close">✕</button>
    <div class="lore-kicker">Glossary</div>
    <div class="lore-gpop-ttl">${esc(term)} <span lang="zh">${esc(zh)}</span></div>
    <p>${esc(def)}</p>`;
  reader.appendChild(gpop);
  gFrom = btn;
  btn.classList.add('active');
  btn.setAttribute('aria-expanded', 'true');
  const r = btn.getBoundingClientRect();
  const box = reader.getBoundingClientRect();
  const w = gpop.offsetWidth;
  const left = Math.max(12, Math.min(r.left - box.left + r.width / 2 - w / 2, reader.clientWidth - w - 12));
  gpop.style.left = `${left}px`;
  gpop.style.top = `${r.bottom - box.top + reader.scrollTop + 8}px`;
  gpop.querySelector<HTMLElement>('[data-gloss-close]')?.focus({ preventScroll: true });
}

function closeGloss(refocus = true): void {
  gpop?.remove();
  gpop = null;
  if (gFrom) {
    gFrom.classList.remove('active');
    gFrom.setAttribute('aria-expanded', 'false');
    if (refocus) gFrom.focus({ preventScroll: true });
  }
  gFrom = null;
}

function onScroll(): void {
  if (!reader) return;
  const bar = reader.querySelector<HTMLElement>('.lore-r-prog');
  const max = reader.scrollHeight - reader.clientHeight;
  if (bar) bar.style.width = `${max > 0 ? Math.min(100, (reader.scrollTop / max) * 100) : 100}%`;
}

function lock(): void {
  if (document.body.classList.contains('lore-locked')) return;
  lockedAt = window.scrollY;
  document.body.style.top = `-${lockedAt}px`;
  document.body.classList.add('lore-locked');
}

function unlock(): void {
  if (!document.body.classList.contains('lore-locked')) return;
  document.body.classList.remove('lore-locked');
  document.body.style.top = '';
  window.scrollTo(0, lockedAt);
}

function show(slug: string): boolean {
  const p = pieces?.find((x) => x.slug === slug);
  if (!p) return false;
  if (!reader) {
    reader = document.createElement('div');
    reader.id = 'lore-reader';
    reader.setAttribute('role', 'dialog');
    reader.setAttribute('aria-modal', 'true');
    reader.addEventListener('scroll', onScroll, { passive: true });
    document.body.appendChild(reader);
  }
  reader.setAttribute('aria-label', p.title);
  closeGloss(false);
  current = p;
  reader.innerHTML = readerHtml(p);
  reader.hidden = false;
  reader.scrollTop = 0;
  const bar = reader.querySelector<HTMLElement>('.tl-bar');
  if (bar) bar.style.top = `${reader.querySelector<HTMLElement>('.lore-r-top')?.offsetHeight ?? 0}px`;
  lock();
  onScroll();
  reader.querySelector<HTMLElement>('[data-lore-close]')?.focus({ preventScroll: true });
  return true;
}

function hide(): void {
  if (!reader || reader.hidden) return;
  closeGloss(false);
  reader.hidden = true;
  unlock();
}

export function openLore(slug: string): void {
  if (!pieces) return loadLore(() => openLore(slug));
  const already = !!reader && !reader.hidden;
  if (!show(slug)) return;
  const url = `#lore/${slug}`;
  if (already && pushed) history.replaceState({ lore: slug }, '', url);
  else {
    history.pushState({ lore: slug }, '', url);
    pushed = true;
  }
}

export function closeLore(): void {
  if (!reader || reader.hidden) return;
  if (pushed) {
    pushed = false;
    history.back(); // popstate hides it
    return;
  }
  hide();
  history.replaceState(null, '', location.pathname + location.search);
}

const hashSlug = () => /^#lore\/([\w-]+)$/.exec(location.hash)?.[1];

// Once, at start-up: the clicks, Escape, Back, and a #lore/<slug> link.
export function initLore(): void {
  loadLore(() => {
    const slug = hashSlug();
    if (slug) show(slug); // arrived by link: nothing of ours to go Back over
  });
  document.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    if (t.closest('[data-gloss-close]')) {
      closeGloss();
      return;
    }
    const term = t.closest<HTMLElement>('.lore-g');
    if (term) {
      openGloss(term);
      return;
    }
    if (gpop && !t.closest('.lore-gpop')) closeGloss(false);
    if (t.closest('[data-lore-close]')) {
      ev.preventDefault();
      closeLore();
      return;
    }
    const era = t.closest<HTMLElement>('[data-tl-era]');
    if (era) {
      jumpToEra(era.dataset.tlEra!);
      return;
    }
    const fac = t.closest<HTMLElement>('[data-tl-fac]');
    if (fac) {
      filterTimeline(fac.classList.contains('active') ? null : fac.dataset.tlFac!);
      return;
    }
    const hit = t.closest<HTMLElement>('[data-lore]');
    if (hit) {
      ev.preventDefault();
      openLore(hit.dataset.lore!);
    }
  });
  document.addEventListener('keydown', (ev) => {
    const t = ev.target as HTMLElement;
    if ((ev.key === 'Enter' || ev.key === ' ') && t.matches?.('.lore-tile, .lore-feat')) {
      ev.preventDefault();
      openLore(t.dataset.lore!);
    } else if (ev.key === 'Escape' && gpop) {
      ev.preventDefault();
      closeGloss();
    } else if (ev.key === 'Escape' && reader && !reader.hidden) {
      ev.preventDefault();
      closeLore();
    }
  });
  window.addEventListener('popstate', () => {
    const slug = hashSlug();
    if (slug && pieces) {
      show(slug);
      pushed = false;
    } else {
      pushed = false;
      hide();
    }
  });
}
