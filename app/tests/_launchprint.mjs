// AI lab (tools/ai-lab/README.md): what the Match Centre does when a Projectile is
// launched and when one detonates, over a matrix of tables, written to a file
// so a lift out of placeLaunched / finishLaunchPlan / detonatePanel can be
// proven to change nothing. Run before and after:
//   node tests/_launchprint.mjs <out.json>
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { client, clone } from './_p7d_lib.mjs';
import { loadEngine, tableAtRoundOne } from './_engine.mjs';

const out = process.argv[2];
if (!out) { console.error('usage: node tests/_launchprint.mjs <out.json>'); process.exit(2); }

const rng = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const { M, data } = await loadEngine('launchprint');
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

// A Mech carrying each kind of launcher, on the Mire's frame.
const FRAME = { torso: '533', chasis: '534', leftHand: '535', rightHand: '536', backpack: '004', pilot: 'FPA-04-2' };
const LAUNCHERS = [
  { backpack: '004' }, { backpack: '544' }, { backpack: 'PDBP-203' }, { backpack: '006' }, { backpack: '008' }, { backpack: '011' },
  { backpack: '082' }, { backpack: '084' }, { backpack: '502' }, { leftHand: 'ZHLA-201' }, { leftHand: '056' }, { leftHand: '064' },
  { leftHand: '107' }, { rightHand: '048' }, { torso: '016' }, { torso: '091' }, { backpack: 'PDBP-202' }, { backpack: 'ZYBP-101' },
];
const LAUNCH_DRONES = ['079', 'ZHDR-104', 'PRDR-105', 'PRDR-203', 'PRDR-204'];
// Every kind of Projectile there is to detonate.
const PROJECTILES = ['071', '073', 'ZHAM-003', 'ZHAM-004', '070', 'PDAM-005', '154', '075', '267', '268', '155', '156', 'PDAM-002', '074', 'PDAM-003'];
// An Interceptor, so a launch and a flight have something to owe.
const INTERCEPTOR = '078';
let trials = 0;

const stat = (C) => ({
  sent: C.sent, notes: C.notes,
  plan: C.X.launchPlan, det: C.X.detonateNow, pending: C.X.pendingAction,
  asked: globalThis.__p7dDialogs.asked.map((d) => d.title),
  intercepts: C.state.script?.intercepts ?? [], reactions: (C.state.script?.reactions ?? []).length,
  tokens: C.state.tokens.length,
});

function launchesOf(tag, state, holder, o, R) {
  const C = holder.side === 's1' ? A : B;
  const fresh = () => {
    C.M.H.resetHudTools();
    C.state = clone(state);
    C.state.script.opp = clone(o);
    if (holder.kind === 'mech') C.state.script.acted = state.tokens.filter((x) => x.kind === 'mech' && x.uid !== holder.uid).map((x) => x.uid);
    C.sent = []; C.notes = [];
    globalThis.__p7dDialogs.asked = []; globalThis.__p7dDialogs.answers = [];
    C.render();
    return C.state.tokens.find((x) => x.uid === holder.uid);
  };
  let t = fresh();
  const acts = C.U.guidedActions(C.data, t, { tokens: C.state.tokens, terrain: [] }).filter((g) => g.action.type === 'Projectile');
  for (const g of acts) {
    const key = g.partKey;
    const cards = (g.projectiles ?? []).map((c) => c.id);
    for (const cardId of cards.length ? cards : [null]) {
      const open = () => {
        t = fresh();
        const went = C.press(`[data-doact="${key}"]`);
        if (cardId && cards.length > 1) C.press(`[data-launchpick="${cardId}"]`);
        return went;
      };
      let went;
      try { went = open(); } catch (e) { put(`${tag}|${key}|${cardId}|open`, `THROW ${e.message}`); continue; }
      C.use();
      let html = '';
      try { html = C.X.panelHtml(C.ctx); } catch (e) { html = `THROW ${e.message}`; }
      put(`${tag}|${key}|${cardId}|open`, { went, ...stat(C), html });
      if (!C.X.launchPlan) continue;
      const cands = C.X.landingCandidates(C.ctx);
      const picked = cands.length <= 6 ? cands : [...cands].sort(() => R() - 0.5).slice(0, 6);
      for (const g1 of picked) {
        try {
          open();
          if (!C.X.launchPlan) continue;
          C.X.placeLaunched(C.ctx, g1.c, g1.r);
          const first = stat(C);
          // A second of the volley on another Grid, then the stop.
          const g2 = cands.find((x) => x.c !== g1.c || x.r !== g1.r) ?? g1;
          if (C.X.launchPlan) C.X.placeLaunched(C.ctx, g2.c, g2.r);
          const second = stat(C);
          if (C.X.launchPlan) C.X.finishLaunchPlan(C.ctx);
          put(`${tag}|${key}|${cardId}|to ${g1.c},${g1.r}`, { first, second, done: stat(C), born: C.state.tokens.slice(state.tokens.length).map((x) => [x.cardId, x.col, x.row, x.facing, x.parentUid ?? null]) });
        } catch (e) { put(`${tag}|${key}|${cardId}|to ${g1.c},${g1.r}`, `THROW ${e.message}`); }
        trials++;
      }
      // Facing a line unit before it lands.
      try {
        open();
        if (C.X.launchPlan && cands.length) {
          C.press('[data-launchface="1"]');
          C.X.placeLaunched(C.ctx, cands[0].c, cands[0].r);
          put(`${tag}|${key}|${cardId}|faced`, stat(C));
        }
      } catch (e) { put(`${tag}|${key}|${cardId}|faced`, `THROW ${e.message}`); }
    }
  }
  C.M.H.resetHudTools();
}

