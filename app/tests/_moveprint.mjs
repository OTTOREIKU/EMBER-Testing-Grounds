// AI lab (tools/ai-lab/README.md): what the Match Centre's move planner SENDS, over a
// matrix of tables, written to a file so a lift out of commitMove can be
// proven to change nothing. Run before and after:
//   node tests/_moveprint.mjs <out.json>
// Every trial opens the planner the way a player does (the Maneuver, a
// Movement Action's row, a Go on after a Mine, a steered unit), draws a route
// to a Grid the board lights, turns or not, and commits. What is printed is
// everything the commit did: the commands with their verdicts, the notes, the
// walk the board was handed, and the tools left open (a Crush, a held Mine
// stop, a Box).
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { client, clone } from './_p7d_lib.mjs';
import { loadEngine, tableAtRoundOne } from './_engine.mjs';

const out = process.argv[2];
if (!out) { console.error('usage: node tests/_moveprint.mjs <out.json>'); process.exit(2); }

const rng = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const { M, data } = await loadEngine('moveprint');
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
let trials = 0;
const kinds = {};

// One commit: the planner is open on `C`, the route is drawn to (c, r) when a
// Grid is given, `turns` quarter turns are made, and the plan is committed.
function commit(tag, C, grid, turns) {
  const X = C.X;
  const before = X.movePlan ? { steps: X.movePlan.steps, flying: X.movePlan.flying, label: X.movePlan.label, optional: !!X.movePlan.flightOptional } : null;
  let drew = null;
  try {
    if (grid && X.movePlan) {
      X.previewMove(C.ctx, grid.c, grid.r);
      drew = X.movePlan?.preview ? X.movePlan.preview.map((g) => `${g.c},${g.r}`) : null;
      X.commitWaypoint(C.ctx);
    }
    for (let i = 0; i < Math.abs(turns); i++) X.rotate(C.ctx, turns > 0 ? 1 : 3);
    C.sent = [];
    C.board.__rec.calls = [];
    const notesAt = C.notes.length;
    X.commitMove(C.ctx);
    put(tag, {
      before, drew,
      sent: C.sent,
      notes: C.notes.slice(notesAt),
      walk: C.board.__rec.calls.filter((x) => x[0] === 'animateMove'),
      plan: X.movePlan ? { path: X.movePlan.path, facing: X.movePlan.facing } : null,
      crush: X.crushPlan,
      halt: X.haltCarry,
      pending: X.pendingAction,
      box: X.boxPick,
      shove: X.shovePlan,
      at: (() => { const t = C.state.tokens.find((x) => x.uid === (before ? C.ctx.state.script?.opp?.uid : -1)); return t ? [t.col, t.row, t.facing] : null; })(),
      opp: C.state.script?.opp ?? null,
    });
  } catch (e) {
    put(tag, `THROW ${e.message}`);
  }
  trials++;
}

