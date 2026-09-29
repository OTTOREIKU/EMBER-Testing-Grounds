import './notices.css';

// ONE NOTICE LINE PER PAGE (OTTO's picks, 2026-09-28; Project-Documents/
// NOTICES-AUDIT.md). What the player cannot see and needs goes here, in the
// same look on every page and one at a time: the newest replaces the last.
//
// What does NOT come here: a tap the rules would refuse (the control is greyed
// first, and a long press or a hover shows why - in this same line), a real
// decision (still a dialog), and a confirmation of what the screen already
// shows (dropped, or handed to a log the page names).
//
// Built like updates.ts: one component, and each page says only where the
// line lives and how it speaks. Text only: the line is filled with
// textContent, so nothing in a notice is ever read as markup.

export type NoticeKind =
  | 'refused' // a tap the rules turned down, when the control could not be greyed first
  | 'warn' // allowed, but worth knowing (a freeplay move the rules would not allow)
  | 'event' // the other player (or the other phone) did something
  | 'table' // a step to do on the physical table
  | 'system' // the connection, saving, loading
  | 'done'; // a confirmation of the player's own move

// How much it says. terse and plain leave out rule and FAQ numbers, which
// belong to the Reference; teaching keeps every word.
export type NoticeVoice = 'terse' | 'plain' | 'teaching';

// line: shown for a while; sticky: until tapped away or replaced; off: never
// shown (handed to onLog instead).
export type NoticeMode = 'line' | 'sticky' | 'off';

export interface Notice {
  kind: NoticeKind;
  text: string;
  // Offer Undo while this answers true. Asked when drawn and again when
  // pressed, so an Undo can never reach past a later move and take back
  // something the notice was not about.
  undo?: () => boolean;
  // What Undo does for this notice, when it is more than the page's own Undo
  // (the tabletop's house-rule attack also closes the window it opened).
  onUndo?: () => void;
}

export interface NoticeConfig {
  // Where the line is drawn, looked up on every show so a page that rebuilds
  // its skeleton never draws into a detached node.
  host: () => HTMLElement | null;
  // A page whose voice changes with its mode (the tabletop's Teaching guide
  // keeps the rule numbers) passes a function, asked at each notice.
  voice?: NoticeVoice | (() => NoticeVoice);
  kinds?: Partial<Record<NoticeKind, NoticeMode>>;
  onUndo?: () => void;
  onLog?: (n: Notice) => void;
}

const MODES: Record<NoticeKind, NoticeMode> = {
  refused: 'line', warn: 'line', event: 'line', table: 'sticky', system: 'sticky', done: 'off',
};
const HOLD_MS: Record<NoticeKind, number> = {
  refused: 3200, warn: 4500, event: 5000, table: 0, system: 0, done: 2600,
};

let config: NoticeConfig | null = null;
let shown: (Notice & { id: number }) | null = null;
let seq = 0;
let timer = 0;

export function configureNotices(c: NoticeConfig): void {
  config = c;
  draw();
}

export function notify(n: Notice): void {
  if (!config || !n.text) return;
  const mode = config.kinds?.[n.kind] ?? MODES[n.kind];
  if (mode === 'off') {
    config.onLog?.(n);
    return;
  }
  const voice = typeof config.voice === 'function' ? config.voice() : config.voice;
  const text = speak(n.text, voice ?? 'plain');
  if (!text) return;
  shown = { ...n, text, id: ++seq };
  draw();
  window.clearTimeout(timer);
  if (mode === 'line') {
    const id = shown.id;
    timer = window.setTimeout(() => dismissNotice(id), HOLD_MS[n.kind] + (n.undo ? 1500 : 0));
  }
}

// Draws the line again, for a page that has just rebuilt the element it lives in.
export function redrawNotice(): void {
  draw();
}

// Takes the line away: the one shown, or only if it is still the given one.
export function dismissNotice(id?: number): void {
  if (!shown || (id !== undefined && shown.id !== id)) return;
  shown = null;
  draw();
}

// Clears the line if it is of this kind: a reconnect clears "Connection lost".
export function clearNotice(kind: NoticeKind): void {
  if (shown?.kind === kind) dismissNotice();
}

