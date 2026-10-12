// AI lab (tools/ai-lab/README.md): the P7D probe harness. Bundles the REAL matchhud.ts
// with the command layer, glue and readers, exposes the module-private
// functions and the module state through an in-memory onLoad hook (the file on
// disk is untouched), and stubs dialog.ts with a scripted answerer. Importing
// the bundle twice gives two independent app instances (two seats in one
// process): each has its own matchhud module state, its own commands hooks and
// its own local seat. A relay passes every command one instance performs to
// the other through applyRemote, the way match.ts relay.onCommand does.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { installDom, makeEl } from './_combatdrive.mjs';

installDom();
globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.location = { search: '', hash: '', href: 'http://localhost/', pathname: '/', origin: 'http://localhost' };
try { Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', clipboard: { writeText: async () => {} } }, configurable: true }); } catch {}
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
{
  const withStyle = (el) => { el.style.setProperty = () => {}; el.style.removeProperty = () => {}; return el; };
  const mk = globalThis.document.createElement;
  globalThis.document.createElement = (tag) => withStyle(mk(tag));
  withStyle(globalThis.document.documentElement);
  withStyle(globalThis.document.body);
  globalThis.document.activeElement = null;
}

// ---------- scripted dialogs ----------
// Every dialog the HUD (or commandpick.ts) asks lands here. A probe pushes
// answers; an unanswered dialog is logged and answered with its cancel.
globalThis.__p7dDialogs = { asked: [], answers: [] };
const DIALOG_STUB = `
const D = globalThis.__p7dDialogs;
function next(kind, o) {
  D.asked.push({ kind, title: o && o.title, body: o && o.body, choices: o && o.choices ? o.choices.map((c) => ({ id: c.id, label: c.label, disabled: !!c.disabled })) : undefined });
  const a = D.answers.length ? D.answers.shift() : undefined;
  return typeof a === 'function' ? a(o) : a;
}
export function choiceDialog(o) { const a = next('choice', o); return Promise.resolve(a === undefined ? null : a); }
export function pickManyDialog(o) { const a = next('pickMany', o); return Promise.resolve(a === undefined ? null : a); }
export async function confirmDialog(o) { const a = next('confirm', o); return a === undefined ? false : !!a; }
export function alertDialog(o) { next('alert', o); return Promise.resolve(); }
export function promptDialog(o) { const a = next('prompt', o); return Promise.resolve(a === undefined ? null : a); }
`;

// ---------- the private surface of matchhud.ts ----------
const EXPOSE = `
export const __p7d = {
  panelHtml, tacticsHtml, feedHtml, secOverlay, timelineHtml, orderFloatHtml,
  actionPanel, reactionPanel, reactionsOwed, revealsOwed, revealPanel, interceptPanel, ewPanel, attackPanel, crushPanel, shovePanel,
  boxDropPanel, boxPickPanel, detonatePanel, launchPanel, terminalPanel, overwatchPanel, setupPanel, endPanel, loopPanel, designatePanel,
  startMovePlan, commitMove, cancelMove, commitWaypoint, previewMove, rotate, advanceCrush, finishCrush, confirmCrushed, placeCrushed, crushEscapes,
  contestAct, syncContest, actionOn, routeAction, openAttackPick, answerReaction, beginIntercept, queueInterceptsFor,
  offerBoxesOn, takeBox, nextBox, endOpportunityNow, dropGrids, dropBase, placeDroppedBox,
  resolveShove, pushOnReady, placeLaunched, finishLaunchPlan, landingCandidates, reachableFor, moveOptsFor,
  renderBoard, boardCallbacks, placeBoxOn, boxPlaceGrids, fitsZone, secondaryRows, settleEndStep: undefined,
  setBoard(b) { board = b; }, setHudRef(c) { hudRef = c; },
  get movePlan() { return movePlan; }, set movePlan(v) { movePlan = v; },
  get crushPlan() { return crushPlan; }, set crushPlan(v) { crushPlan = v; },
  get attackPick() { return attackPick; }, set attackPick(v) { attackPick = v; },
  get ewPick() { return ewPick; }, set ewPick(v) { ewPick = v; },
  get shovePlan() { return shovePlan; }, set shovePlan(v) { shovePlan = v; },
  get pushOn() { return pushOn; },
  get boxPick() { return boxPick; }, get boxDrop() { return boxDrop; },
  get launchPlan() { return launchPlan; }, get detonateNow() { return detonateNow; },
  get terminalPick() { return terminalPick; }, set terminalPick(v) { terminalPick = v; },
  get haltCarry() { return haltCarry; }, get pendingAction() { return pendingAction; },
  get interceptNow() { return interceptNow; }, get interceptPick() { return interceptPick; },
  get overwatchPick() { return overwatchPick; },
  get boxPlace() { return boxPlace; }, set boxPlace(v) { boxPlace = v; },
  get placing() { return placing; }, set placing(v) { placing = v; },
  get pending() { return pending; },
};
`;

const expose = {
  name: 'p7d-expose',
  setup(b) {
    b.onLoad({ filter: /[\\/]src[\\/]matchhud\.ts$/ }, (args) => ({
      contents: readFileSync(args.path, 'utf8') + '\n' + EXPOSE,
      loader: 'ts',
    }));
    b.onLoad({ filter: /[\\/]src[\\/]dialog\.ts$/ }, () => ({ contents: DIALOG_STUB, loader: 'js' }));
  },
};

const entry = new URL('./_p7d_hud.entry.ts', import.meta.url);
const out = new URL('./_p7d_hud.bundle.mjs', import.meta.url);
let built = false;
export async function buildOnce() {
  if (built) return;
  writeFileSync(entry, [
    "export * as H from '../src/matchhud';",
    "export { check, apply, perform, applyRemote, onPerformed, onRefused, onBeforeApply, strictNow } from '../src/commands';",
    "export { setLocalSeat, getLocalSeat } from '../src/loop';",
    "export { loadData } from '../src/data';",
    "export { newScriptState, newOpportunity } from '../src/types';",
    "export * as U from '../src/units';",
    "export * as R from '../src/rules';",
    "export * as T from '../src/tasks';",
    "export * as G from '../src/glue';",
    "export * as S from '../src/setup';",
    "export { boardFingerprint } from '../src/secrecy';",
  ].join('\n') + '\n');
  await build({
    entryPoints: [fileURLToPath(entry)], outfile: fileURLToPath(out),
    bundle: true, format: 'esm', platform: 'browser', logLevel: 'error',
    define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
    plugins: [expose],
  });
  built = true;
}

let instances = 0;
export async function instance(variant = null) {
  await buildOnce();
  instances += 1;
  const href = variant ? variant.href : out.href;
  const M = await import(`${href}?inst=${instances}&t=${Date.now()}`);
  const data = await M.loadData();
  return { M, X: M.H.__p7d, U: M.U, R: M.R, T: M.T, data };
}

// A second bundle with in-memory source patches (a proposal, simulated). The
// files on disk are untouched. `patches`: [{ file: /regex/, find, replace }],
// and each `find` must occur exactly once or the build throws.
export async function buildVariant(name, patches) {
  await buildOnce();
  const vout = new URL(`./_p7d_${name}.bundle.mjs`, import.meta.url);
  const plug = {
    name: 'p7d-variant',
    setup(b) {
      b.onLoad({ filter: /[\\/]src[\\/][\w]+\.ts$/ }, (args) => {
        let src = readFileSync(args.path, 'utf8').split('\r\n').join('\n');
        if (/[\\/]src[\\/]dialog\.ts$/.test(args.path)) return { contents: DIALOG_STUB, loader: 'js' };
        for (const p of patches) {
          if (!p.file.test(args.path)) continue;
          const n = src.split(p.find).length - 1;
          if (n !== 1) throw new Error(`patch for ${args.path} matched ${n} times: ${p.find.slice(0, 80)}`);
          src = src.replace(p.find, p.replace);
        }
        if (/[\\/]src[\\/]matchhud\.ts$/.test(args.path)) src += '\n' + EXPOSE;
        return { contents: src, loader: 'ts' };
      });
    },
  };
  await build({
    entryPoints: [fileURLToPath(entry)], outfile: fileURLToPath(vout),
    bundle: true, format: 'esm', platform: 'browser', logLevel: 'error',
    define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
    plugins: [plug],
  });
  return vout;
}

export const dice = JSON.parse(readFileSync(new URL('../../data/dice.json', import.meta.url), 'utf8'));
export const yellowFace = (type) => dice.dice.yellow.faces.findIndex((f) => f.length === 1 && f[0].type === type && !f[0].hollow);
export const LIGHT = yellowFace('lightning');
export const BLANK = dice.dice.yellow.faces.findIndex((f) => f.length === 0);

// ---------- a stub Board ----------
// Records what the HUD lights and keeps the click callbacks, so a probe can
// "click" a lit cell the way a player would. animateMove runs its callback
// at once (the SVG walk is animation only).
export function stubBoard() {
  const rec = { calls: [], reachable: null, targets: null, onTarget: null, movePath: null };
  const handler = {
    get(_t, p) {
      if (p === '__rec') return rec;
      if (p === 'panEnabled') return rec.pan ?? true;
      if (p === 'animateMove') return (uid, stops, cb) => { rec.calls.push(['animateMove', uid, stops]); cb?.(); };
      if (p === 'showReachable') return (grids, steps) => { rec.reachable = grids; rec.calls.push(['showReachable', grids.length, steps]); };
      if (p === 'showSmokeTargets') return (cells, cb) => { rec.targets = cells; rec.onTarget = cb; rec.calls.push(['showSmokeTargets', cells.length]); };
      if (p === 'showMovePath') return (path, side, ok) => { rec.movePath = path; };
      if (p === 'clearHighlights') return () => { rec.targets = null; rec.onTarget = null; rec.reachable = null; };
      return () => {};
    },
    set(_t, p, v) { if (p === 'panEnabled') rec.pan = v; return true; },
  };
  return new Proxy({}, handler);
}

// ---------- a tiny DOM for the rendered panel ----------
// The HUD writes its panel as an HTML string and wireHud binds click handlers
// by attribute selector. This parses the start tags of the string into fake
// elements carrying their data-* attributes, so root.querySelectorAll finds
// them and a probe presses one with .click().
const unesc = (s) => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
function parseTags(html) {
  const out = [];
  const re = /<([a-zA-Z][\w-]*)((?:\s+[^\s=>"']+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = {};
    const ar = /([^\s=>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let a;
    while ((a = ar.exec(m[2]))) attrs[a[1]] = unesc(a[2] ?? a[3] ?? a[4] ?? '');
    // the text up to the closing tag, roughly, for labels
    const rest = html.slice(re.lastIndex, re.lastIndex + 600);
    const closer = m[1].toLowerCase() === 'button' ? /<\/button>/ : /<\/(?:button|a|label|option|span|div|p)>/;
    const text = rest.split(closer)[0].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    out.push({ tag: m[1].toLowerCase(), attrs, text });
  }
  return out;
}
function toEl(t) {
  const el = makeEl(t.tag);
  el._attrs = t.attrs;
  el.textContent = t.text;
  for (const [k, v] of Object.entries(t.attrs)) {
    if (k.startsWith('data-')) el.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
  }
  if ('disabled' in t.attrs) el.disabled = true;
  el.getAttribute = (k) => (k in t.attrs ? t.attrs[k] : null);
  el.value = t.attrs.value ?? '';
  return el;
}
function matches(t, sel) {
  const parts = sel.split(',').map((x) => x.trim());
  return parts.some((p) => {
    if (p.startsWith('#')) return t.attrs.id === p.slice(1);
    const m = /^(?:([a-z]+))?((?:\[[^\]]+\])*)$/i.exec(p);
    if (!m) return false;
    if (m[1] && m[1].toLowerCase() !== t.tag) return false;
    const conds = [...m[2].matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
    if (!conds.length && !m[1]) return false;
    return conds.every(([, k, v]) => k in t.attrs && (v === undefined || t.attrs[k] === v));
  });
}
export function panelRoot(html) {
  const tags = parseTags(html);
  const els = tags.map(toEl);
  const root = makeEl('div');
  root.querySelectorAll = (sel) => els.filter((el, i) => matches(tags[i], sel));
  root.querySelector = (sel) => els.find((el, i) => matches(tags[i], sel)) ?? null;
  root._tags = tags;
  root._els = els;
  return root;
}

// ---------- a client: one seat's page ----------
export async function client(seat, opts = {}) {
  const I = await instance(opts.variant ?? null);
  const { M, X, data } = I;
  const c = {
    ...I, seat, state: null, notes: [], sent: [], refused: [], root: null, html: '',
    board: stubBoard(),
    rolls: [],   // queued faces for rollHits: arrays of face indices
  };
  M.onRefused((why) => c.refused.push(why));
  c.ctx = {
    data, get state() { return c.state; }, seat, networked: !!seat,
    send(cmd) {
      const v = M.perform(data, c.state, cmd);
      c.sent.push({ cmd: JSON.parse(JSON.stringify(cmd)), ok: v.ok, why: v.why });
      if (v.ok) {
        M.H.glueAfter(data, c.state, cmd);
        M.H.offerCoordinationAfterManeuver(cmd);
      }
      return v;
    },
    check: (cmd) => M.check(data, c.state, cmd),
    rollHits: async (n) => {
      const q = c.rolls.length ? c.rolls.shift() : Array(n).fill(BLANK);
      const faces = Array.isArray(q) ? q : q.faces;
      const hits = Array.isArray(q) ? faces.map(() => 0) : q.hits;
      return { hits, dice: faces.map((f) => ({ color: 'yellow', face: f })) };
    },
    rollPool: async () => {}, rollDefense: async () => [],
    diceFeed: [], noteNow: (text, kind) => c.notes.push(`[${kind ?? 'refused'}] ${text}`),
    zonesOn: false, toggleZones() {}, mountSide() {}, syncSide() {}, combatBusy: () => false, syncCombatMirror: () => false,
    startAttack: (...a) => c.notes.push(`startAttack ${JSON.stringify(a)}`),
    showTab() {}, diceData: dice, recordMatch: async () => null,
    refresh: () => c.render(),
  };
  c.render = () => {
    X.setBoard(c.board);
    X.setHudRef(c.ctx);
    M.setLocalSeat(seat);
    c.html = [X.panelHtml(c.ctx), X.tacticsHtml(c.ctx), X.feedHtml(c.ctx), X.secOverlay(c.ctx), X.orderFloatHtml(c.ctx)].join('\n');
    c.root = panelRoot(c.html);
    M.H.wireHud(c.root, c.ctx);
    X.renderBoard(c.ctx);
    return c.html;
  };
  c.use = () => { X.setBoard(c.board); X.setHudRef(c.ctx); M.setLocalSeat(seat); };
  c.buttons = () => c.root._tags.filter((t) => t.tag === 'button').map((t) => ({ text: t.text, ...t.attrs }));
  c.press = (sel) => {
    c.use();
    const el = c.root.querySelector(sel);
    if (!el) return false;
    // A truly disabled button hears no click in a browser.
    if (el.disabled) return 'disabled';
    el.click();
    return true;
  };
  return c;
}

// Two seats, relayed: whatever one performs lands on the other through
// applyRemote and glueAfter, as match.ts relay.onCommand does.
export function relay(a, b) {
  const log = [];
  const hook = (from, to) => (cmd) => {
    // The server takes only commands sent as the sender's own squad (the
    // relay rule commands.ts ATTRIBUTED and onBehalf are written around): one
    // sent under the other seat applied on the sender's board and never
    // reached the other.
    if (cmd.seat !== from.seat) {
      log.push({ from: from.seat, kind: cmd.kind, ok: false, why: `DROPPED by the relay: sent as ${cmd.seat} from ${from.seat}` });
      return;
    }
    const was = to.M.getLocalSeat();
    to.M.setLocalSeat(to.seat);
    const v = to.M.applyRemote(to.data, to.state, JSON.parse(JSON.stringify(cmd)));
    if (v.ok) to.M.H.glueAfter(to.data, to.state, cmd);
    log.push({ from: from.seat, kind: cmd.kind, ok: v.ok, why: v.why });
    to.M.setLocalSeat(was);
  };
  a.M.onPerformed(hook(a, b));
  b.M.onPerformed(hook(b, a));
  return log;
}

export function reporter() {
  let pass = 0, fail = 0;
  const lines = [];
  const show = (k, v) => { const l = `${k}: ${JSON.stringify(v)}`; lines.push(l); console.log(l); };
  const expect = (name, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    const ok = g === w;
    if (ok) pass++; else fail++;
    const l = `  ${ok ? 'as expected' : 'DIFFERS'}  ${name}${ok ? '' : `\n       expected ${w}, got ${g}`}`;
    lines.push(l); console.log(l);
  };
  return { show, expect, done: () => console.log(`\n${pass} as expected, ${fail} differ`) };
}

// A strict scripted table in the Action Phase, the way a Match Centre room
// holds one after setup.
export function table(M, over = {}) {
  return {
    v: 3, map: 'none', tokens: [], nextUid: 1,
    round: { n: 1, phase: 2, firstPlayer: 's1' },
    commandTokens: { s1: 0, s2: 0 },
    script: { ...M.newScriptState('s1'), strict: true },
    setup: { stage: 'done', rolls: { s1: [], s2: [] }, edge: { s1: 'white', s2: 'black' }, placed: { s1: 0, s2: 0 } },
    ...over,
  };
}
export const G = (c, r) => ({ col: c * 3, row: r * 3 });
export const L = (extra = {}) => ({ torso: '012', chasis: '020', leftHand: '041', rightHand: '058', backpack: '', pilot: 'FPA-04-2', ...extra });
export function put(I, s, side, loadout, c, r, extra = {}) {
  const t = { ...I.U.makeMechToken(s, I.data, loadout, side), ...G(c, r), facing: 0, deployed: true, statuses: [], log: [], ...extra };
  s.tokens.push(t);
  return t;
}
export function droneOn(I, s, side, cardId, c, r, extra = {}) {
  const t = { ...I.U.makeDroneToken(s, I.data, I.data.byId.get(cardId), side), ...G(c, r), facing: 0, deployed: true, statuses: [], log: [], ...extra };
  s.tokens.push(t);
  return t;
}
// The same board on both seats: a deep copy for the second.
export const clone = (s) => JSON.parse(JSON.stringify(s));

export const settle = () => new Promise((r) => setTimeout(r, 15));

// Two seats around one board: `build(I)` lays the table with the first
// instance's readers and returns { s, ...refs }; the second seat gets a copy.
export async function room(build, opts = {}) {
  const A = await client('s1', opts);
  const B = await client('s2', opts);
  const setup = build(A);
  A.state = setup.s;
  B.state = clone(setup.s);
  const log = relay(A, B);
  return { A, B, log, ...setup };
}
export const agree = (A, B) => A.M.boardFingerprint(A.state) === B.M.boardFingerprint(B.state);

// A shared Counter-roll driven to its verdict through contestAct, the window's
// one door: each seat rolls its own hand and declares its own Focus, in the
// FAQ G4 order counterStage reads. The Terminal's hand is the opponent's.
export async function contest(A, B, { init, resp, focus = {} }) {
  const bySeat = (seat) => (seat === A.seat ? A : B);
  const c0 = A.state.script.counter;
  if (!c0) return 'no counter open';
  const initT = A.state.tokens.find((t) => t.uid === c0.initiatorUid);
  const I = bySeat(initT.side);
  const R = I === A ? B : A;
  I.rolls.push(init); I.use(); I.X.contestAct(I.ctx, 'roll', { uid: c0.initiatorUid });
  await settle();
  R.rolls.push(resp); R.use();
  R.X.contestAct(R.ctx, 'roll', { uid: c0.terminal !== undefined ? A.T.TERMINAL_UID : c0.responderUid });
  await settle();
  for (let i = 0; i < 6; i++) {
    const c = A.state.script.counter;
    if (!c) return 'closed';
    const st = A.U.counterStage(A.data, A.state.tokens, c);
    if (st === 'declareI') { I.use(); I.X.contestAct(I.ctx, 'declare', { uid: c.initiatorUid, use: !!focus.init }); }
    else if (st === 'declareR') { R.use(); R.X.contestAct(R.ctx, 'declare', { uid: c.responderUid, use: !!focus.resp }); }
    else if (st === 'rerollI') { I.use(); I.X.contestAct(I.ctx, 'focus', { uid: c.initiatorUid, indices: [] }); }
    else if (st === 'rerollR') { R.use(); R.X.contestAct(R.ctx, 'focus', { uid: c.responderUid, indices: [] }); }
    else return st;
    await settle();
  }
  return 'stuck';
}
