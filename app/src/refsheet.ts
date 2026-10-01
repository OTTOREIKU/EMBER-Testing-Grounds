// The Reference's detail sheet, as it BEHAVES, shared by the Reference and the
// pad (OTTO, 2026-09-30: "import the look and style of the reference app into
// pad so future updates will appear"). Both pages draw the same #ref-detail
// markup; each keeps its own stack of what is open, and hands the router below
// the three things it needs of it (SheetNav). What a sheet DOES lives here once:
// the master changelog's filter and revision menu, the sheet keeping its size
// across tabs, the head as the unit header, and the links that open a Rules
// entry, a Season Rule or the changelog. Moved from reference.ts, where it was
// the Reference's alone, so the pad's sheet had none of it.
import { barcodeSvg } from './barcode';
import { norm } from './refsearch';

// What either page opens from a link in a sheet or a tab.
export type SheetKind = 'card' | 'keyword' | 'changelog' | 'rule' | 'season';

export interface SheetNav {
  open(kind: SheetKind, key: string, opts?: { log?: boolean }): void;
  // The sheet on screen, or none.
  top(): { kind: string; key: string } | undefined;
  // The open master changelog, switched to another revision in place.
  retarget(key: string): void;
}

// The master changelog's search and kind chips (Popup B of the design study),
// applied in place to the rows the sheet drew: typing never redraws the sheet,
// so the search keeps its focus, and Back from an item finds the list filtered
// as it was left. A new revision, or the sheet opened afresh, starts clear.
export const clFilter: { kind: string; q: string } = { kind: 'all', q: '' };

export function resetChangelogFilter(): void {
  clFilter.kind = 'all';
  clFilter.q = '';
}

export function applyChangelogFilter(root: HTMLElement): void {
  const list = root.querySelector<HTMLElement>('.cl-list');
  if (!list) return;
  const input = root.querySelector<HTMLInputElement>('#cl-q');
  if (input && input.value !== clFilter.q) input.value = clFilter.q;
  root.querySelectorAll<HTMLElement>('[data-clkind]').forEach((b) => b.classList.toggle('active', b.dataset.clkind === clFilter.kind));
  const q = norm(clFilter.q.trim());
  let shown = 0;
  list.querySelectorAll<HTMLElement>('li[data-clk]:not(.cl-note)').forEach((li) => {
    const on = (clFilter.kind === 'all' || li.dataset.clk === clFilter.kind) && (!q || norm(li.dataset.cln ?? '').includes(q));
    li.hidden = !on;
    if (on) shown++;
  });
  // The Season Rules' note shows with their rows and not under a search, and is
  // never counted as a match.
  list.querySelectorAll<HTMLElement>('li.cl-note').forEach((li) => {
    li.hidden = !!q || !(clFilter.kind === 'all' || li.dataset.clk === clFilter.kind);
  });
  const none = root.querySelector<HTMLElement>('.cl-none');
  if (none) none.hidden = shown > 0;
}

// The master changelog's revision menu (refcards.ts changelogIndex), our own
// list where a native select's was the system's: it opens under the revision's
// pill, closes on a pick, on a click anywhere else and on Escape (which then
// leaves the sheet open), and the arrow keys walk it.
export function versionMenu(): { btn: HTMLButtonElement; menu: HTMLElement } | null {
  const root = document.getElementById('ref-detail-content');
  const btn = root?.querySelector<HTMLButtonElement>('.cl-ver-btn');
  const menu = root?.querySelector<HTMLElement>('.cl-ver-menu');
  return btn && menu ? { btn, menu } : null;
}

export function openVersionMenu(open: boolean): void {
  const m = versionMenu();
  if (!m) return;
  m.menu.hidden = !open;
  m.btn.setAttribute('aria-expanded', String(open));
  if (open) m.menu.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
}

// Whether a menu was open to close; `focus` hands the focus back to its pill.
export function closeVersionMenu(focus = false): boolean {
  const m = versionMenu();
  if (!m || m.menu.hidden) return false;
  openVersionMenu(false);
  if (focus) m.btn.focus();
  return true;
}

// A Rules entry's Advanced, as a sheet draws it (refcards.ts ruleDetail). A link
// to an entry opens it closed. The master changelog opens it open, because the
// entry's changelog is the first thing inside (`log`). And once a sheet has been
// covered by another, it is drawn again as the reader left it (`advanced`), or
// Back would restore a scroll measured with the fold open onto a sheet drawn
// with it closed. Both pages keep these two on the views in their own stacks.
export interface SheetFold { log?: boolean; advanced?: boolean }

export const drawsAdvanced = (v: SheetFold): boolean => v.advanced ?? !!v.log;

// Whether the Rules entry in the open sheet has its Advanced open. Its own, and
// not one inside a rule folded under a card's Action.
export function ruleAdvancedOpen(): boolean {
  return !!document.querySelector<HTMLDetailsElement>('#ref-detail-content .ref-rule > details.mech-adv')?.open;
}