function detonationsOf(tag, state, proj) {
  const C = proj.side === 's1' ? A : B;
  const o = M.TY.newOpportunity(proj.uid, undefined);
  const fresh = () => {
    C.M.H.resetHudTools();
    C.state = clone(state);
    C.state.script.opp = clone(o);
    C.sent = []; C.notes = [];
    globalThis.__p7dDialogs.asked = []; globalThis.__p7dDialogs.answers = [];
    C.render();
  };
  fresh();
  const live = [...C.html.matchAll(/<button class="actrow[^>]*data-doact="([^"]+)"[^>]*>/g)].filter((m) => !m[0].includes('aria-disabled')).map((m) => m[1]);
  put(`${tag}|rows`, { live, html: C.html.length });
  for (const key of live) {
    const open = () => { fresh(); return C.press(`[data-doact="${key}"]`); };
    let went;
    try { went = open(); } catch (e) { put(`${tag}|${key}|open`, `THROW ${e.message}`); continue; }
    C.use();
    let html = '';
    try { html = C.X.panelHtml(C.ctx); } catch (e) { html = `THROW ${e.message}`; }
    put(`${tag}|${key}|open`, { went, ...stat(C), html });
    const root = C.root;
    const btns = (sel) => root.querySelectorAll(sel).map((el) => [el.dataset[sel.replace(/^\[data-/, '').replace(/\]$/, '')], !!el.dataset.why]);
    for (const [attr, name] of [['dettarget', 'target'], ['detscan', 'scan'], ['detterrain', 'terrain'], ['deteffect', 'effect']]) {
      let list = [];
      try { C.render(); list = C.root.querySelectorAll(`[data-${attr}]`).map((el) => el.dataset[attr]); } catch { /* no panel */ }
      for (const id of list.slice(0, 6)) {
        try {
          open();
          C.render();
          C.sent = []; C.notes = [];
          const w = C.press(`[data-${attr}="${id}"]`);
          const one = stat(C);
          // The same press again: a Missile that has flown goes on to explode.
          C.render();
          const w2 = C.press(`[data-${attr}="${id}"]`);
          put(`${tag}|${key}|${name} ${id}`, { w, one, w2, two: stat(C), at: C.state.tokens.find((x) => x.uid === proj.uid) ? [C.state.tokens.find((x) => x.uid === proj.uid).col, C.state.tokens.find((x) => x.uid === proj.uid).row] : null });
        } catch (e) { put(`${tag}|${key}|${name} ${id}`, `THROW ${e.message}`); }
        trials++;
      }
    }
    for (const act of ['detdone', 'detkeep', 'detcancel']) {
      try {
        open();
        C.render();
        C.sent = []; C.notes = [];
        const w = C.press(`[data-act="${act}"]`);
        put(`${tag}|${key}|${act}`, { w, ...stat(C) });
      } catch (e) { put(`${tag}|${key}|${act}`, `THROW ${e.message}`); }
      trials++;
    }
  }
  C.M.H.resetHudTools();
}

const STANCES = ['defensive', 'mobility', 'offensive'];
for (const scenario of data.solo.scenarios) {
  const base = tableAtRoundOne(M, data, scenario);
  if (base.refused.length) throw new Error(`setup refused: ${base.refused.join('; ')}`);
  const plan = clone(base.state);
  turnPhase(plan);
  const R = rng(scenario.id.length * 15485863 + 11);
  for (let n = 0; n < 6; n++) {
    const s = clone(plan);
    const taken = new Set();
    const span = n % 2 ? 5 : 8;
    const off = n % 2 ? 3 : 2;
    const spot = () => {
      let c, r;
      do { c = off + Math.floor(R() * span); r = off + Math.floor(R() * span); } while (taken.has(`${c},${r}`));
      taken.add(`${c},${r}`);
      return { c, r };
    };
    for (const t of s.tokens) {
      const g = spot();
      t.col = g.c * 3; t.row = g.r * 3; t.facing = Math.floor(R() * 4);
      if (t.kind === 'mech') { t.stance = STANCES[Math.floor(R() * 3)]; t.timing = 'projectile'; }
      if (R() < 0.15) t.statuses = [...(t.statuses ?? []), 'camouflage'];
    }
    // An Interceptor on each side.
    for (const side of ['s1', 's2']) {
      const g = spot();
      s.tokens.push({ ...M.U.makeDroneToken(s, data, data.byId.get(INTERCEPTOR), side), col: g.c * 3, row: g.r * 3, facing: 0 });
    }
    // Three launcher Mechs and two launcher Drones, of this table's turn.
    const mechs = [];
    for (let k = 0; k < 3; k++) {
      const g = spot();
      const load = { ...FRAME, ...LAUNCHERS[(n * 3 + k) % LAUNCHERS.length] };
      const side = k % 2 ? 's2' : 's1';
      const tok = { ...M.U.makeMechToken(s, data, load, side, `Launcher ${k}`), col: g.c * 3, row: g.r * 3, facing: Math.floor(R() * 4), timing: 'projectile', stance: 'offensive' };
      s.tokens.push(tok);
      mechs.push(tok);
    }
    const drones = [];
    for (let k = 0; k < 2; k++) {
      const g = spot();
      const tok = { ...M.U.makeDroneToken(s, data, data.byId.get(LAUNCH_DRONES[(n * 2 + k) % LAUNCH_DRONES.length]), k % 2 ? 's1' : 's2'), col: g.c * 3, row: g.r * 3, facing: 0 };
      s.tokens.push(tok);
      drones.push(tok);
    }
    s.round.phase = 2;
    s.script.stage = `${s.round.n}:2`;
    s.script.acted = [];
    s.script.revealed = ['s1', 's2'];
    for (const t of [...s.tokens.filter((x) => x.kind === 'mech' && x.label === 'Mire'), ...mechs]) {
      const o = M.TY.newOpportunity(t.uid, 'projectile');
      o.extras = M.U.extrasFor(data, t);
      o.stanceLocked = true;
      launchesOf(`${scenario.id}|${n}|${t.label}|${Object.values(t.mech).join('.')}`, s, t, o, R);
    }
    // The Command Phase, for a Drone's launch.
    const cmd = clone(s);
    cmd.round.phase = 0; cmd.script.stage = `${cmd.round.n}:0`; cmd.script.acted = []; cmd.script.passed = [];
    for (const d of drones) launchesOf(`${scenario.id}|${n}|${d.label}|cmd`, cmd, d, M.TY.newOpportunity(d.uid, undefined), R);
    const auto = clone(s);
    auto.round.phase = 3; auto.script.stage = `${auto.round.n}:3`; auto.script.acted = []; auto.script.passed = [];
    for (const d of drones) launchesOf(`${scenario.id}|${n}|${d.label}|auto`, auto, d, M.TY.newOpportunity(d.uid, undefined), R);
    // The Delay Phase: one Projectile of each kind, of either squad, standing
    // among the units.
    const delay = clone(s);
    delay.round.phase = 4; delay.script.stage = `${delay.round.n}:4`; delay.script.acted = []; delay.script.passed = []; delay.script.opp = null;
    const projs = [];
    for (let k = 0; k < 5; k++) {
      const card = data.byId.get(PROJECTILES[(n * 5 + k) % PROJECTILES.length]);
      const owner = delay.tokens.find((x) => x.kind === 'mech' && x.side === (k % 2 ? 's2' : 's1'));
      const g = { c: off + Math.floor(R() * span), r: off + Math.floor(R() * span) };
      const tok = { ...M.U.makeDroneToken(delay, data, card, owner.side), parentUid: owner.uid, col: g.c * 3 + 1, row: g.r * 3 + 1, facing: 0 };
      delay.tokens.push(tok);
      projs.push(tok);
    }
    for (const p of projs) detonationsOf(`${scenario.id}|${n}|det|${p.cardId}|${p.side}`, delay, p);
  }
}

writeFileSync(out, JSON.stringify({ prints, full }));
const throws = Object.values(full).filter((x) => x.startsWith('THROW')).length;
const sentKinds = {};
let refused = 0;
const walk = (v) => {
  if (!v || typeof v !== 'object') return;
  if (Array.isArray(v.sent)) for (const x of v.sent) { sentKinds[x.cmd.kind] = (sentKinds[x.cmd.kind] ?? 0) + 1; if (!x.ok) refused++; }
  for (const k of Object.keys(v)) if (k !== 'sent') walk(v[k]);
};
for (const v of Object.values(full)) if (!v.startsWith('THROW')) walk(JSON.parse(v));
console.log(`${Object.keys(prints).length} prints, ${trials} trials; ${throws} threw`);
console.log(`sent ${JSON.stringify(sentKinds)}; refused ${refused}; written to ${out}`);
if (throws) console.log([...new Set(Object.entries(full).filter(([, v]) => v.startsWith('THROW')).map(([k, v]) => `${k.split('|').slice(-3).join('|')}: ${v}`))].slice(0, 14).join('\n'));
process.exit(0);
