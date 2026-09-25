// MECHANICS AUDIT, PHASE 2 (2026-09-25): the turn and Link economy, driven
// through the real command layer, the glue every client runs after a command,
// and the real attack window. Each block is one finding of Project-Documents/
// MECHANICS-AUDIT.md (the letters match its sections), pinned by behaviour
// rather than by the shape of the source, and each was mutation-checked: put
// its fix back the way it was and it fails.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { installDom, makeEl, mech, settle, findButtons, label } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

installDom();
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const entry = new URL('./_mechanics2.entry.ts', import.meta.url);
const out = new URL('./_mechanics2.bundle.mjs', import.meta.url);
writeFileSync(entry, [
  "export { check, apply, ammoAvailable } from '../src/commands';",
  "export { loadData } from '../src/data';",
  "export { glueAfter, makeInit } from '../src/glue';",
  "export { activationOrder, alive, commandTokensFor, tiedChoices } from '../src/loop';",
  "export { newScriptState, newOpportunity } from '../src/types';",
  "export { actionPipCount } from '../src/ticks';",
  "export { AttackHelper, tallyCounter } from '../src/combat';",
  "export * as U from '../src/units';",
].join('\n') + '\n');
await build({
  entryPoints: [fileURLToPath(entry)], outfile: fileURLToPath(out),
  bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': '"/"' },
});
const M = await import(`${out.href}?t=${Date.now()}`);
const U = M.U;
const data = await M.loadData();
const dice = JSON.parse(readFileSync(new URL('../../data/dice.json', import.meta.url), 'utf8'));

// ---------- a scripted table, the way a strict guided page holds one ----------
function table() {
  return {
    v: 3, map: 'none', tokens: [], nextUid: 1,
    round: { n: 1, phase: 2, firstPlayer: 's1' },
    commandTokens: { s1: 0, s2: 0 },
    script: { ...M.newScriptState('s1'), strict: true },
    setup: { stage: 'done', rolls: { s1: [], s2: [] }, edge: { s1: 'white', s2: 'black' }, placed: { s1: 0, s2: 0 } },
  };
}
// A free table: no script, so nothing has an Opportunity to be judged against.
function freeTable() {
  return U.migrateState({ v: 3, tokens: [], nextUid: 1, round: { n: 1, phase: 2, firstPlayer: 's1' } }, data);
}
// Glacier-less Standard frame: 012 torso, 020 Sprint chassis, 041 (Full-auto
// Firing S, Chop Melee S), 058 (Burst Fire Firing M, Single Shot Firing S),
// piloted by Hammerhead Domestic Expert.
const L = (extra = {}) => ({ torso: '012', chasis: '020', leftHand: '041', rightHand: '058', backpack: '', pilot: 'FPA-04-2', ...extra });
function put(s, side, loadout, col, row, extra = {}) {
  const t = { ...U.makeMechToken(s, data, loadout, side), col, row, facing: 0, deployed: true, statuses: [], log: [], ...extra };
  s.tokens.push(t);
  return t;
}
function droneOn(s, side, cardId, col, row, extra = {}) {
  const t = { ...U.makeDroneToken(s, data, data.byId.get(cardId), side), col, row, facing: 0, deployed: true, statuses: [], log: [], ...extra };
  s.tokens.push(t);
  return t;
}
// The glue every client runs after a command: it opens whose Opportunity it is.
const open = (s) => M.glueAfter(data, s, { kind: 'noteRoll', seat: 's1', what: 'x' });
const send = (s, cmd) => {
  const v = M.check(data, s, cmd);
  if (v.ok) { M.apply(data, s, cmd); M.glueAfter(data, s, cmd); }
  return v;
};
const ok = (s, cmd) => M.check(data, s, cmd).ok;
const act = (t, actionId, extra = {}) => ({ kind: 'performAction', seat: t.side, uid: t.uid, actionId, partKey: actionId, ...extra });
const reboot = (t, stance = 'offensive') => ({ kind: 'reboot', seat: t.side, uid: t.uid, stance });
const end = (t) => ({ kind: 'endOpportunity', seat: t.side, uid: t.uid });
const setStance = (t, stance) => ({ kind: 'setStance', seat: t.side, uid: t.uid, stance });
const card = (cardId, actionId) => data.byId.get(cardId)?.actions?.find((a) => a.id === actionId);

console.log('Phase 2: turn and Link economy\n');

// ================= A. Shutdown (4.1, FAQ K17, L3, L8) =================