export function currentNotice(): { kind: NoticeKind; text: string; undo: boolean } | null {
  return shown ? { kind: shown.kind, text: shown.text, undo: !!shown.undo?.() } : null;
}

// Rule and FAQ numbers are for the Reference and the teaching guide. In play
// they are noise, so outside teaching a parenthesis that holds only
// references goes, and one that mixes words and references keeps the words:
// "(Command Coordination, 4.15.3)" becomes "(Command Coordination)".
const REF = new RegExp([
  String.raw`\d+(?:\.\d+)+[a-z]?`, // 4.1.1, 3.1, 5.2.3b - never a bare count like (3)
  String.raw`FAQ [A-Z]\d+(?:\.\d+)?(?:/[A-Z]?\d+)*`, // FAQ I11, FAQ M18.3, FAQ E6/M13
  String.raw`p\.\s?\d+`, // p.71
  String.raw`(?:ruling|rulebook|glossary|Rules Supplement|GoF)(?: [A-Z]?[\d.]+)?`,
  String.raw`[A-Z]{1,5}\d+(?:\.\d+)?`, // M27, I25, ECP10
  String.raw`[A-Z]{2,5}\d*-\d+[A-Z]?(?:-\d+)?`, // LPA-22, PDLH-202, ZYBP-202
  String.raw`audit[^,;)]*`,
].map((r) => `(?:${r})`).join('|'));
const ONLY_REF = new RegExp(`^(?:${REF.source})$`);

// The parentheses cut, and whether any was.
function cutRefs(text: string): { text: string; cut: boolean } {
  let cut = false;
  const out = text.replace(/\s*\(([^()]*)\)/g, (whole, inner: string) => {
    const parts = inner.split(/\s*[,;]\s*|\s+(?:and|or)\s+|\s*\/\s*/).filter(Boolean);
    if (!parts.length) return whole;
    const kept = parts.filter((p) => !ONLY_REF.test(p.trim()));
    if (kept.length === parts.length) return whole;
    cut = true;
    return kept.length ? ` (${kept.join(', ')})` : '';
  });
  return { text: out, cut };
}

export function speak(text: string, voice: NoticeVoice): string {
  if (voice === 'teaching') return text.trim();
  return cutRefs(text).text
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// The same cut for a piece of drawn text: the references go and nothing else
// moves, so the spaces a text node shares with its neighbours survive.
export function stripRefs(text: string): string {
  if (!text.includes('(')) return text;
  const r = cutRefs(text);
  return r.cut ? r.text.replace(/(\S)\s+([.,;:!?])/g, '$1$2') : text;
}

// ---------- the play surface in the same voice (pick 4) ----------
//
// "No rule numbers in play" (OTTO, 2026-09-29): the combat window, the panels,
// the dialogs and the tooltips of a page in play read the words, the way the
// line does. Every string keeps its numbers in the source, for the Teaching
// voice and for whoever reads the code; the page hands its play surface to
// this, which cuts them as the text is drawn. Anything inside `keep` (the
// Reference's own sheets, a card's rulebook blocks, the card tooltip) is left
// as written, and `active` lets a page stand it down (the tabletop's Teaching).
export function speakInPlace(root: HTMLElement, opts: { keep?: string; active?: () => boolean } = {}): () => void {
  const keep = opts.keep ?? '';
  const on = opts.active ?? (() => true);
  const kept = (el: Element | null): boolean => !el || !!el.closest('script, style, textarea, code, pre') || (!!keep && !!el.closest(keep));
  const text = (t: Text): void => {
    if (kept(t.parentElement)) return;
    const next = stripRefs(t.data);
    if (next !== t.data) t.data = next;
  };
  const title = (el: Element): void => {
    const was = el.getAttribute('title');
    if (!was || kept(el)) return;
    const next = stripRefs(was);
    if (next !== was) el.setAttribute('title', next);
  };
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) { text(node as Text); return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (kept(el)) return;
    title(el);
    for (const t of el.querySelectorAll('[title]')) title(t);
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) text(n as Text);
  };
  const seen = new MutationObserver((records) => {
    if (!on()) return;
    for (const r of records) {
      if (r.type === 'characterData') text(r.target as Text);
      else if (r.type === 'attributes') title(r.target as Element);
      else r.addedNodes.forEach(walk);
    }
  });
  if (on()) walk(root);
  seen.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title'] });
  return () => seen.disconnect();
}

