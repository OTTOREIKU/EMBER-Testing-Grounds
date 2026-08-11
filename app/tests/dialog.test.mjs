// What Escape and a backdrop click select in a choiceDialog.
//
// The bug this file guards: `data-cancel` used to be stamped on choices[last]
// whatever that choice was, and Escape/backdrop click it. Every picker built as
// a bare list of targets therefore carried a silent "choose the last one"
// hotkey — Escape over a Prototype Blink target list teleported the Taurus into
// whichever unit sorted last, and eleven call sites had the same shape (launch
// payload, resupply target, mine Grid, Black Box hand, Terminal, Charge Part,
// shove victim, Secondary Task, Tactical Zone, and two Mech designations).
//
// The contract now: a choice must SAY it is the safe one (`cancel: true`), or a
// lone choice which is its own dismissal. Anything else and Escape resolves
// null, which every caller already treats as "no choice made".
//
// Tested against the real dialog.ts through a DOM stub rather than by reading
// the source, so the wiring is exercised and not just the markup.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/dialog.ts', import.meta.url), 'utf8');
const tmp = new URL('./_dialog.slice.ts', import.meta.url);
writeFileSync(tmp, src);

// A DOM small enough to run the dialog and large enough to be honest about it:
// real listener dispatch, real querySelector over the built markup.
class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.listeners = {};
    this.dataset = {};
    this._html = '';
    this.className = '';
    this.parent = null;
  }
  set innerHTML(v) { this._html = v; this.children = parse(v, this); this.textContent ??= ''; }
  get innerHTML() { return this._html; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  append(...cs) { cs.forEach((c) => this.appendChild(c)); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); }
  addEventListener(k, fn) { (this.listeners[k] ??= []).push(fn); }
  removeEventListener(k, fn) { this.listeners[k] = (this.listeners[k] ?? []).filter((f) => f !== fn); }
  dispatch(k, ev = {}) { for (const fn of this.listeners[k] ?? []) fn({ target: this, ...ev }); }
  click() { this.dispatch('click'); }
  focus() {}
  select() {}
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  querySelectorAll(sel) {
    // The descendant test MUST come first: ".dlg-actions button" starts with a
    // dot, so a class-first check swallowed it, attached no click listeners and
    // left every dialog hanging instead of failing.
    if (sel.includes(' ')) {
      const [a, b] = sel.split(/\s+/);
      return this.all().filter((c) => c.matches(b) && c.ancestor(a));
    }
    return this.all().filter((c) => c.matches(sel));
  }
  matches(sel) {
    if (sel.startsWith('.')) return this.className.split(/\s+/).includes(sel.slice(1));
    if (sel.startsWith('[') && sel.endsWith(']')) return !!this.attrs?.has(sel.slice(1, -1));
    return this.tagName === sel.toUpperCase();
  }
  get firstButton() { return this.querySelectorAll('button')[0]; }
  ancestor(sel) { let p = this.parent; while (p) { if (p.matches(sel)) return true; p = p.parent; } return false; }
}