// ---------- A1: a Reboot comes with the Mech's own Opportunity ----------
{
  const s = table();
  const a = put(s, 's1', L(), 1, 1, { timing: 'firing', stance: 'shutdown', link: 0 });
  const b = put(s, 's2', L({ pilot: 'FPA-01' }), 10, 10, { timing: 'swift' });
  open(s);
  check('A1 a Shutdown Mech does not Reboot in the enemy\'s Opportunity', [s.script.opp.uid === b.uid, ok(s, reboot(a))], [true, false]);
  s.round.phase = 0;
  s.script.opp = null;
  check('A1 nor in the Command Phase', ok(s, reboot(a)), false);
}
{
  const s = table();
  const a = put(s, 's1', L(), 1, 1, { timing: 'firing', stance: 'shutdown', link: 0 });
  open(s);
  // E3: its Opportunity has come, and it must Reboot (FAQ K17).
  check('E3 a Shutdown Mech whose Opportunity has come cannot pass it by', ok(s, end(a)), false);
  check('A1 it Reboots at the start of its own Opportunity', send(s, reboot(a)).ok, true);
  check('A1 with 1 Link back, 1 Action Tick and no Maneuver (4.1.1)', [a.stance, a.link, s.script.opp.action, s.script.opp.maneuver], ['offensive', 1, 1, 0]);
  check('A1 and only once', ok(s, reboot(a)), false);
  // E5, answered No: the one Action matches the dial, with no exception (FAQ L8).
  check('E5 the one Action after a Reboot must match the dial', [ok(s, act(a, '041_B')), ok(s, act(a, '041_A'))], [false, true]);
  check('B9 and the page draws one Action pip for it, not two', M.actionPipCount(s.script.opp), 1);
  check('E3 after the Reboot the Opportunity can be ended', ok(s, end(a)), true);
}
{
  // Shut down part-way through its own turn: an Interception takes the last Link.
  const s = table();
  const a = put(s, 's1', L(), 1, 1, { timing: 'firing', link: 1 });
  open(s);
  send(s, act(a, '041_A'));
  M.apply(data, s, { kind: 'drainLink', seat: 's2', uid: 999, targetUid: a.uid, n: 1 });
  check('A1 shut down during its own Opportunity, it Reboots at the start of its next (FAQ K17)', [a.stance, ok(s, reboot(a))], ['shutdown', false]);
  check('E3 and it ends this one', ok(s, end(a)), true);
}
{
  // Every loaded state carries a script, the sandbox and a Freeform pad table
  // included, so "a guided game" is the setup, never the script. The first
  // cut of these gates read the script and refused a Freeform table all three.
  const s = freeTable();
  const a = put(s, 's1', L({ backpack: '009' }), 1, 1, { stance: 'shutdown', link: 0 });
  const b = put(s, 's1', L({ pilot: 'FPA-01' }), 4, 1, { link: 3 });
  const eagle = droneOn(s, 's1', 'ZHDR-206', 3, 3);
  check('A1 a free table carries a script and no setup', [!!s.script, !!s.setup], [true, false]);
  check('A1 and records a Reboot whenever the table says it happened', ok(s, reboot(a)), true);
  check('B1 and an Extra Opportunity without a Coordinate the engine saw', ok(s, { kind: 'grantExtra', seat: 's1', uid: b.uid, linkCost: 1 }), true);
  check('D1 and Stance feedback outside any activation', ok(s, { kind: 'stanceFeedback', seat: 's1', uid: eagle.uid, actionId: 'ZHDR-206_B', targetUid: b.uid, stance: 'defensive' }), true);
}

// ---------- E5: no Starting Action exception after a Reboot ----------
{
  const s1 = table();
  const m1 = put(s1, 's1', L({ pilot: 'FPA-01' }), 1, 1, { timing: 'tactical' });
  open(s1);
  const s2 = table();
  const m2 = put(s2, 's1', L({ pilot: 'FPA-01' }), 1, 1, { timing: 'tactical', stance: 'shutdown', link: 0 });
  open(s2);
  send(s2, reboot(m2));
  check('E5 Misty\'s Feint starts a Firing Action on a Tactical dial, but not after a Reboot', [ok(s1, act(m1, '041_A')), ok(s2, act(m2, '041_A'))], [true, false]);
}

// ---------- A2: every Mech sets a dial, a Shutdown one included ----------
{
  const s = table();
  s.round.phase = 1;
  const a = put(s, 's1', L(), 1, 1, { stance: 'shutdown', link: 0 });
  put(s, 's2', L({ pilot: 'FPA-01' }), 10, 10, { timing: 'firing' });
  check('A2 the dials do not lock while a Shutdown Mech has none (FAQ K17)', ok(s, { kind: 'lockDials', seat: 's1' }), false);
  // A solo Match Centre and the guide turn the phase without a lock.
  check('A2 nor does the Planning Phase turn', ok(s, { kind: 'advancePhase', seat: 's1' }), false);
  a.timing = 'melee';
  check('A2 and both go once it has one', [ok(s, { kind: 'lockDials', seat: 's1' }), ok(s, { kind: 'advancePhase', seat: 's1' })], [true, true]);
}

// ---------- A3: a Shutdown Mech does not Intercept ----------
{
  const s = table();
  const d = put(s, 's1', L({ backpack: '003' }), 0, 8, { stance: 'shutdown', link: 0 });
  const launcher = put(s, 's2', L({ pilot: 'FPA-01' }), 3, 8);
  const missile = droneOn(s, 's2', '075', 3, 11, { kind: 'projectile' });
  const owed = () => U.interceptsOwed(data, s.tokens, [], launcher, [missile]).some((x) => x.uid === d.uid);
  check('A3 no Interception is owed by a Shutdown Mech', owed(), false);
  check('A3 nor can it spend one', ok(s, { kind: 'spendIntercept', seat: 's1', uid: d.uid, actionId: '041_A' }), false);
  d.stance = 'defensive';
  d.link = 3;
  check('A3 the same Mech standing owes and spends it', [owed(), ok(s, { kind: 'spendIntercept', seat: 's1', uid: d.uid, actionId: '041_A' })], [true, true]);
}