// Everything one unit may do with a Movement from this table.
function unitMoves(tag, state, holder, o, R) {
  const C = holder.side === 's1' ? A : B;
  const fresh = () => {
    C.M.H.resetHudTools();
    C.state = clone(state);
    C.state.script.opp = clone(o);
    // The holder is the Mech whose turn it is: the glue re-derives the
    // Opportunity from the activation order, so the others have acted.
    if (holder.kind === 'mech') C.state.script.acted = state.tokens.filter((x) => x.kind === 'mech' && x.uid !== holder.uid).map((x) => x.uid);
    C.sent = []; C.notes = [];
    globalThis.__p7dDialogs.asked = []; globalThis.__p7dDialogs.answers = [];
    C.render();
    return C.state.tokens.find((x) => x.uid === holder.uid);
  };
  // The doors into the planner.
  const doors = [];
  doors.push(['maneuver', (t) => C.X.startMovePlan(C.ctx, t, { label: t.kind === 'mech' ? 'Maneuver' : 'Movement', maneuver: true })]);
  {
    const t = fresh();
    const live = [...C.html.matchAll(/<button class="actrow[^>]*data-doact="([^"]+)"[^>]*>/g)].filter((m) => !m[0].includes('aria-disabled')).map((m) => m[1]);
    for (const key of live) {
      const a = C.X.actionOn(C.ctx, t, key);
      if (a?.type !== 'Moving') continue;
      doors.push([`action:${key}`, () => { C.press(`[data-doact="${key}"]`); }]);
    }
  }
  if (o.mineHalt) doors.push(['goon', (t) => C.X.startMovePlan(C.ctx, t, { label: 'Go on', range: o.mineHalt, resume: true })]);
  // Steered by the other squad's first Mech (The Red Shoes): the command it
  // sends is what is pinned, whatever the engine then makes of it.
  const ctl = state.tokens.find((x) => x.kind === 'mech' && x.side !== holder.side);
  if (ctl && holder.kind === 'mech') doors.push(['steered', (t) => C.X.startMovePlan(C.ctx, t, { controller: { uid: ctl.uid, side: ctl.side } })]);

  for (const [door, open] of doors) {
    kinds[door.split(':')[0]] = (kinds[door.split(':')[0]] ?? 0) + 1;
    let t = fresh();
    try { open(t); } catch (e) { put(`${tag}|${door}|open`, `THROW ${e.message}`); continue; }
    const plan = C.X.movePlan;
    put(`${tag}|${door}|open`, { plan: plan ? { steps: plan.steps, flying: plan.flying, optional: !!plan.flightOptional, free: !!plan.free, label: plan.label } : null, notes: C.notes, pending: C.X.pendingAction });
    if (!plan) continue;
    const reach = C.X.reachableFor(C.ctx, t, plan.steps, plan.flying, plan.actionId).map((g) => ({ c: g.c, r: g.r }));
    // Every Grid up to a dozen, then a seeded dozen of the rest.
    const picked = reach.length <= 12 ? reach : [...reach].sort(() => R() - 0.5).slice(0, 12);
    for (const g of picked) {
      for (const turns of [0, 1]) {
        t = fresh();
        try { open(t); } catch { continue; }
        commit(`${tag}|${door}|to ${g.c},${g.r}|turn ${turns}`, C, g, turns);
      }
    }
    // Turning on the spot: a quarter, a half, back the other way, a full circle.
    for (const turns of [0, 1, 2, -1, 4]) {
      t = fresh();
      try { open(t); } catch { continue; }
      commit(`${tag}|${door}|pivot ${turns}`, C, null, turns);
    }
    // A route of two legs: the nearest lit Grid, then the furthest.
    if (reach.length > 3) {
      t = fresh();
      try {
        open(t);
        const first = reach[0];
        C.X.previewMove(C.ctx, first.c, first.r);
        C.X.commitWaypoint(C.ctx);
        commit(`${tag}|${door}|two legs`, C, reach[reach.length - 1], 0);
      } catch (e) { put(`${tag}|${door}|two legs`, `THROW ${e.message}`); }
    }
  }
  C.M.H.resetHudTools();
}

for (const scenario of data.solo.scenarios) {
  const base = tableAtRoundOne(M, data, scenario);
  if (base.refused.length) throw new Error(`setup refused: ${base.refused.join('; ')}`);
  const plan = clone(base.state);
  turnPhase(plan);
  const R = rng(scenario.id.length * 104729 + 5);
  for (let n = 0; n < 16; n++) {
    const s = clone(plan);
    const taken = new Set();
    // Half the tables crowd the units into a small box: Break Away, a Crush
    // and a blocked Grid all live where units stand next to each other.
    const span = n % 2 ? 4 : 8;
    const off = n % 2 ? 4 : 2;
    for (const t of s.tokens) {
      let c, r;
      do { c = off + Math.floor(R() * span); r = off + Math.floor(R() * span); } while (taken.has(`${c},${r}`));
      taken.add(`${c},${r}`);
      t.col = c * 3; t.row = r * 3;
      t.facing = Math.floor(R() * 4);
      if (t.kind === 'mech') {
        t.stance = R() < 0.06 ? 'shutdown' : STANCES[Math.floor(R() * 3)];
        t.timing = TIMINGS[Math.floor(R() * 6)];
        t.link = R() < 0.2 ? Math.floor(R() * 4) : t.link;
        for (const slot of SLOTS) { const x = R(); if (x < 0.07) t.partStates[slot] = 'destroyed'; else if (x < 0.2) t.partStates[slot] = 'damaged'; }
        if (t.partStates.torso === 'destroyed') t.partStates.torso = 'damaged';
      }
      const st = R();
      if (st < 0.05) t.statuses = [...(t.statuses ?? []), 'immobilized'];
      else if (st < 0.1) t.statuses = [...(t.statuses ?? []), 'camouflage'];
    }
    // One table in three is mined: a GM-35 of each squad on a free Grid.
    if (n % 3 === 0) {
      for (const side of ['s1', 's2']) {
        let c, r;
        do { c = off + Math.floor(R() * span); r = off + Math.floor(R() * span); } while (taken.has(`${c},${r}`));
        taken.add(`${c},${r}`);
        const mine = M.U.makeDroneToken(s, data, data.byId.get('074'), side);
        s.tokens.push({ ...mine, col: c * 3 + 1, row: r * 3 + 1, facing: 0 });
      }
    }
    // The Action Phase: each Mech with the Opportunity, fresh and with a Mine's
    // stop to go on from.
    s.round.phase = 2;
    s.script.stage = `${s.round.n}:2`;
    s.script.acted = [];
    s.script.revealed = ['s1', 's2'];
    for (const t of s.tokens.filter((x) => x.kind === 'mech')) {
      const o = M.TY.newOpportunity(t.uid, t.timing);
      o.extras = M.U.extrasFor(data, t);
      o.stanceLocked = true;
      unitMoves(`${scenario.id}|${n}|${t.label}|fresh`, s, t, o, R);
      // Past its Starting Action, so every Movement Action it has is on offer.
      unitMoves(`${scenario.id}|${n}|${t.label}|started`, s, t, { ...o, started: true }, R);
      if (n % 4 === 0) unitMoves(`${scenario.id}|${n}|${t.label}|halted`, s, t, { ...o, maneuver: 0, maneuvered: true, moved: true, mineHalt: 2 }, R);
    }
    // The Command Phase: each Drone holding a Command.
    const cmd = clone(s);
    cmd.round.phase = 0;
    cmd.script.stage = `${cmd.round.n}:0`;
    cmd.script.acted = [];
    cmd.script.passed = [];
    for (const d of cmd.tokens.filter((x) => x.kind === 'drone' && !M.U.isMine?.(data.byId.get(x.cardId)))) {
      unitMoves(`${scenario.id}|${n}|${d.label}|commanded`, cmd, d, M.TY.newOpportunity(d.uid, undefined), R);
    }
  }
}

writeFileSync(out, JSON.stringify({ prints, full }));
const throws = Object.values(full).filter((x) => x.startsWith('THROW')).length;
const sentKinds = {};
let crushes = 0, halts = 0, links = 0, refusedSends = 0;
for (const v of Object.values(full)) {
  if (v.startsWith('THROW')) continue;
  const p = JSON.parse(v);
  for (const x of p.sent ?? []) { sentKinds[x.cmd.kind] = (sentKinds[x.cmd.kind] ?? 0) + 1; if (!x.ok) refusedSends++; if (x.cmd.halt !== undefined) halts++; if (x.cmd.breakAwayLink) links++; }
  if (p.crush) crushes++;
}
console.log(`${Object.keys(prints).length} prints, ${trials} commits; ${throws} threw; doors ${JSON.stringify(kinds)}`);
console.log(`sent ${JSON.stringify(sentKinds)}; refused ${refusedSends}; crush plans ${crushes}; mine stops ${halts}; Link paid ${links}; written to ${out}`);
if (throws) console.log([...new Set(Object.entries(full).filter(([, v]) => v.startsWith('THROW')).map(([k, v]) => `${k.split('|').slice(-2).join('|')}: ${v}`))].slice(0, 12).join('\n'));
process.exit(0);