// A page calls this on the sheet it is about to cover with another.
export function noteSheetLeft(v: { kind: string } & SheetFold): void {
  if (v.kind === 'rule') v.advanced = ruleAdvancedOpen();
}

// A card or keyword opened from the master changelog shows its own Changelog,
// open and scrolled to; a Rules entry's is at the top of its Advanced, which
// its sheet drew open for it. Only on the way in: Back restores the scroll the
// reader left.
export function revealLog(): void {
  const content = document.getElementById('ref-detail-content');
  const log = content?.querySelector<HTMLDetailsElement>('details.ref-log, details.mech-adv');
  if (!log) return;
  log.open = true;
  holdDetailHeight(content!);
  const scroller = document.querySelector<HTMLElement>('#ref-detail .ref-detail-inner');
  if (!scroller) return;
  const top = log.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  scroller.scrollTop = Math.max(0, top - 56);
}

// Switching tabs is pure DOM and never a re-render: repainting would remount
// the card image, restart its load and throw away the scroll position, for a
// change that only decides which of three panels is visible.
export function showDetailTab(root: HTMLElement, which: string): void {
  root.querySelectorAll<HTMLElement>('[data-dtab]').forEach((b) => {
    const on = b.dataset.dtab === which;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });
  root.querySelectorAll<HTMLElement>('[data-dpanel]').forEach((p) => {
    p.hidden = p.dataset.dpanel !== which;
  });
  holdDetailHeight(root);
}

// THE SHEET KEEPS ITS SIZE ACROSS TABS. The three panels are different lengths,
// so switching threw the whole popup up and down the screen and moved the tab
// strip out from under the pointer that had just used it.
//
// The floor is the TALLEST panel seen so far rather than the tallest possible:
// measuring the hidden ones would mean unhiding, reading and rehiding all three
// on every switch, which is three forced reflows for a number that only ever
// grows. So it settles after the reader has visited the long tab once, and
// never shrinks back within a card.
export function holdDetailHeight(root: HTMLElement): void {
  const open = root.querySelector<HTMLElement>('[data-dpanel]:not([hidden])');
  if (!open) return;
  // Read the CONTENT height with the floor lifted, or every measurement after
  // the first would just report the floor back to itself.
  root.style.setProperty('--dpanel-h', 'auto');
  const natural = open.scrollHeight;
  // THE RAW MAX IS STORED, THE CAP IS APPLIED ON THE WAY OUT. Storing the
  // capped value instead makes the floor ratchet DOWNWARD: each visit clamps
  // the previous clamp, so the tallest panel's height is forgotten and the
  // sheet ends up sized to whichever tab was seen last. That is the opposite of
  // what the floor is for.
  const raw = Math.max(natural, Number(root.dataset.panelMax ?? 0));
  root.dataset.panelMax = String(raw);

  // The cap is what stops the floor pushing the sheet past the window and
  // putting a scrollbar on a card that would otherwise fit. Measured from
  // `offsetTop` and the sheet's own max-height, both of which are independent
  // of the floor being set, so this cannot chase itself the way a measurement
  // off the live rect would.
  const scroller = root.closest('.ref-detail-inner') as HTMLElement | null;
  let cap = Infinity;
  if (scroller) {
    const cs = getComputedStyle(scroller);
    const maxH = parseFloat(cs.maxHeight);
    const padBottom = parseFloat(cs.paddingBottom) || 0;
    if (Number.isFinite(maxH)) cap = Math.max(200, maxH - open.offsetTop - padBottom);
  }
  root.style.setProperty('--dpanel-h', `${Math.min(raw, cap)}px`);
}

// The sheet's head as the pad's unit header (STYLE-GUIDE, the Reference
// round): the meta line the renderers write under the name becomes the
// kicker above it, and our barcode, seeded by the name, goes under it.
export function decorateSheetHead(content: HTMLElement): void {
  const h2 = content.querySelector('h2');
  if (h2) {
    const meta = h2.nextElementSibling;
    if (meta?.matches('p.ref-meta')) { meta.classList.replace('ref-meta', 'ref-kick'); h2.before(meta); }
    h2.insertAdjacentHTML('afterend', barcodeSvg(h2.textContent ?? '', 'ref-code'));
  }
}