// ---------- A4: a Shutdown defender gets no reactions ----------
const kit = (t, parts) => {
  t.mech = { torso: '172', chasis: '179', leftHand: '', rightHand: '', backpack: '', pilot: 'FPA-09', ...parts };
  t.cardId = t.mech.torso;
  return t;
};
const faceOf = (colour, type) => dice.dice[colour].faces.findIndex((f) => f.length === 1 && f[0].type === type && !f[0].hollow);
const RED_HEAVY = faceOf('red', 'heavyHit');
const WHITE_BLANK = dice.dice.white.faces.findIndex((f) => f.length === 0);
const YEL_EYE = faceOf('yellow', 'eye');
const FIRE = card('109', '109_A') ?? data.byId.get('109').actions.find((x) => x.type === 'Firing');
function windowOn(tokens) {
  const cmds = [];
  const reactions = [];
  const root = makeEl('div');
  const h = new M.AttackHelper(
    data, dice, root,
    () => {}, () => {}, () => {}, () => {}, () => {}, () => {},
    (cmd) => {
      cmds.push(cmd);
      const t = tokens.find((x) => x.uid === (cmd.targetUid ?? cmd.uid));
      if (cmd.kind === 'applyPenetration' && t) {
        const cur = t.partStates[cmd.slot] ?? 'intact';
        t.partStates[cmd.slot] = cur === 'intact' && t.kind === 'mech' ? 'damaged' : 'destroyed';
      }
      return { ok: true };
    },
  );
  h.tokens = () => tokens;
  h.terrain = () => [];
  h.smoke = () => [];
  h.onReaction = (d, r) => reactions.push(r.smoke ? 'smoke' : r.trace ? 'trace' : r.stance ? 'stance' : '?');
  return { h, root, cmds, reactions };
}
const press = (root, rx) => {
  const b = findButtons(root).find((x) => rx.test(label(x)) && !x.disabled);
  if (b) b.click();
  return !!b;
};
async function reactionsAgainst(defParts, stance) {
  const atk = kit(mech(1, 's2', 'Attacker', 0), { rightHand: '109' });
  const def = kit(mech(2, 's1', 'Defender', 3), defParts);
  def.stance = stance;
  def.link = stance === 'shutdown' ? 0 : 3;
  const { h, root, reactions } = windowOn([atk, def]);
  h.start(atk, FIRE, def, 'clear');
  h.pickPart('torso');
  const c = h.ctx;
  c.attackRoll = [{ color: 'red', face: RED_HEAVY, selected: false }, { color: 'red', face: RED_HEAVY, selected: false }];
  c.defenseRoll = [{ color: 'white', face: WHITE_BLANK, selected: false }];
  c.focus = { stage: 'done', attackerUse: false, defenderUse: false };
  c.step = 'resolve';
  h.render();
  press(root, /^Apply Penetration|^Done$/);
  await settle();
  press(root, /^Done$|^Close|^Finish/);
  await settle();
  return reactions;
}
check('A4 Emergency Smoke answers a Firing Attack on a standing 546 (control)', await reactionsAgainst({ torso: '546' }, 'defensive'), ['smoke']);
check('A4 and not on a Shutdown one (4.1: no Passive effects)', await reactionsAgainst({ torso: '546' }, 'shutdown'), []);
{
  const s = table();
  const t = put(s, 's1', L({ torso: '546' }), 0, 0, { stance: 'shutdown', link: 0 });
  check('A4 nor does the engine take the debt for it', ok(s, { kind: 'queueReactions', seat: 's1', items: [{ uid: t.uid, actionId: '546_B', count: 2, range: 1, kind: 'smoke' }] }), false);
}