// A stack-based scanner, because dialog.ts nests: the panel div holds the
// actions div which holds the buttons. A single non-greedy regex stops at the
// FIRST </div> and silently drops every button — which made this file's first
// two assertions pass for the wrong reason until the parser was fixed.
function parse(html, parent) {
  const roots = [];
  const stack = [];
  const re = /<(\/?)(\w+)([^>]*?)(\/?)>/g;
  let m;
  let last = 0;
  const text = (upto) => {
    const t = html.slice(last, upto);
    if (t.trim() && stack.length) stack[stack.length - 1].textContent += t;
    last = upto;
  };
  while ((m = re.exec(html))) {
    text(m.index);
    last = re.lastIndex;
    const [, closing, tag, attrs, selfClose] = m;
    if (closing) { stack.pop(); continue; }
    const el = new El(tag);
    el.attrs = new Set();
    el.textContent = '';
    for (const a of attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
      if (a[1] === 'class') el.className = a[2] ?? '';
      else {
        el.attrs.add(a[1]);
        if (a[1].startsWith('data-') && a[2] !== undefined) {
          el.dataset[a[1].slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = a[2];
        }
      }
    }
    const top = stack[stack.length - 1];
    if (top) { el.parent = top; top.children.push(el); } else { el.parent = parent; roots.push(el); }
    if (!selfClose && !/^(br|img|input|hr)$/i.test(tag)) stack.push(el);
  }
  return roots;
}

const body = new El('body');
const listeners = {};
globalThis.document = {
  createElement: (t) => new El(t),
  body,
  addEventListener: (k, fn) => ((listeners[k] ??= []).push(fn)),
  removeEventListener: (k, fn) => (listeners[k] = (listeners[k] ?? []).filter((f) => f !== fn)),
};
const pressEscape = () => {
  for (const fn of [...(listeners.keydown ?? [])]) fn({ key: 'Escape', stopPropagation() {}, preventDefault() {} });
};
const clickBackdrop = () => {
  const back = body.children.at(-1);
  back?.dispatch('pointerdown', { target: back });
};

const { choiceDialog, confirmDialog } = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const targets = [
  { id: '7', label: 'Alpha' },
  { id: '8', label: 'Bravo' },
  { id: '9', label: 'Charlie' },
];

console.log('choiceDialog: what Escape selects\n');

// The bug itself. A bare target list must NOT resolve to the last target.
let p = choiceDialog({ title: 'exchange with which Mech?', choices: targets });
pressEscape();
check('Escape over a bare target list picks nothing', await p, null);

p = choiceDialog({ title: 'exchange with which Mech?', choices: targets });
clickBackdrop();
check('and a backdrop click picks nothing either', await p, null);

// A marked choice is what Escape lands on, wherever it sits in the list.
p = choiceDialog({ title: 'pick', choices: [...targets, { id: 'cancel', label: 'Cancel', cancel: true }] });
pressEscape();
check('a marked cancel is what Escape selects', await p, 'cancel');

p = choiceDialog({
  title: 'pick',
  choices: [{ id: 'stay', label: 'Keep editing', cancel: true }, ...targets],
});
pressEscape();
check('even when the marked choice is FIRST', await p, 'stay');

// A lone choice is its own dismissal — an alert's "Got it" cannot mean
// anything else — so it is marked for free.
p = choiceDialog({ title: 'note', choices: [{ id: 'ok', label: 'Got it', primary: true }] });
pressEscape();
check('a single choice is its own dismissal', await p, 'ok');

// Clicking still works normally, and the dialog settles exactly once.
p = choiceDialog({ title: 'pick', choices: targets });
body.children.at(-1).querySelectorAll('button').find((b) => b.dataset.id === '8').click();
check('clicking a target returns that target', await p, '8');

p = choiceDialog({ title: 'pick', choices: [...targets, { id: 'cancel', label: 'Cancel', cancel: true }] });
const panelBtns = body.children.at(-1).querySelectorAll('button');
panelBtns.find((b) => b.dataset.id === '7').click();
pressEscape();
check('a settled dialog ignores a later Escape', await p, '7');

// confirmDialog says outright that Escape means no, rather than inheriting it
// from the cancel happening to be last.
check('Escape on a confirmation is No', await (() => { const q = confirmDialog({ title: 'sure?' }); pressEscape(); return q; })(), false);
check('and OK is still Yes', await (() => {
  const q = confirmDialog({ title: 'sure?' });
  body.children.at(-1).querySelectorAll('button').find((b) => b.dataset.id === 'ok').click();
  return q;
})(), true);

// The markup itself: exactly one Escape target, never more.
p = choiceDialog({ title: 'pick', choices: [...targets, { id: 'cancel', label: 'Cancel', cancel: true }] });
const marked = body.children.at(-1).querySelectorAll('button').filter((b) => b.attrs?.has('data-cancel'));
check('exactly one button is the Escape target', marked.length, 1);
check('and it is the one that said so', marked[0].dataset.id, 'cancel');
pressEscape();
await p;

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
