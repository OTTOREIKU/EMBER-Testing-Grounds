// AI lab (tools/ai-lab/README.md): what the Match Centre's turn panels say, over a matrix
// of tables, written to a file so a refactor of matchhud.ts can be proven to
// change nothing. Run before and after:
//   node tests/_hudprint.mjs <out.json>
// The matrix is the copied solo setup with its units thrown around the middle
// of the board by a seeded generator: stances, facings, damage and statuses
// vary, and each unit takes the Opportunity in turn, fresh and part-spent.
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { client, clone } from './_p7d_lib.mjs';
import { loadEngine, tableAtRoundOne } from './_engine.mjs';

const out = process.argv[2];
if (!out) { console.error('usage: node tests/_hudprint.mjs <out.json>'); process.exit(2); }

const rng = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const { M, data } = await loadEngine('hudprint');
// loadEngine installs the DOM shim afresh, which drops what _p7d_lib added.
for (const el of [globalThis.document.documentElement, globalThis.document.body]) {
  el.style.setProperty = () => {};
  el.style.removeProperty = () => {};
}
const A = await client('s1');
const B = await client('s2');
const prints = {};
const full = {};
const put = (key, value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  prints[key] = createHash('sha1').update(text).digest('hex').slice(0, 16);
  full[key] = text;
};

const send = (state, cmd) => {
  const v = M.C.check(data, state, cmd);
  if (!v.ok) return v;
  M.C.perform(data, state, cmd);
  M.G.glueAfter(data, state, cmd);
  return v;
};
const turnPhase = (state) => {
  if (M.L.isLoopPhase(M.TY.PHASES[state.round.phase])) for (const seat of ['s1', 's2']) send(state, { kind: 'passTurn', seat });
  for (const seat of ['s1', 's2']) send(state, { kind: 'setReady', seat, ready: true });
  return send(state, { kind: 'advancePhase', seat: 's2' });
};

const TIMINGS = ['swift', 'melee', 'projectile', 'firing', 'movement', 'tactical'];
const STANCES = ['defensive', 'mobility', 'offensive'];
const SLOTS = ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack'];

function panelsFor(tag, state) {
  for (const C of [A, B]) {
    C.state = clone(state);
    C.use();
    C.X.attackPick = null;
    try { put(`${tag}|panel|${C.seat}`, C.X.panelHtml(C.ctx)); } catch (e) { put(`${tag}|panel|${C.seat}`, `THROW ${e.message}`); }
  }
}