// ---------- A5 / E1 / E2: what a Shutdown source lends is off ----------
{
  const s = table();
  const hunter = put(s, 's1', L({ torso: '174' }), 0, 0, { stance: 'shutdown', link: 0, statuses: ['command'] });
  const enemy = put(s, 's2', L({ pilot: 'FPA-01' }), 3, 0);
  check('A5 Target Tracing is off on a Shutdown Hunter', U.targetTracingOn(data, hunter), null);
  check('A5 so no Counter-roll opens from it', ok(s, { kind: 'startCounterRoll', seat: 's1', uid: hunter.uid, targetUid: enemy.uid, actionId: '174_B', reaction: true }), false);
  check('A5 and it pays no Command Token for one', ok(s, { kind: 'spendCommand', seat: 's1', uid: hunter.uid }), false);
  // Nor as an Action: a Scan at a Low Profile enemy, which a standing Mech may.
  enemy.statuses = ['lowProfile'];
  const scan = { kind: 'startCounterRoll', seat: 's1', uid: hunter.uid, targetUid: enemy.uid, actionId: 'COMMON_SCAN' };
  const shut = ok(s, scan);
  hunter.stance = 'defensive';
  hunter.link = 3;
  check('A5 a Shutdown Mech opens no Counter-roll as an Action either, where a standing one does', [shut, ok(s, scan)], [false, true]);
}
{
  const s = table();
  const vol = put(s, 's1', L({ torso: '016' }), 0, 0, { stance: 'shutdown', link: 0 });
  const halo = put(s, 's1', L({ backpack: 'ZYBP-302' }), 3, 0, { stance: 'shutdown', link: 0, statuses: ['command', 'lowProfile'] });
  check('A5 Armor Countermeasures and HALO Dodge Enhancement are off in Shutdown', [U.designationsOn(data, vol).length, U.dodgeEnhanceReady(data, halo)], [0, false]);
}
{
  const s = table();
  const cat = put(s, 's1', L({ torso: '092' }), 0, 9, { stance: 'shutdown', link: 0 });
  const shooter = put(s, 's1', L({ rightHand: '109' }), 0, 0);
  const target = put(s, 's2', L({ pilot: 'FPA-01' }), 12 - 1, 9);
  const lent = () => U.missileGuidance(data, s.tokens, shooter, target, FIRE, { terrain: [] }).map((x) => x.uid);
  const off = lent();
  cat.stance = 'offensive';
  cat.link = 3;
  check('A5 Coordinated Observation: a standing Caracal lends its {Eye} reroll, a Shutdown one does not', [off, lent()], [[], [cat.uid]]);
}
{
  const s = table();
  const wm = put(s, 's1', L({ backpack: 'ZYBP-202' }), 0, 0, { stance: 'shutdown', link: 0, statuses: ['command'] });
  const dr = droneOn(s, 's1', 'ZHDR-201', 3, 0);
  check('A5 the Whistle funds no Drone reroll from a Shutdown Mech', U.whistleFunders(data, s.tokens, dr).map((x) => x.uid), []);
  wm.stance = 'defensive';
  wm.link = 3;
  check('A5 and does from a standing one (control)', U.whistleFunders(data, s.tokens, dr).map((x) => x.uid), [wm.uid]);
}
{
  const s = table();
  const aur = put(s, 's1', L({ torso: '018' }), 0, 0, { stance: 'shutdown', link: 0 });
  const ally = put(s, 's1', L({ pilot: 'FPA-01' }), 3, 0);
  const off = U.warfareNodeBoost(data, s.tokens, ally);
  aur.stance = 'defensive';
  aur.link = 3;
  const on = U.warfareNodeBoost(data, s.tokens, ally);
  check('A5 Warfare Node lends nothing from a Shutdown Aurora, and its Node 1 from a standing one', [off, on && on.ev - U.electronicValue(data, aur)], [null, 1]);
}
{
  const s = table();
  const kh = put(s, 's1', L({ pilot: 'FPA-06-2' }), 0, 0, { stance: 'shutdown', link: 0 });
  put(s, 's1', L({ torso: '559', pilot: 'FPA-01' }), 3, 0);
  const off = !!U.hiddenByAlliedAura(data, s.tokens, kh);
  kh.stance = 'defensive';
  kh.link = 3;
  check('A5 KeyHole gains no Low Profile in Shutdown (FAQ L3), and does standing', [off, !!U.hiddenByAlliedAura(data, s.tokens, kh)], [false, true]);
}
{
  const s = table();
  const drag = put(s, 's1', L({ torso: '175' }), 0, 0, { stance: 'shutdown', link: 0 });
  const d = droneOn(s, 's1', 'ZHDR-201', 3, 0, { commandedBy: drag.uid });
  const off = U.riderOnDrone(data, s.tokens, d);
  drag.stance = 'defensive';
  drag.link = 3;
  check('A5 the A2 Data Link rides no Command from a Shutdown issuer', [off.autoActions, U.riderOnDrone(data, s.tokens, d).autoActions], [false, true]);
}
{
  const s = table();
  const zyb = put(s, 's1', L({ backpack: 'ZYBP-102' }), 0, 0);
  const on = U.coordinationOnOpportunityEnd(data, zyb);
  zyb.stance = 'shutdown';
  check('A5 Distributed Collaboration fires for a standing Mech, not a Shutdown one', [on, U.coordinationOnOpportunityEnd(data, zyb)], [1, 0]);
}
{
  const s = table();
  const yoyu = put(s, 's1', L({ pilot: 'LPA-22' }), 0, 0, { stance: 'shutdown', link: 0 });
  const init = put(s, 's2', L({ pilot: 'FPA-01' }), 3, 0, { stance: 'defensive' });
  check('A5 a Shutdown Yoyu does not Provoke (FAQ L3)', U.provokeWhy(data, yoyu, init) === null, false);
}
{
  const s = table();
  const wu = put(s, 's1', L({ pilot: 'FPA-03' }), 0, 0, { stance: 'shutdown', link: 3 });
  check('E2 Wu keeps no Link on a Part loss in Shutdown (L3; L5 excepts Anser alone)', U.keepsLinkOnPartLoss(data, wu), false);
  wu.stance = 'defensive';
  check('E2 and does standing (control)', U.keepsLinkOnPartLoss(data, wu), true);
}

// ---------- A6 / A7: Shutdown is never chosen, and a Stance is chosen in its own Opportunity ----------
{
  const s = table();
  const a = put(s, 's1', L(), 1, 1, { timing: 'swift', stance: 'offensive' });
  const b = put(s, 's2', L({ pilot: 'FPA-01' }), 10, 10, { timing: 'firing', stance: 'offensive' });
  open(s);
  check('A6 Shutdown is not a Stance a Mech chooses (3.4.2), while another is', [ok(s, setStance(a, 'shutdown')), ok(s, setStance(a, 'mobility'))], [false, true]);
  check('A6 a one-device guided game changes no Stance outside the Mech\'s own Opportunity', ok(s, setStance(b, 'defensive')), false);
}
{
  const s = table();
  s.round.phase = 0;
  const m = put(s, 's1', L({ rightHand: '550' }), 0, 0, { stance: 'defensive' });
  s.script.opp = M.newOpportunity(m.uid, undefined);
  check('A7 an RWS activation in the Command Phase is no Stance choice', ok(s, setStance(m, 'offensive')), false);
}
{
  const src = readFileSync(new URL('../src/squads.ts', import.meta.url), 'utf8');
  check('A7 the sandbox squad panel leaves Shutdown through a Reboot, which restores the Link', /kind: 'reboot'/.test(src), true);
}

// ================= B. Ticks, Opportunities and Echoes =================

// ---------- B1: FAQ K3, and a grant only once it is owed ----------
{
  const s = table();
  const a = put(s, 's1', L({ backpack: '009' }), 1, 1, { timing: 'tactical', link: 4 });
  const b = put(s, 's1', L({ torso: '019', backpack: '009', pilot: 'FPA-01' }), 4, 1, { link: 3 });
  put(s, 's2', L({ pilot: 'FPA-01' }), 10, 10);
  const grant = (t, linkCost = 1) => ({ kind: 'grantExtra', seat: t.side, uid: t.uid, linkCost });
  open(s);
  check('B1 no Extra Opportunity is granted before Coordinate is performed', ok(s, grant(b)), false);
  send(s, act(a, '009_A'));
  check('B1 then one is, at the printed cost only, and never to the granter', [ok(s, grant(b, 0)), ok(s, grant(a)), ok(s, grant(b))], [false, false, true]);
  send(s, grant(b));
  check('B1 the ally takes it now (FAQ K21)', [s.script.opp.uid === b.uid, s.script.opp.extra], [true, true]);
  check('B1 and cannot Coordinate again inside it (FAQ K3)', ok(s, act(b, '009_A')), false);
  send(s, end(b));
  check('B1 the granter resumes, its debt paid', [s.script.opp.uid === a.uid, ok(s, grant(b))], [true, false]);
}