// Every link a sheet or a tab carries that both pages answer alike, in the
// Reference's order. True when it answered; the page then goes on to its own.
export function runSheetClick(ev: MouseEvent, nav: SheetNav): boolean {
  const t = ev.target as HTMLElement;
  // The detail's own tabs, answered before anything else: they are buttons
  // inside a panel full of keyword links, and they navigate nowhere.
  const dtab = t.closest<HTMLElement>('[data-dtab]');
  if (dtab) {
    const root = document.getElementById('ref-detail-content');
    if (root) showDetailTab(root, dtab.dataset.dtab!);
    return true;
  }
  // The master changelog's revision menu: the pill opens and closes it, a
  // revision in it switches the list in place, its filter cleared and its
  // scroll at the top, and any other click closes it on the way through.
  const verBtn = t.closest<HTMLElement>('.cl-ver-btn');
  if (verBtn) {
    ev.preventDefault();
    openVersionMenu(verBtn.getAttribute('aria-expanded') !== 'true');
    return true;
  }
  const verOpt = t.closest<HTMLElement>('[data-clver]');
  if (verOpt) {
    ev.preventDefault();
    const top = nav.top();
    if (top?.kind === 'changelog' && verOpt.dataset.clver !== top.key) {
      resetChangelogFilter();
      nav.retarget(verOpt.dataset.clver!);
    } else openVersionMenu(false);
    versionMenu()?.btn.focus();
    return true;
  }
  closeVersionMenu();
  // The master changelog (OTTO, 2026-09-30): a revision chip, or the bar in
  // the Rules tab, opens that revision's list, and on the open sheet switches
  // it in place; a row opens its card, keyword or Rules entry with its own
  // Changelog showing, Back returning to the list.
  const clv = t.closest<HTMLElement>('[data-clv]');
  if (clv) {
    ev.preventDefault();
    resetChangelogFilter();
    nav.open('changelog', clv.dataset.clv!);
    return true;
  }
  const clkind = t.closest<HTMLElement>('[data-clkind]');
  if (clkind) {
    ev.preventDefault();
    clFilter.kind = clkind.dataset.clkind!;
    const root = document.getElementById('ref-detail-content');
    if (root) applyChangelogFilter(root);
    return true;
  }
  const logItem = t.closest<HTMLElement>('[data-logcard], [data-logkw], [data-logrule], [data-logseason]');
  if (logItem) {
    ev.preventDefault();
    const d = logItem.dataset;
    if (d.logcard) nav.open('card', d.logcard, { log: true });
    else if (d.logkw) nav.open('keyword', d.logkw, { log: true });
    else if (d.logrule) nav.open('rule', d.logrule, { log: true });
    else if (d.logseason) nav.open('season', d.logseason);
    return true;
  }
  // A Season Rule, from the callout on the Rules entry it changes or from a
  // search; and from a Season Rule, the Rules entries it names.
  const seasonLink = t.closest<HTMLElement>('[data-season]');
  if (seasonLink) {
    ev.preventDefault();
    nav.open('season', seasonLink.dataset.season!);
    return true;
  }
  // The token index (refcards.ts tokenSection): a picture moves the page to
  // that token's entry. Nothing opens, so it is answered here and goes nowhere.
  const jump = t.closest<HTMLElement>('[data-tokjump]');
  if (jump) {
    ev.preventDefault();
    const id = (jump.dataset.tokjump ?? '').replace(/[^\w-]/g, '');
    // At once, with no glide: chrome never slides (ui.css rule 4), and a
    // smooth scroll inside the pad's own scrolling panel can be dropped.
    document.querySelector<HTMLElement>(`[data-tok="${id}"]`)?.scrollIntoView({ block: 'center' });
    return true;
  }
  const ruleSheet = t.closest<HTMLElement>('[data-rulesheet]');
  if (ruleSheet) {
    ev.preventDefault();
    nav.open('rule', ruleSheet.dataset.rulesheet!);
    return true;
  }
  const kw = t.closest<HTMLElement>('[data-kw]');
  if (kw) {
    ev.preventDefault();
    nav.open('keyword', kw.dataset.kw!);
    return true;
  }
  // A card named in the text, answered before the tile it sits in: inside a
  // keyword tile the tile took the click and opened the keyword instead.
  const cardLink = t.closest<HTMLElement>('a.kw-link[data-card]');
  if (cardLink) {
    ev.preventDefault();
    nav.open('card', cardLink.dataset.card!);
    return true;
  }
  return false;
}

// An open revision menu takes Escape and the arrows first; the sheet
// stays open under it. True when it took the key.
export function runSheetKey(ev: KeyboardEvent): boolean {
  const m = versionMenu();
  if (m && !m.menu.hidden) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closeVersionMenu(true);
      return true;
    }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const opts = [...m.menu.querySelectorAll<HTMLElement>('[data-clver]')];
      const at = opts.indexOf(document.activeElement as HTMLElement);
      const next = ev.key === 'ArrowDown' ? (at + 1) % opts.length : (at - 1 + opts.length) % opts.length;
      opts[next]?.focus();
      return true;
    }
  }
  return false;
}

// Tabbing out of the revision menu closes it, as a click elsewhere does.
export function runSheetFocus(ev: FocusEvent): void {
  const m = versionMenu();
  if (m && !m.menu.hidden && !(ev.target as HTMLElement).closest('.cl-ver')) openVersionMenu(false);
}

// The master changelog's search, filtering in place as it is typed.
export function runSheetInput(ev: Event): void {
  const el = ev.target as HTMLElement;
  if (el.id !== 'cl-q') return;
  clFilter.q = (el as HTMLInputElement).value;
  const root = document.getElementById('ref-detail-content');
  if (root) applyChangelogFilter(root);
}