function unitPrints(tag, state, holder, o) {
  const C = holder.side === 's1' ? A : B;
  C.state = clone(state);
  C.state.script.opp = clone(o);
  C.use();
  const s = C.state;
  const t = s.tokens.find((x) => x.uid === holder.uid);
  const ctx = C.ctx;
  const safe = (key, fn) => { try { put(key, fn()); } catch (e) { put(key, `THROW ${e.message}`); } };
  C.X.attackPick = null;
  safe(`${tag}|panel`, () => C.X.panelHtml(ctx));
  safe(`${tag}|reach`, () => C.X.reachableFor(ctx, t).map((g) => `${g.c},${g.r}`).sort());
  for (const flying of [false, true]) {
    safe(`${tag}|opts|${flying}`, () => {
      const o2 = C.X.moveOptsFor(ctx, t, flying);
      const grid = [];
      for (let c = 0; c < 12; c++) for (let r = 0; r < 12; r++) {
        grid.push([o2.exitCost ? o2.exitCost(c, r) : '-', o2.crushable ? o2.crushable(c, r) : '-', o2.allowed ? o2.allowed(c, r) : '-',
          o2.stop ? o2.stop(c, r) : '-', o2.landing ? o2.landing(c, r) : '-'].join(''));
      }
      return { grid, phase: !!o2.phaseThrough, straight: o2.straightBonus ?? null, link: o2.linkPay ? [o2.linkPay.budget, typeof o2.linkPay.payable] : null };
    });
  }
  const acts = C.U.guidedActions(C.data, t, { tokens: s.tokens, terrain: [] });
  const common = t.kind === 'mech' ? C.data.commonActions : [];
  for (const g of acts) {
    const a = g.action;
    if (a.type === 'Passive' || a.speed === 'passive') continue;
    safe(`${tag}|actionOn|${a.id}`, () => { const x = C.X.actionOn(ctx, t, g.partKey); return x ? [x.id, x.range, x.yellowDice, x.redDice, x.type] : null; });
    if (a.type === 'Firing' || a.type === 'Melee') {
      C.X.attackPick = { uid: t.uid, actionId: a.id };
      safe(`${tag}|attack|${a.id}`, () => C.X.attackPanel(ctx));
      C.X.attackPick = { uid: t.uid, actionId: a.id, twoHanded: 'declined' };
      safe(`${tag}|attack1h|${a.id}`, () => C.X.attackPanel(ctx));
      C.X.attackPick = null;
    }
    if (a.type === 'Moving') {
      safe(`${tag}|reach|${a.id}`, () => C.X.reachableFor(ctx, t, a.range || undefined, undefined, a.id).map((x) => `${x.c},${x.r}`).sort());
    }
    if (a.type === 'Projectile' && g.projectiles?.length) {
      safe(`${tag}|landing|${a.id}`, () => {
        C.M.H.startLaunchPlan(t.uid, a.id, g.projectiles[0].id, 'x');
        const cands = C.X.launchPlan ? C.X.landingCandidates(ctx).map((x) => `${x.c},${x.r}`).sort() : 'no plan';
        const html = C.X.launchPlan ? C.X.launchPanel(ctx) : '';
        C.M.H.resetHudTools();
        return { cands, html };
      });
    }
  }
  for (const a of common) {
    if (a.type !== 'Melee' && a.type !== 'Firing') continue;
    C.X.attackPick = { uid: t.uid, actionId: a.id };
    safe(`${tag}|attack|${a.id}`, () => C.X.attackPanel(ctx));
    C.X.attackPick = null;
  }
  C.M.H.resetHudTools();
  // PRESSES: every live Action row pressed on a fresh copy of the table, and
  // what the page did about it: the commands it sent, what it said, the Ticks
  // it is holding, and the panel it is showing now (the tool it opened).
  if (process.env.PRESS !== '0') {
    C.state = clone(state);
    C.state.script.opp = clone(o);
    const first = C.render();
    const live = [...first.matchAll(/<button class="actrow[^>]*data-doact="([^"]+)"[^>]*>/g)].filter((m) => !m[0].includes('aria-disabled')).map((m) => m[1]);
    for (const key of live) {
      C.M.H.resetHudTools();
      C.state = clone(state);
      C.state.script.opp = clone(o);
      C.sent = []; C.notes = [];
      globalThis.__p7dDialogs.asked = []; globalThis.__p7dDialogs.answers = [];
      C.render();
      const went = C.press(`[data-doact="${key}"]`);
      pressed.push([`${tag}|press|${key}`, C, went]);
      // Read at once: the dialogs these rows open answer on a later tick, and
      // the tool state is what is being pinned, not the answer.
      let html = '';
      try { C.use(); html = C.X.panelHtml(C.ctx); } catch (e) { html = `THROW ${e.message}`; }
      put(`${tag}|press|${key}`, { went, sent: C.sent, notes: C.notes, pending: C.X.pendingAction, asked: globalThis.__p7dDialogs.asked.map((d) => d.title), html });
    }
    C.M.H.resetHudTools();
  }
}
const pressed = [];

let made = 0;
for (const scenario of data.solo.scenarios) {
  const base = tableAtRoundOne(M, data, scenario);
  if (base.refused.length) throw new Error(`setup refused: ${base.refused.join('; ')}`);
  panelsFor(`${scenario.id}|command`, base.state);
  // The Command Phase with a Drone designated.
  {
    const s = clone(base.state);
    const drone = s.tokens.find((t) => t.kind === 'drone');
    send(s, { kind: 'passTurn', seat: 's1' });
    const v = send(s, { kind: 'designate', seat: 's2', uid: drone.uid });
    panelsFor(`${scenario.id}|command-designated-${v.ok}`, s);
    if (v.ok) for (const d of s.tokens.filter((t) => t.kind === 'drone')) unitPrints(`${scenario.id}|cmd|${d.label}`, s, d, { ...s.script.opp, uid: d.uid });
  }
  const plan = clone(base.state);
  turnPhase(plan);
  panelsFor(`${scenario.id}|planning`, plan);
  const R = rng(scenario.id.length * 7919 + 17);
  for (let n = 0; n < 40; n++) {
    const s = clone(plan);
    const taken = new Set();
    for (const t of s.tokens) {
      let c, r;
      do { c = 2 + Math.floor(R() * 8); r = 2 + Math.floor(R() * 8); } while (taken.has(`${c},${r}`));
      // One in five shares a neighbour's Grid edge: adjacency is where Melee,
      // Break Away and Crush live.
      taken.add(`${c},${r}`);
      t.col = c * 3; t.row = r * 3;
      t.facing = Math.floor(R() * 4);
      if (t.kind === 'mech') {
        t.stance = R() < 0.08 ? 'shutdown' : STANCES[Math.floor(R() * 3)];
        t.timing = TIMINGS[Math.floor(R() * 6)];
        t.link = R() < 0.2 ? Math.floor(R() * 4) : t.link;
        for (const slot of SLOTS) { const x = R(); if (x < 0.07) t.partStates[slot] = 'destroyed'; else if (x < 0.2) t.partStates[slot] = 'damaged'; }
        if (t.partStates.torso === 'destroyed') t.partStates.torso = 'damaged';
        if (R() < 0.3 && t.ammo) for (const k of Object.keys(t.ammo)) t.ammo[k] = Math.floor(R() * 5);
        if (R() < 0.15) t.charge = [SLOTS[1 + Math.floor(R() * 4)]];
      } else if (R() < 0.15) {
        t.partStates.main = 'damaged';
      }
      const st = R();
      if (st < 0.06) t.statuses = [...(t.statuses ?? []), 'immobilized'];
      else if (st < 0.12) t.statuses = [...(t.statuses ?? []), 'fci'];
      else if (st < 0.18) t.statuses = [...(t.statuses ?? []), 'highlight'];
      else if (st < 0.22) t.statuses = [...(t.statuses ?? []), 'camouflage'];
    }
    s.round.phase = 2;
    s.script.stage = `${s.round.n}:2`;
    s.script.acted = [];
    s.script.revealed = ['s1', 's2'];
    for (const t of s.tokens.filter((x) => x.kind === 'mech')) {
      const fresh = M.TY.newOpportunity(t.uid, t.timing);
      fresh.extras = M.U.extrasFor(data, t);
      const variants = [
        ['fresh', fresh],
        ['moved', { ...fresh, maneuver: 0, maneuvered: true, moved: true, stanceLocked: true }],
        ['acted', { ...fresh, action: 1, started: true, stanceLocked: true, performed: [] }],
        ['spent', { ...fresh, maneuver: 0, action: 0, started: true, stanceLocked: true }],
      ];
      for (const [name, o] of variants) { unitPrints(`${scenario.id}|${n}|${t.label}|${name}`, s, t, o); made++; }
    }
    // The Automatic Phase with each Drone designated in turn.
    const auto = clone(s);
    auto.round.phase = 3;
    auto.script.stage = `${auto.round.n}:3`;
    auto.script.acted = [];
    auto.script.passed = [];
    auto.script.opp = null;
    panelsFor(`${scenario.id}|${n}|automatic`, auto);
    for (const d of auto.tokens.filter((x) => x.kind === 'drone')) {
      unitPrints(`${scenario.id}|${n}|auto|${d.label}`, auto, d, M.TY.newOpportunity(d.uid, undefined));
      made++;
    }
    // And the End Phase.
    const end = clone(s);
    end.round.phase = 5;
    end.script.stage = `${end.round.n}:5`;
    end.script.opp = null;
    panelsFor(`${scenario.id}|${n}|end`, end);
  }
}

writeFileSync(out, JSON.stringify({ prints, full }));
const throws = Object.values(full).filter((x) => x.startsWith('THROW')).length;
console.log(`${Object.keys(prints).length} prints over ${made} unit states; ${throws} threw; written to ${out}`);
if (throws) console.log([...new Set(Object.entries(full).filter(([, v]) => v.startsWith('THROW')).map(([k, v]) => `${k.split('|').slice(-2).join('|')}: ${v}`))].slice(0, 12).join('\n'));
process.exit(0);