// ---------- B2 / E4: Hammerhead Domestic Expert ----------
{
  const s = table();
  const a = put(s, 's1', L(), 1, 1, { timing: 'firing', stance: 'offensive', link: 4 });
  open(s);
  send(s, act(a, '041_A'));
  check('E4 Domestic Expert trades during the Opportunity, after an Action too (printed English)', send(s, { kind: 'linkTick', seat: 's1', uid: a.uid }).ok, true);
  check('E4 once', ok(s, { kind: 'linkTick', seat: 's1', uid: a.uid }), false);
}
{
  const s = table();
  const a = put(s, 's1', L(), 1, 1, { timing: 'firing', stance: 'shutdown', link: 1 });
  open(s);
  send(s, reboot(a));
  check('B2 but never after a Reboot, which leaves 1 Action Tick (4.1.1, FAQ L8)', [a.link, ok(s, { kind: 'linkTick', seat: 's1', uid: a.uid })], [2, false]);
}

// ---------- B3: CQC is any Timing, for a Melee Short Starting Action ----------
{
  const on = (timing, actionId) => {
    const s = table();
    const t = put(s, 's1', L({ torso: '017' }), 1, 1, { timing });
    open(s);
    return ok(s, act(t, actionId));
  };
  check('B3 017 CQC starts Chop on every dial', ['swift', 'melee', 'projectile', 'firing', 'movement', 'tactical'].map((tm) => on(tm, '041_B')), [true, true, true, true, true, true]);
  check('B3 but not a Melee Medium', on('tactical', 'COMMON_PUNCH_MELEE'), false);
  const s = table();
  const t = put(s, 's1', L({ torso: '017' }), 1, 1, { timing: 'firing', stance: 'shutdown', link: 0 });
  open(s);
  send(s, reboot(t));
  check('E5 nor after a Reboot', ok(s, act(t, '041_B')), false);
}

// ---------- B4: Overload needs a Pack that can still act ----------
{
  const s = table();
  const a = put(s, 's1', L({ backpack: '090' }), 1, 1, { timing: 'firing', link: 4 });
  open(s);
  const ovl = { kind: 'overload', seat: 's1', uid: a.uid };
  const intact = ok(s, ovl);
  a.partStates.backpack = 'destroyed';
  const wrecked = ok(s, ovl);
  a.repairedSlots = ['backpack'];
  check('B4 an OCSP Pack Overloads intact and Repaired (J23), not destroyed (3.4.3)', [intact, wrecked, ok(s, ovl)], [true, false, true]);
  send(s, ovl);
  send(s, ovl);
  check('B9 two Overloads draw four Action pips', M.actionPipCount(s.script.opp), 4);
}

// ---------- B5 / E7: every Action is initiated through a Part ----------
{
  const s = table();
  const a = put(s, 's1', L(), 1, 1, { timing: 'firing' });
  a.partStates.leftHand = 'destroyed';
  open(s);
  check('B5 an Action printed on a destroyed Part is refused', ok(s, act(a, '041_A')), false);
}
{
  const s = table();
  const a = put(s, 's1', L(), 1, 1, { timing: 'melee' });
  Object.assign(a.partStates, { chasis: 'destroyed', leftHand: 'destroyed', rightHand: 'destroyed' });
  open(s);
  check('B5 a Punch with the Chassis and both arms gone is refused', ok(s, act(a, 'COMMON_PUNCH_MELEE')), false);
}
{
  const s = table();
  const a = put(s, 's1', L(), 1, 1, { timing: 'tactical' });
  open(s);
  const discard = (slot) => act(a, 'COMMON_DISCARD', { partKey: `COMMON_DISCARD@${slot}` });
  check('E7 Discard is taken once per hand, not once per Opportunity (FAQ H6/H7)', send(s, discard('leftHand')).ok, true);
  check('E7 so the other hand may Discard, and the same one may not', [ok(s, discard('leftHand')), ok(s, discard('rightHand'))], [false, true]);
  check('B5 and not through a Part the Action does not list', ok(s, act(a, 'COMMON_DISCARD', { partKey: 'COMMON_DISCARD@torso' })), false);
}
{
  const s = table();
  const a = put(s, 's1', L({ torso: '098', rightHand: '122' }), 1, 1, { timing: 'tactical' });
  open(s);
  const charge = (slot) => act(a, 'COMMON_CHARGE', { partKey: `COMMON_CHARGE@${slot}` });
  send(s, charge('rightHand'));
  check('E7 the Charge Action is once per Part: the same Part refused, another taken', [ok(s, charge('rightHand')), ok(s, charge('torso'))], [false, true]);
  const s2 = table();
  const b = put(s2, 's1', L({ torso: '091' }), 1, 1, { timing: 'tactical' });
  open(s2);
  check('C9 with nothing to Charge, the Charge Action is refused (FAQ H2)', ok(s2, act(b, 'COMMON_CHARGE')), false);
}

