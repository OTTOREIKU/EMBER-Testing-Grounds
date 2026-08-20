// A harness that DRIVES the real AttackHelper, rather than reading its source.
//
// Checked in by hand — this is not one of the generated `_*.slice.ts` files.
// The `_` only keeps it beside them, out of the way of the test list.
//
// Why it exists: focuspublish.test.mjs records that a DOM-driven harness for
// AttackHelper "is a bundling job (esbuild + a DOM shim) that no other test
// here carries", and settled for source-order assertions. Two live bugs later —
// the Surplus round that never asks the defender for their second roll, and a
// rejoin that throws a live attack away — the lesson this project already wrote
// down applies: a reader test is not a wiring test. The wiring is what breaks.
//
// combat.ts imports without extensions and reads `import.meta.env`, so plain
// node cannot load it; esbuild bundles the module graph into something node
// can import. esbuild is already here as vite's own bundler. If it ever goes
// away this throws loudly rather than skipping — a silent skip would hide
// exactly the class of bug these tests exist to catch.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const DATA = new URL('../../data/', import.meta.url);

// ---------- the DOM the helper builds into ----------
//
// Only what AttackHelper actually touches. Elements keep their children so a
// test can walk the tree and press the same buttons a player would.
export function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    className: '', id: '', textContent: '', innerHTML: '',
    children: [], dataset: {}, style: {}, disabled: false, hidden: false, _h: {},
    appendChild(c) { el.children.push(c); return c; },
    append(...cs) { el.children.push(...cs); },
    prepend(...cs) { el.children.unshift(...cs); },
    insertBefore(c) { el.children.unshift(c); return c; },
    replaceChildren(...cs) { el.children = cs; },
    remove() {},
    addEventListener(t, fn) { (el._h[t] ||= []).push(fn); },
    removeEventListener() {},
    querySelector(sel) {
      // The duel strip is animated, not read, and the animation is not what
      // any of this is testing.
      if (sel === '.duel') return null;
      el._q ||= {};
      return (el._q[sel] ||= makeEl('div'));
    },
    // innerHTML is a plain string here, so nothing parses it into children. The
    // one caller that needs results for 'button' is the pool editor, which
    // destructures two buttons out of markup it just wrote; a memoised pair
    // stands in for them so the listeners it binds have somewhere to live.
    //
    // A SINGLE CLASS selector walks the real children instead, because that is
    // how spinDice finds the dice it shakes: with a memoised empty array it
    // returned early and the animation could not be observed at all, which is
    // exactly the property the mirror slice had to prove.
    querySelectorAll(sel) {
      if (/^\.[\w-]+$/.test(sel)) {
        const want = sel.slice(1);
        const out = [];
        const walk = (n) => {
          for (const c of n.children ?? []) {
            if (String(c.className ?? '').split(/\s+/).includes(want)) out.push(c);
            walk(c);
          }
        };
        walk(el);
        return out;
      }
      el._qa ||= {};
      return (el._qa[sel] ||= sel === 'button' ? [makeEl('button'), makeEl('button')] : []);
    },
    closest() { return null; },
    contains() { return false; },
    setAttribute(k, v) { if (k === 'class') el.className = v; },
    getAttribute() { return null; },
    removeAttribute() {},
    focus() {}, blur() {}, scrollIntoView() {}, scrollTo() {},
    // Recorded rather than applied: className is what the tests read, and
    // folding these into it would rewrite the class strings they match on.
    // `_cls` is the record, so "was this element ever put into the rolling
    // state" is answerable without a browser.
    _cls: new Set(),
    classList: {
      add(...cs) { for (const c of cs) el._cls.add(c); },
      remove(...cs) { for (const c of cs) el._cls.delete(c); },
      toggle() {}, contains(c) { return el._cls.has(c); },
    },
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    click() { for (const fn of el._h.click ?? []) fn({ preventDefault() {}, stopPropagation() {} }); },
  };
  return el;
}

export function installDom() {
  globalThis.document = {
    createElement: makeEl,
    createTextNode: (t) => ({ textContent: t, children: [], innerHTML: '' }),
    createDocumentFragment: () => makeEl('fragment'),
    body: makeEl('body'),
    documentElement: makeEl('html'),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
  };
  globalThis.window = globalThis;
  globalThis.innerWidth = 1200;
  globalThis.innerHeight = 900;
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.HTMLElement = function () {};
  // The card database off disk, through the same loadData the app runs.
  globalThis.fetch = async (url) => {
    const file = String(url).split('/').pop();
    try {
      const body = readFileSync(new URL(file, DATA), 'utf8');
      return { ok: true, json: async () => JSON.parse(body), text: async () => body };
    } catch {
      return { ok: false, json: async () => ({}), text: async () => '' };
    }
  };
}

// Bundles combat.ts (and data.ts, for the real cards) into one ESM file node
// can import. `name` keeps the artefacts apart when two tests build their own.
// `extra` names further exports of combat.ts to pull through, for a test that
// needs a plain function beside the class; the whole module comes back as
// `mod`, so nothing has to be listed twice.
export async function loadCombat(name, extra = []) {
  const entry = new URL(`./_${name}.entry.ts`, import.meta.url);
  const out = new URL(`./_${name}.bundle.mjs`, import.meta.url);
  writeFileSync(entry, "export { AttackHelper } from '../src/combat';\nexport { loadData } from '../src/data';\n"
    + (extra.length ? `export { ${extra.join(', ')} } from '../src/combat';\n` : ''));
  await build({
    entryPoints: [fileURLToPath(entry)],
    outfile: fileURLToPath(out),
    bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
    // vite supplies this at build time; the app is served from the root here.
    define: { 'import.meta.env.BASE_URL': '"/"' },
  });
  const mod = await import(`${out.href}?t=${Date.now()}`);
  const data = await mod.loadData();
  const dice = JSON.parse(readFileSync(new URL('dice.json', DATA), 'utf8'));
  return { AttackHelper: mod.AttackHelper, data, dice, mod };
}

// ---------- reading what the window drew ----------
export function findButtons(el, out = []) {
  if (!el) return out;
  if (el.tagName === 'BUTTON') out.push(el);
  for (const c of el.children ?? []) findButtons(c, out);
  return out;
}

export const label = (b) => (b.textContent || b.innerHTML || '').replace(/<[^>]*>/g, '').trim();

export function textOf(el, out = []) {
  if (!el) return out;
  if (el.innerHTML) out.push(String(el.innerHTML));
  if (el.textContent) out.push(String(el.textContent));
  for (const c of el.children ?? []) textOf(c, out);
  return out;
}

// A Mech on the board, intact, with Link to spend.
export function mech(uid, side, name, col) {
  return {
    uid, side, kind: 'mech', cardId: '', label: name, col, row: 1, size: 1, facing: 0,
    aerial: false, stance: 'offensive', link: 3, deployed: true,
    partStates: { torso: 'intact', chasis: 'intact', leftHand: 'intact', rightHand: 'intact', backpack: 'intact' },
    ammo: {}, statuses: [], log: [],
  };
}

// Settles the microtasks the helper's promises resolve through.
export const settle = () => new Promise((r) => setTimeout(r, 20));