function draw(): void {
  const host = config?.host();
  if (!host) return;
  if (!shown) {
    host.replaceChildren();
    host.hidden = true;
    return;
  }
  const n = shown;
  host.hidden = false;
  // The page's own classes (its placement) stay; only the line's are set.
  const own = host.className.split(/\s+/).filter((c) => c && c !== 'notice-line' && !c.startsWith('k-'));
  host.className = [...own, 'notice-line', `k-${n.kind}`].join(' ');
  host.setAttribute('role', 'status');
  host.setAttribute('aria-live', 'polite');
  const dot = document.createElement('span');
  dot.className = 'notice-dot';
  dot.setAttribute('aria-hidden', 'true');
  const words = document.createElement('span');
  words.className = 'notice-text';
  words.textContent = n.text;
  const parts: HTMLElement[] = [dot, words];
  const onUndo = n.onUndo ?? config?.onUndo;
  if (n.undo?.() && onUndo) {
    const undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'notice-undo';
    undo.textContent = 'Undo';
    undo.addEventListener('click', () => {
      const still = n.undo?.();
      dismissNotice(n.id);
      if (still) onUndo();
    });
    parts.push(undo);
  }
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'ui-x notice-x';
  x.setAttribute('aria-label', 'Dismiss');
  x.textContent = '✕';
  x.addEventListener('click', () => dismissNotice(n.id));
  parts.push(x);
  host.replaceChildren(...parts);
}

// A greyed control explains itself when held (a phone) or rested on (a mouse):
// its reason, in `data-why`, goes to this line (OTTO's pick 2). The control is only LOOKED
// disabled (aria-disabled plus the page's greyed class), because a truly
// disabled button hears no pointer at all and could never be held.
export function explainOnHold(root: HTMLElement, holdMs = 450, hoverMs = 350): void {
  let timerId = 0;
  let armed: HTMLElement | null = null;
  const cancel = () => {
    window.clearTimeout(timerId);
    armed = null;
  };
  root.addEventListener('pointerdown', (e) => {
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-why]');
    if (!el || !root.contains(el)) return;
    armed = el;
    timerId = window.setTimeout(() => {
      if (armed?.dataset.why) notify({ kind: 'refused', text: armed.dataset.why });
      armed = null;
    }, holdMs);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) root.addEventListener(ev, cancel);
  // A mouse has no long press, so resting on the control does the same. The
  // short wait keeps a sweep down a list from flashing every reason in turn,
  // and the reason then stays its usual while after the pointer moves on: the
  // line is not beside the pointer, so it has to be looked for. The control
  // carries no title of its own, or the reason would be said twice.
  let hovered: HTMLElement | null = null;
  let dwellId = 0;
  root.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const at = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-why]') ?? null;
    const el = at && root.contains(at) ? at : null;
    if (el === hovered) return;
    window.clearTimeout(dwellId);
    hovered = el;
    if (!el) return;
    dwellId = window.setTimeout(() => {
      // A hover never talks over a notice whose Undo is still live: a pointer
      // resting on a greyed control in passing would take the Undo away. A
      // long press or a key is deliberate, and does.
      if (hovered === el && el.isConnected && el.dataset.why && !shown?.undo?.()) notify({ kind: 'refused', text: el.dataset.why });
    }, hoverMs);
  });
  root.addEventListener('pointerout', (e) => {
    if (!hovered || (e.relatedTarget instanceof Node && hovered.contains(e.relatedTarget))) return;
    window.clearTimeout(dwellId);
    hovered = null;
  });
  // A plain tap on a greyed control does nothing at all, like the Link "+"
  // at full Link: the reason is there for a player who holds it, and silent
  // for everyone else. Swallowed before the page's own click handler sees it.
  // Enter or Space on a focused one is no stray tap and has no hover or hold
  // to fall back on, so it is answered with the reason (a key's click has no
  // pointer count: detail 0).
  root.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[aria-disabled="true"]');
    if (!el || !root.contains(el)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.detail === 0 && el.dataset.why) notify({ kind: 'refused', text: el.dataset.why });
  }, true);
}