// ---------- B6 / B7: a dead Mech holds no Opportunity ----------
{
  const s = table();
  const a = put(s, 's1', L({ backpack: '009' }), 1, 1, { timing: 'tactical', link: 4 });
  const b = put(s, 's1', L({ pilot: 'FPA-01' }), 4, 1, { link: 3 });
  put(s, 's2', L({ pilot: 'FPA-01' }), 10, 10);
  open(s);
  send(s, act(a, '009_A'));
  send(s, { kind: 'grantExtra', seat: 's1', uid: b.uid, linkCost: 1 });
  b.partStates.torso = 'destroyed';
  open(s);
  check('B6 an echoed Mech destroyed in its Extra Opportunity hands the turn back (FAQ K21)', [s.script.opp?.uid === a.uid, !!s.script.opp?.extra], [true, false]);
}
{
  const s = table();
  s.noBoard = true;
  const a = put(s, 's1', L({ pilot: 'FPA-01' }), 0, 0, { timing: 'swift' });
  const b = put(s, 's2', L(), 0, 0, { timing: 'tactical' });
  open(s);
  b.partStates.torso = 'destroyed';
  send(s, end(a));
  check('B7 a Mech is destroyed with its Torso, whatever else stands (4.4.4)', [M.alive(b), s.script.opp?.uid === b.uid], [false, false]);
}

// ---------- B8: a free or granted Movement has to be owed ----------
{
  const s = table();
  const a = put(s, 's1', L(), 1, 1, { timing: 'firing' });
  open(s);
  send(s, act(a, '041_A'));
  check('B8 a Firing Action carries no free Movement', ok(s, { kind: 'maneuver', seat: 's1', uid: a.uid, to: { col: 4, row: 1 }, free: true }), false);
}
{
  const s = table();
  const a = put(s, 's1', L(), 1, 1, { timing: 'movement' });
  open(s);
  send(s, act(a, '020_A'));
  const mv = (col) => ({ kind: 'maneuver', seat: 's1', uid: a.uid, to: { col, row: 1 }, free: true });
  check('B8 Sprint carries one Movement, made once', [send(s, mv(4)).ok, ok(s, mv(6))], [true, false]);
}
{
  const s = table();
  const a = put(s, 's1', L(), 1, 1, { timing: 'tactical' });
  put(s, 's2', L({ pilot: 'FPA-01' }), 10, 10, { timing: 'swift' });
  open(s);
  check('B8 a granted Movement no card granted is refused', ok(s, { kind: 'maneuver', seat: 's1', uid: a.uid, to: { col: 8, row: 1 }, granted: true }), false);
}

// ================= C. Ammo and Charge =================

// ---------- C1: an Action that launches nothing spends its Ammo when performed ----------
{
  const s = table();
  const a = put(s, 's1', L({ backpack: '001' }), 1, 1, { timing: 'tactical' });
  open(s);
  const before = a.ammo['001_A'];
  send(s, act(a, '001_A'));
  check('C1 Damage Control spends its Ammo Token when performed (4.13)', [before, a.ammo['001_A']], [1, 0]);
  const s2 = table();
  const b = put(s2, 's1', L({ backpack: '001' }), 1, 1, { timing: 'tactical' });
  b.ammo['001_A'] = 0;
  open(s2);
  check('C1 and with none left cannot be performed', ok(s2, act(b, '001_A')), false);
}

// ---------- C2 / E10: Discard carries the Round Tokens by name, and drops the Charge ----------
{
  const s = freeTable();
  const t = put(s, 's1', L({ torso: '091', leftHand: '107', rightHand: '122' }), 4, 4);
  const disarm = (slot) => send(s, { kind: 'disarm', seat: 's1', uid: t.uid, targetUid: t.uid, slot });
  for (let i = 0; i < 3; i++) send(s, { kind: 'spendAmmo', seat: 's1', uid: t.uid, actionId: '107_A' });
  disarm('leftHand');
  check('C2 a spent S100 Grenade stays spent on its Discard face (4.17)', [t.mech.leftHand, t.ammo['108_A']], ['108', 0]);
  send(s, { kind: 'setCharge', seat: 's1', uid: t.uid, slot: 'rightHand', on: true });
  disarm('rightHand');
  check('C2 a Charge on a Part whose Discard face spends none is removed', [t.mech.rightHand, (t.charge ?? []).includes('rightHand')], ['123', false]);
}
{
  const s = freeTable();
  const t = put(s, 's1', L({ torso: '091', leftHand: '107' }), 4, 4);
  send(s, { kind: 'disarm', seat: 's1', uid: t.uid, targetUid: t.uid, slot: 'leftHand' });
  check('E10 an unspent S100 keeps its 3 Ammo on the (D) face', t.ammo['108_A'], 3);
}
{
  const s = freeTable();
  const t = put(s, 's1', L({ torso: '091' }), 4, 4);
  send(s, { kind: 'spendIntercept', seat: 's1', uid: t.uid, actionId: '041_A' });
  send(s, { kind: 'disarm', seat: 's1', uid: t.uid, targetUid: t.uid, slot: 'leftHand' });
  check('C2 a spent Interception Token is not handed back by the Discard', [t.mech.leftHand, t.intercept?.['042_A']], ['042', 0]);
}

// ---------- C3 / E9: the R7MG asks Multi-target 3 or Suppression ----------
{
  const r7 = card('556', '556_A');
  const [mt, sup] = U.chargeChoices(r7);
  const read = (x) => [U.multiTargetLimit(x)?.limit ?? 1, !!U.suppressionOn(x)];
  check('E9 consuming the Charge offers the printed two', [mt?.label, sup?.label], ['Multi-target 3', 'Suppression']);
  check('C3 a kept Charge gives neither', read(U.chargeAdjusted(r7, false)), [1, false]);
  check('C3 the Multi-target arm gives Multi-target 3 alone', read(U.chargeAdjusted(r7, true, mt.id)), [3, false]);
  check('C3 the Suppression arm gives Suppression alone', read(U.chargeAdjusted(r7, true, sup.id)), [1, true]);
}

// ---------- C4 / E11 / E12: any Charged KC Part, a Repaired one too ----------
{
  const s = freeTable();
  const t = put(s, 's1', L({ torso: '098', backpack: '081' }), 4, 4);
  send(s, { kind: 'setCharge', seat: 's1', uid: t.uid, slot: 'backpack', on: true });
  check('C4 a Charged EBS/X40 behind an uncharged KC Torso gives KC Armor', U.kcArmorReady(data, t), { slot: 'backpack' });
  t.partStates.backpack = 'destroyed';
  check('E12 a destroyed one does not', U.kcArmorReady(data, t), null);
  t.repairedSlots = ['backpack'];
  check('E12 a Repaired one does, and may be Charged (FAQ J23)', [U.kcArmorReady(data, t), U.chargeableSlots(data, t).some((x) => x.slot === 'backpack')], [{ slot: 'backpack' }, true]);
}

// ---------- C6: Ammo Delivery launches an empty Pod from the Pack ----------
{
  const s = freeTable();
  const t = put(s, 's1', L({ torso: '091', leftHand: '129', backpack: '086' }), 4, 4);
  t.ammo['129_A'] = 0;
  check('C6 an empty Missile Pod counts the Ammunition Pack\'s Tokens', M.ammoAvailable(data, s, t, '129_A'), 2);
  check('C6 and launches out of them', ok(s, { kind: 'launch', seat: 's1', uid: t.uid, actionId: '129_A', cardId: '157', to: { col: 4, row: 1 }, facing: 2 }), true);
}

// ---------- C12: Volley X caps one performance ----------
{
  const s = table();
  const t = put(s, 's1', L({ torso: '015', backpack: '004' }), 1, 1, { timing: 'projectile' });
  open(s);
  send(s, act(t, '004_A'));
  const shot = (row) => send(s, { kind: 'launch', seat: 's1', uid: t.uid, actionId: '004_A', cardId: '071', to: { col: 4, row }, facing: 2 }).ok;
  check('C12 a Volley 2 Action launches two, and a third is refused (4.7.3)', [shot(1), shot(2), shot(3)], [true, true, false]);
}

// ---------- C9: PRDR Emergency Smoke (FAQ D10) ----------
{
  const s = table();
  const reaper = droneOn(s, 's1', 'PRDR-103', 0, 5);
  check('C9 the Reaper carries the Emergency Smoke the PD 1.02 list prints', U.attackReactionsOf(data, reaper).map((r) => r.actionId), ['PRDR-103_D']);
}

// ================= D. Stance effects the cards print =================

// ---------- D1: Barricade and Stance feedback change the Stance ----------
{
  const s = table();
  const a = put(s, 's1', L({ leftHand: '045' }), 1, 1, { timing: 'firing', stance: 'offensive' });
  open(s);
  send(s, act(a, '058_B'));
  send(s, act(a, '045_B'));
  check('D1 Barricade switches its own Mech to Defensive Stance', a.stance, 'defensive');
}
{
  const s = table();
  s.round.phase = 0;
  const eagle = droneOn(s, 's1', 'ZHDR-206', 3, 3);
  const ally = put(s, 's1', L(), 3, 6, { stance: 'offensive' });
  const far = put(s, 's1', L({ pilot: 'FPA-01' }), 30, 30, { stance: 'offensive' });
  const shut = put(s, 's1', L({ pilot: 'ZPA-46' }), 4, 4, { stance: 'shutdown', link: 0 });
  s.script.opp = M.newOpportunity(eagle.uid, undefined);
  const fb = (target, stance) => ({ kind: 'stanceFeedback', seat: 's1', uid: eagle.uid, actionId: 'ZHDR-206_B', targetUid: target.uid, stance });
  check('D1 Stance feedback switches an Ally Mech in Range', [send(s, fb(ally, 'defensive')).ok, ally.stance], [true, 'defensive']);
  check('D1 not one beyond Range, nor one in Shutdown Stance', [ok(s, fb(far, 'defensive')), ok(s, fb(shut, 'defensive'))], [false, false]);
}

// ---------- D2: the two [Offensive Stance] lines that change a number ----------
{
  const off = { kind: 'mech', stance: 'offensive' };
  check('D2 ZHRA-201_B rolls one more Red in Offensive Stance', U.grantAdjusted(U.stationaryAdjusted(card('ZHRA-201', 'ZHRA-201_B'), null), off, null).redDice, 5);
  const after = (stance) => {
    const s = table();
    const a = put(s, 's1', L({ rightHand: 'ZHRA-102' }), 1, 1, { timing: 'firing', stance });
    open(s);
    send(s, act(a, '041_A'));
    return ok(s, act(a, 'ZHRA-102_A'));
  };
  check('D2 ZHRA-102_A costs a Short Action\'s Tick in Offensive Stance only', [after('offensive'), after('defensive')], [true, false]);
}

// ---------- D3: White Dwarf Cruise Mode ----------
{
  const s = freeTable();
  const wd = put(s, 's1', L({ torso: '287', rightHand: '290', leftHand: '291', backpack: '292' }), 4, 4, { stance: 'offensive' });
  send(s, { kind: 'transformPart', seat: 's1', uid: wd.uid, slot: 'torso', cardId: '288' });
  check('D3 entering Cruise Mode switches to Mobility Stance', [U.cruising(data, wd), wd.stance], [true, 'mobility']);
  const foe = put(s, 's2', L({ pilot: 'FPA-01' }), 8, 4);
  check('D3 no other Stance is selected, and Suppression passes it by', [ok(s, setStance(wd, 'offensive')), ok(s, { kind: 'suppress', seat: 's2', uid: foe.uid, targetUid: wd.uid })], [false, false]);
  check('D3 only the Torso acts, unless an Action says it may in Cruise Mode', [U.actionPartWhy(data, wd, card('290', '290_A')) !== null, U.actionPartWhy(data, wd, card('290', '290_B'))], [true, null]);
  wd.stance = 'shutdown';
  wd.link = 0;
  check('D3 a system failure is the exception, and it Reboots into Mobility', [ok(s, reboot(wd, 'offensive')), ok(s, reboot(wd, 'mobility'))], [false, true]);
}
{
  const atk = kit(mech(1, 's2', 'Attacker', 0), { rightHand: '109' });
  const def = kit(mech(2, 's1', 'Dwarf', 3), { torso: '288', rightHand: '290', leftHand: '291', backpack: '292' });
  def.stance = 'mobility';
  const { h } = windowOn([atk, def]);
  h.start(atk, FIRE, def, 'clear');
  check('D3 an attack on a Cruise Mode Mech always hits the Torso', h.ctx.targetPart, 'torso');
}

// ---------- D4: three cards with no reader ----------
{
  const s = table();
  const carrier = put(s, 's1', L({ backpack: 'ECP10' }), 0, 0);
  const near = droneOn(s, 's1', 'ZHDR-201', 0, 3, { stance: 'defensive' });
  const far = droneOn(s, 's1', 'ZHDR-201', 0, 18, { stance: 'defensive' });
  const foe = put(s, 's2', L({ pilot: 'FPA-01' }), 6, 6);
  const offensive = (d) => U.treatedAsOffensive(d, foe, data, s.tokens);
  check('D4 ECP10 Charge Order: an Ally Drone in Range 4 counts as Offensive, one beyond it does not', [offensive(near), offensive(far)], [true, false]);
  carrier.stance = 'shutdown';
  check('D4 and not from a Shutdown carrier', offensive(near), false);
}
{
  const s = table();
  const fw = put(s, 's1', L({ pilot: 'ZPA-38' }), 0, 0, { link: 3 });
  const foe = put(s, 's2', L({ pilot: 'FPA-01' }), 3, 0);
  s.script.counter = { initiatorUid: fw.uid, responderUid: foe.uid, actionId: 'EWA', initRoll: null, respRoll: null, initFocused: false, respFocused: false, initDeclare: null, respDeclare: null, provoke: null, thenAttack: null };
  const fwCmd = { kind: 'firewatch', seat: 's1', uid: fw.uid };
  const unrolled = ok(s, fwCmd);
  s.script.counter.initRoll = [YEL_EYE];
  check('D4 Firewatch comes after the roll, for 1 Link', [unrolled, send(s, fwCmd).ok, fw.link, s.script.counter.initFirewatch], [false, true, 2, true]);
  check('D4 once per Counter-roll', ok(s, fwCmd), false);
  check('D4 and its {Eye} count as {Lightning}', [M.tallyCounter(dice, [YEL_EYE], false).lightning, M.tallyCounter(dice, [YEL_EYE], false, true).lightning], [0, 1]);
}
{
  const s = table();
  const karl = put(s, 's1', L({ torso: '287', pilot: 'ACE-01' }), 0, 0, { link: 3 });
  const bit = droneOn(s, 's1', '293', 2, 0);
  check('D4 a White Dwarf Bit Focuses on Karl Fried\'s Link', [U.focusPayer(data, s.tokens, bit)?.uid === karl.uid, U.canAffordFocus(data, bit, s.tokens)], [true, true]);
  send(s, { kind: 'focus', seat: 's1', uid: bit.uid });
  check('D4 and the Link comes off his Mech', karl.link, 2);
  karl.stance = 'shutdown';
  check('D4 not while he is Shut Down (a pilot skill, FAQ L3)', [U.focusPayer(data, s.tokens, bit), ok(s, { kind: 'focus', seat: 's1', uid: bit.uid })], [null, false]);
}

// ================= E. Rulings =================

// ---------- E6: the owner picks among its own tied Mechs ----------
{
  const s = table();
  const g = ['ZPA-46', 'ZPA-47', 'ZPA-48'].map((p, i) => put(s, 's1', L({ pilot: p }), i * 3, 1, { timing: 'tactical' }));
  const misty = put(s, 's2', L({ pilot: 'FPA-01' }), 10, 10, { timing: 'tactical' });
  const late = put(s, 's1', L(), 1, 8, { timing: 'tactical' });
  const pick = (t, seat = t.side) => ({ kind: 'chooseTied', seat, uid: t.uid });
  open(s);
  check('E6 token order holds the tied turn until the owner picks', s.script.opp.uid, g[0].uid);
  check('E6 the owner may send another of its tied Mechs, and only those', M.tiedChoices(s, M.makeInit(data)).map((x) => x.uid), [g[1].uid, g[2].uid]);
  check('E6 not the other squad\'s, nor one on a different Initiative', [ok(s, pick(misty)), ok(s, pick(late))], [false, false]);
  send(s, pick(g[2]));
  check('E6 the pick takes the turn', s.script.opp.uid, g[2].uid);
  send(s, end(g[2]));
  check('E6 the squads still alternate', s.script.opp.uid, misty.uid);
  send(s, end(misty));
  check('E6 then this squad\'s next in token order', s.script.opp.uid, g[0].uid);
  send(s, { kind: 'maneuver', seat: 's1', uid: g[0].uid, to: { col: 0, row: 2 } });
  check('E6 and once it has begun, the turn is its own', ok(s, pick(g[1])), false);
  s.round.phase = 1;
  M.glueAfter(data, s, { kind: 'advancePhase', seat: 's1' });
  s.round.phase = 2;
  M.glueAfter(data, s, { kind: 'advancePhase', seat: 's1' });
  check('E6 the picks are forgotten with the round', s.script.tieFirst, []);
}

// ---------- E13: a Shutdown Mech still makes its default Command Token ----------
{
  const s = table();
  put(s, 's1', L(), 1, 1, { stance: 'shutdown', link: 0 });
  check('E13 a Shutdown Mech generates the default 1 Command Token (3.2.1)', M.commandTokensFor(data, s, 's1'), 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
