// MECHANICS AUDIT, PHASE 7 (2026-09-29): the base Common Actions, driven
// through the real command layer, the real readers and the shipped cards. Each
// block is one ruling or finding of Project-Documents/MECHANICS-AUDIT.md
// (P7A: Charge and Discard; P7B: Punch/Kick, Crawl and the Maneuver; P7C:
// Reveal, Scan and Remote Access; P7D: the Match Centre halves, two seats
// relayed in one process; the numbers match each research report), pinned by
// behaviour where the engine holds the rule and by the wiring where a page
// does, and each was mutation-checked: put its fix back and it fails.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { installDom, makeEl, findButtons, label, textOf } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

installDom();
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const entry = new URL('./_mechanics7.entry.ts', import.meta.url);
const out = new URL('./_mechanics7.bundle.mjs', import.meta.url);
writeFileSync(entry, [
  "export { check, apply, checkAfter } from '../src/commands';",
  "export { setLocalSeat } from '../src/loop';",
  "export { AttackHelper } from '../src/combat';",
  "export { loadData } from '../src/data';",
  "export { glueAfter } from '../src/glue';",
  "export { newScriptState, PHASES } from '../src/types';",
  "export { labelFor, namesFrom } from '../src/ledger';",
  "export * as U from '../src/units';",
  "export * as T from '../src/ticks';",
  "export * as Tk from '../src/tasks';",
  "export * as R from '../src/rules';",
  "export * as ML from '../src/melee';",
].join('\n') + '\n');
await build({
  entryPoints: [fileURLToPath(entry)], outfile: fileURLToPath(out),
  bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': '"/"' },
});
const M = await import(`${out.href}?t=${Date.now()}`);
const { U, T, Tk, R, ML } = M;
const data = await M.loadData();

// ---------- a scripted table, the way a strict guided page holds one ----------
function table() {
  return {
    v: 3, map: '', tokens: [], nextUid: 1,
    round: { n: 1, phase: 2, firstPlayer: 's1' },
    commandTokens: { s1: 0, s2: 0 },
    script: { ...M.newScriptState('s1'), strict: true },
    setup: { stage: 'done', rolls: { s1: [], s2: [] }, edge: { s1: 'white', s2: 'black' }, placed: { s1: 0, s2: 0 } },
  };
}
// A free table: no setup, so no guided game.
function freeTable() {
  return U.migrateState({ v: 3, tokens: [], nextUid: 1, round: { n: 1, phase: 2, firstPlayer: 's1' } }, data);
}
const G = (c, r) => ({ col: c * 3, row: r * 3 });
// 041 L-320 SMMG + Type 55 Shield + CC-6 Cleaver (Handheld), 058 AC-39
// Tactical Rifle (Handheld): two full hands.
const L = (extra = {}) => ({ torso: '012', chasis: '020', leftHand: '041', rightHand: '058', backpack: '', pilot: 'FPA-04-2', ...extra });
function put(s, side, loadout, c, r, extra = {}) {
  const t = { ...U.makeMechToken(s, data, loadout, side), ...G(c, r), facing: 0, deployed: true, statuses: [], log: [], ...extra };
  s.tokens.push(t);
  return t;
}
function droneOn(s, side, cardId, c, r, extra = {}) {
  const t = { ...U.makeDroneToken(s, data, data.byId.get(cardId), side), ...G(c, r), facing: 0, deployed: true, statuses: [], log: [], ...extra };
  s.tokens.push(t);
  return t;
}
const open = (s) => M.glueAfter(data, s, { kind: 'noteRoll', seat: 's1', what: 'x' });
const send = (s, cmd) => {
  const v = M.check(data, s, cmd);
  if (v.ok) { M.apply(data, s, cmd); M.glueAfter(data, s, cmd); }
  return v;
};
const ok = (s, cmd) => M.check(data, s, cmd).ok;
const why = (s, cmd) => M.check(data, s, cmd).why ?? '';
const act = (t, actionId, extra = {}) => ({ kind: 'performAction', seat: t.side, uid: t.uid, actionId, partKey: actionId, ...extra });
const named = (t, actionId, slot) => act(t, actionId, { partKey: `${actionId}@${slot}` });
const flip = (t, slot, on) => ({ kind: 'setCharge', seat: t.side, uid: t.uid, slot, on });
const disarm = (by, target, slot) => ({ kind: 'disarm', seat: by.side, uid: by.uid, targetUid: target.uid, slot });
const common = (id) => data.commonActions.find((a) => a.id === id);
const actionOf = (cardId, actionId) => data.byId.get(cardId)?.actions?.find((a) => a.id === actionId);
const freehand = (id) => (data.byId.get(id)?.keywords ?? []).some((k) => k.en === 'Freehand' || k.key === '空手');

console.log('Phase 7: the base actions\n');
console.log('A. Charge and Discard (P7A)\n');

// ---------- R1 / P7A 1: both are Swift Short Actions (p.91, the Quick Cards, FAQ K20) ----------
{
  const charge = common('COMMON_CHARGE');
  const discard = common('COMMON_DISCARD');
  check('P7A 1 Charge and Discard are Swift Short Actions',
    [T.timingOf(charge), T.lengthOf(charge), T.timingOf(discard), T.lengthOf(discard)], ['swift', 'short', 'swift', 'short']);
  const start = (dial) => {
    const s = table();
    const a = put(s, 's1', L({ torso: '098', rightHand: '122' }), 1, 1, { timing: dial });
    open(s);
    return [ok(s, named(a, 'COMMON_CHARGE', 'torso')), ok(s, named(a, 'COMMON_DISCARD', 'leftHand'))];
  };
  check('P7A 1 each is a Starting Action on the Swift dial', start('swift'), [true, true]);
  check('P7A 1 and neither is on the Tactical dial', start('tactical'), [false, false]);
  // Flexible Timing from the Dune's Tactical Coordination aura, which acts last.
  const flex = (dial) => {
    const s = table();
    const a = put(s, 's1', L({ torso: '098', rightHand: '122' }), 1, 1, { timing: dial });
    put(s, 's1', L({ torso: '014' }), 2, 1, { timing: 'tactical' });
    open(s);
    return ok(s, named(a, 'COMMON_CHARGE', 'torso'));
  };
  check('P7A 1 Flexible Timing reaches a Swift Charge from the Melee dial, not the Movement dial', [flex('melee'), flex('movement')], [true, false]);
  const rebooted = (dial) => {
    const s = table();
    const a = put(s, 's1', L({ torso: '098', rightHand: '122' }), 1, 1, { timing: dial, stance: 'shutdown', link: 0 });
    open(s);
    send(s, { kind: 'reboot', seat: 's1', uid: a.uid, stance: 'offensive' });
    return ok(s, named(a, 'COMMON_CHARGE', 'torso'));
  };
  check('P7A 1 the one Action after a Reboot may be a Charge on the Swift dial, not the Tactical (4.1.1, FAQ L8)', [rebooted('swift'), rebooted('tactical')], [true, false]);
  const s = table();
  const a = put(s, 's1', L({ torso: '098', rightHand: '122', backpack: '090' }), 1, 1, { timing: 'swift', link: 5 });
  open(s);
  send(s, { kind: 'overload', seat: 's1', uid: a.uid });
  check('P7A 1 FAQ K20: on Swift Timing an Overloaded Mech may Charge first', send(s, named(a, 'COMMON_CHARGE', 'torso')).ok, true);
  check('P7A 1 and no Long Action follows it: Ticks are spent in order', ok(s, act(a, '122_A')), false);
}

// ---------- R2 / P7A 2, 7: the Action does the work, and names its Part ----------
{
  const s = table();
  const a = put(s, 's1', L({ torso: '098', rightHand: '122' }), 1, 1, { timing: 'swift' });
  open(s);
  check('R2 a guided game refuses a Charge that names no Part', /Name the Part/.test(why(s, act(a, 'COMMON_CHARGE'))), true);
  check('R2 the named Charge Charges its Part by that one command', [send(s, named(a, 'COMMON_CHARGE', 'rightHand')).ok, a.charge], [true, ['rightHand']]);
  check('R2 a guided game refuses a Discard that names no Part', /Name the Part/.test(why(s, act(a, 'COMMON_DISCARD'))), true);
  check('R2 the named Discard turns its Part over by that one command', [send(s, named(a, 'COMMON_DISCARD', 'leftHand')).ok, a.mech.leftHand], [true, '042']);
  check('R2 each hand is its own Discard (FAQ K5)', ok(s, named(a, 'COMMON_DISCARD', 'rightHand')), false);
}
{
  // The repeat the tabletop guide and the Match Centre used to give away: the
  // same Part Charged twice in one Opportunity, its token spent in between.
  const s = table();
  const a = put(s, 's1', L({ leftHand: '540', rightHand: '058', backpack: '090' }), 1, 1, { timing: 'swift', link: 5 });
  open(s);
  send(s, { kind: 'overload', seat: 's1', uid: a.uid });
  send(s, named(a, 'COMMON_CHARGE', 'leftHand'));
  send(s, flip(a, 'leftHand', false));
  send(s, act(a, '540_B'));
  check('P7A 7 the same Part is not Charged twice in one Opportunity', ok(s, named(a, 'COMMON_CHARGE', 'leftHand')), false);
  check('P7A 7 nor turned face-up by hand once its shot is made', ok(s, flip(a, 'leftHand', true)), false);
  check('P7A 7 so the token stays down', a.charge ?? [], []);
}
{
  // A unit's own Charge Action (543_B "Charge for this unit") works the same way.
  const s = table();
  const p = droneOn(s, 's1', '543', 5, 5);
  check('P7A 7 the Porcupine\'s own Charge names the Part printing it', U.chargeSlotOf(data, p, actionOf('543', '543_B')), 'main');
  M.apply(data, s, act(p, '543_B'));
  check('P7A 7 and its own command turns that token face-up', p.charge, ['main']);
  check('P7A 7 a Charged one is refused (FAQ H1)', /already Charged/.test(why(s, act(p, '543_B'))), true);
}

// ---------- R3 / P7A 8: a Part turns over through a Disarm hit or its own Discard ----------
{
  const s = table();
  const hook = put(s, 's1', L({ leftHand: '050' }), 1, 1, { timing: 'melee' });
  const foe = put(s, 's2', L(), 2, 1, { timing: 'tactical' });
  open(s);
  check('R3 a strict guided table Disarms nothing without a hit that owes it', ok(s, disarm(hook, foe, 'rightHand')), false);
  check('R3 nor may a Mech Disarm itself: its own Part goes through the Discard', /Discard Action/.test(why(s, disarm(hook, hook, 'rightHand'))), true);
  send(s, act(hook, '050_A'));
  check('R3 the Grappling Hook, once paid, owes the Disarm its hit may cause', s.script.disarmOwed, { uid: hook.uid, actionId: '050_A' });
  check('R3 so its hit turns the hit Part over', [send(s, disarm(hook, foe, 'rightHand')).ok, foe.mech.rightHand], [true, '059']);
  check('R3 once', ok(s, disarm(hook, foe, 'leftHand')), false);
  const s2 = table();
  const hook2 = put(s2, 's1', L({ leftHand: '050' }), 1, 1, { timing: 'melee' });
  // Out of Contact, so the Firing Action after the Hook is not Melee Locked.
  const foe2 = put(s2, 's2', L(), 6, 6, { timing: 'tactical' });
  open(s2);
  send(s2, act(hook2, '050_A'));
  send(s2, act(hook2, '058_B'));
  check('R3 the next Action closes it', [s2.script.disarmOwed ?? null, ok(s2, disarm(hook2, foe2, 'rightHand'))], [null, false]);
  const f = freeTable();
  const x = put(f, 's1', L(), 1, 1);
  const y = put(f, 's2', L(), 2, 1);
  check('R3 a free table keeps the hand tool, for either side', [ok(f, disarm(y, x, 'leftHand')), ok(f, disarm(x, x, 'rightHand'))], [true, true]);
  // The tabletop card's own Attack button pays nothing, so its Disarm is refused
  // on a strict table; the window then keeps the choice open, not "Disarmed".
  check('R3 the attack window takes the Disarm only when the table accepts it',
    /if \(!accepted\(this\.onCommand\(\{ kind: 'disarm', seat, uid: atkUid, targetUid: defUid, slot \}\)\)\) return;\n\s*this\.onChanged\(\);\n\s*retire\(go, `Disarmed:/.test(src('../src/combat.ts')), true);
}

// ---------- R4 / P7A 10: a Repaired Handheld Part may Discard (FAQ J23; p.78) ----------
{
  const s = table();
  const a = put(s, 's1', L(), 1, 1, { timing: 'swift' });
  a.partStates.leftHand = 'destroyed';
  a.repairedSlots = ['leftHand'];
  a.partStates.rightHand = 'destroyed';
  open(s);
  check('R4 a Repaired Handheld Part is one the Discard may name, a destroyed one is not', U.discardSlots(data, a).map((x) => x.slot), ['leftHand']);
  check('R4 so the Discard is not greyed', U.actionIdleWhy(data, a, common('COMMON_DISCARD'), { tokens: s.tokens }), null);
  check('R4 and it turns over with its Repaired Token (p.78)', [send(s, named(a, 'COMMON_DISCARD', 'leftHand')).ok, a.mech.leftHand, a.repairedSlots], [true, '042', ['leftHand']]);
  check('R4 the destroyed one is refused', ok(s, named(a, 'COMMON_DISCARD', 'rightHand')), false);
  const f = freeTable();
  const b = put(f, 's1', L(), 1, 1);
  b.partStates.leftHand = 'destroyed';
  b.repairedSlots = ['leftHand'];
  b.partStates.rightHand = 'destroyed';
  check('R4 a free table\'s hand flip takes the Repaired Part, not the destroyed one', [ok(f, disarm(b, b, 'leftHand')), ok(f, disarm(b, b, 'rightHand'))], [true, false]);
}

// ---------- R5 / P7A 3: the four Handheld faces carry no Freehand ----------
{
  check('R5 023, 025, 282 and 284 are Handheld only; their Discard Cards are the Freehand ones',
    [['023', '025', '282', '284'].map(freehand), ['024', '026', '283', '285'].map(freehand)], [[false, false, false, false], [true, true, true, true]]);
  const s = table();
  const a = put(s, 's1', L({ leftHand: '023' }), 1, 1, { timing: 'swift' });
  open(s);
  check('R5 the Type 55 Shield + CC-6 Cleaver lends no hand to the rifle\'s [Two-Handed]', U.twoHandedUse(data, a, actionOf('058', '058_A')), null);
  send(s, named(a, 'COMMON_DISCARD', 'leftHand'));
  check('R5 until it is Discarded', [a.mech.leftHand, U.twoHandedUse(data, a, actionOf('058', '058_A'))?.slot], ['024', 'leftHand']);
  const r = table();
  const rifle = put(r, 's1', L({ leftHand: '550', rightHand: '025' }), 1, 1, { timing: 'firing' });
  open(r);
  check('R5 the AC-32 no longer supports its own shot', U.twoHandedUse(data, rifle, actionOf('025', '025_A')), null);
}

// ---------- R6 / P7A 4: [Two-Handed] needs a separate Part ----------
{
  const s = table();
  const k = put(s, 's1', L({ leftHand: '550', rightHand: '145' }), 1, 1, { timing: 'melee' });
  open(s);
  check('R6 the Katana\'s own hand never supports its Slash', U.twoHandedUse(data, k, actionOf('145', '145_B')), null);
  check('R6 and the engine refuses the designation', ok(s, act(k, '145_B', { twoHanded: true })), false);
  const t = table();
  const k2 = put(t, 's1', L({ leftHand: '037', rightHand: '145' }), 1, 1, { timing: 'melee' });
  open(t);
  check('R6 another free hand does', [U.twoHandedUse(data, k2, actionOf('145', '145_B'))?.slot, ok(t, act(k2, '145_B', { twoHanded: true }))], ['leftHand', true]);
}

// ---------- R7 / P7A 6: Throw needs a free Freehand Part (4.17) ----------
{
  const s = table();
  const a = put(s, 's1', L({ backpack: '008' }), 1, 1, { timing: 'projectile' });
  open(s);
  check('R7 a Throw Action with both hands full is refused', /Throw/.test(why(s, act(a, '008_A'))), true);
  check('R7 and every page greys it', U.guidedActions(data, a).find((g) => g.action.id === '008_A')?.available, false);
  const s2 = table();
  const b = put(s2, 's1', L({ backpack: '008', leftHand: '037' }), 1, 1, { timing: 'projectile' });
  open(s2);
  check('R7 with a free hand it is taken', ok(s2, act(b, '008_A')), true);
  s2.tasks = { ...Tk.newTaskState(), items: [{ id: 'bx', kind: 'blackbox', zone: 'echo', control: null, accessed: null, bearerUid: b.uid, bearerSlot: 'leftHand' }] };
  check('R7 a hand bearing a Black Box is not free (5.3.1)', ok(s2, act(b, '008_A')), false);
  const f = freeTable();
  const c = put(f, 's1', L({ backpack: '008' }), 1, 1);
  const d = put(f, 's1', L({ backpack: '008', leftHand: '037' }), 5, 5);
  const beacon = U.guidedActions(data, d).find((g) => g.action.id === '008_A')?.projectiles?.[0]?.id;
  const launch = (t) => ({ kind: 'launch', seat: 's1', uid: t.uid, actionId: '008_A', cardId: beacon, to: { col: t.col, row: t.row + 3 }, facing: 0 });
  check('R7 the card\'s Launch door holds it on every table', [ok(f, launch(c)), ok(f, launch(d))], [false, true]);
}

// ---------- R8 / P7A 11: [Charged] is offered on the KK9's Overwatch Strike ----------
{
  const pad = src('../pad/pad.ts');
  const app = src('../src/main.ts');
  const hud = src('../src/matchhud.ts');
  check('R8 the pad asks the Charge on a granted attack too', /function chargeSlotFor\(attacker: Token, a: CardAction \| undefined, actionId: string\): \{ slot: string \| number; label: string \} \| undefined \{\n\s*if \(!a \|\| !\//.test(pad), true);
  check('R8 the tabletop asks it before the Overwatch Strike\'s shot, and fires the adjusted Action',
    /askChargeSpend\(defender, gun\.id\)\.then\(\(spent\) => \{[\s\S]{0,400}chargeAdjusted\(handed, !!spent, spent\?\.choice\)/.test(app), true);
  check('R8 the Match Centre opens its Charge question, keeping the one target',
    /if \(gun\?\.charge\?\.charged\) chargePlan = \{ uid, on: false, actionId, only: r\.fromUid \};/.test(hud), true);
  // The finding's other half: these doors ask what the card door asks, so
  // [Two-Handed] is offered too (FAQ A16). The Match Centre's pick already did.
  check('P7A 11 the tabletop offers [Two-Handed] on the Overwatch Strike, first',
    /void askTwoHanded\(defender, gun\)\.then\(\(handed\) => askChargeSpend\(defender, gun\.id\)/.test(app), true);
  check('P7A 11 the pad\'s declaration may decline [Two-Handed] on a granted attack',
    /const hands = a \? twoHandedUse\(data!, attacker, a, boxHands\(table\.tasks, attacker\.uid\)\) : null;/.test(pad), true);
}

// ---------- P7A 2: every page turns the Part over ----------
{
  const app = src('../src/main.ts');
  const hud = src('../src/matchhud.ts');
  const guided = src('../pad/guided.ts');
  const panel = src('../src/panel.ts');
  check('P7A 2 the tabletop guide routes the Discard to its own question', /if \(action\.id === 'COMMON_DISCARD'\) \{\n\s*void performDiscard\(t, done\);/.test(app), true);
  check('P7A 2 which pays under the Part named', /done\(true, \{ partKey: `COMMON_DISCARD@\$\{slot\}` \}\);/.test(app), true);
  check('P7A 2 the sandbox has a door in the Details panel\'s one Common Actions area', [/commonActions\?\(t: Token\)/.test(panel), /h\.textContent = 'Common Actions';/.test(panel), /commonActions\(t\) \{/.test(app)], [true, true, true]);
  check('P7A 2 the Match Centre asks its Part', /if \(a\.id === 'COMMON_DISCARD'\) \{\n\s*discardPick = \{ uid: t\.uid \};/.test(hud), true);
  check('P7A 2 and pays under it', /pendingAction = \{ \.\.\.pendingAction, partKey: `COMMON_DISCARD@\$\{slot\}` \};/.test(hud), true);
  check('P7A 2 pad Guided sends no second command after the Action', /api\.send\(\{ kind: 'disarm'/.test(guided), false);
}

// ---------- P7A 5: a Discard removes the old card's pools (4.17) ----------
{
  const f = freeTable();
  const a = put(f, 's1', L({ leftHand: '056', rightHand: '048' }), 1, 1);
  a.ammo['048_A'] = 0;
  send(f, disarm(a, a, 'leftHand'));
  send(f, disarm(a, a, 'rightHand'));
  check('P7A 5 a Discarded G/AC-6 keeps no Rocket pool, and the Smoke Grenade no second one', Object.keys(a.ammo).sort(), ['049_A']);
  check('P7A 5 while the count an Action on the Discard Card uses is carried, spent', a.ammo['049_A'], 0);
  const nb = freeTable();
  nb.noBoard = true;
  const b = put(nb, 's1', L(), 1, 1);
  send(nb, disarm(b, b, 'leftHand'));
  check('P7A 5 an Interception pool is not doubled', [Object.keys(b.intercept ?? {}), b.intercept?.['042_A']], [['042_A'], 1]);
  check('P7A 5 so the old one cannot be spent', ok(nb, { kind: 'spendIntercept', seat: 's1', uid: b.uid, actionId: '041_A' }), false);
}

// ---------- P7A 9: the engine holds FAQ H1/H2, and the hand flip is a refund ----------
{
  const s = table();
  const a = put(s, 's1', L({ torso: '098', rightHand: '122' }), 1, 1, { timing: 'swift' });
  open(s);
  a.charge = ['torso'];
  check('P7A 9 FAQ H1: the Charge Action cannot name a Part already Charged', [ok(s, named(a, 'COMMON_CHARGE', 'torso')), ok(s, named(a, 'COMMON_CHARGE', 'rightHand'))], [false, true]);
  a.charge = ['torso', 'rightHand'];
  const charge = common('COMMON_CHARGE');
  check('P7A 9 FAQ H2: the engine refuses an unnamed Charge with every Part Charged; a page row is left to its idle reading',
    [/Every Chargeable Part/.test(U.actionPartWhy(data, a, charge, undefined, true) ?? ''), U.actionPartWhy(data, a, charge)], [true, null]);
  const plain = put(s, 's1', L({ leftHand: '540', rightHand: '145' }), 5, 5);
  check('P7A 9 and an unnamed Discard with nothing Handheld', [/nothing it can Discard/.test(U.actionPartWhy(data, plain, common('COMMON_DISCARD'), undefined, true) ?? ''), U.actionPartWhy(data, a, common('COMMON_DISCARD'), undefined, true)], [true, null]);
  check('P7A 9 and a Discard naming a Part with no Discard Card', /has no Discard Card/.test(U.actionPartWhy(data, plain, common('COMMON_DISCARD'), 'COMMON_DISCARD@rightHand') ?? ''), true);
  const r = table();
  const m = put(r, 's1', L({ torso: '098', rightHand: '122' }), 1, 1, { timing: 'swift' });
  open(r);
  send(r, named(m, 'COMMON_CHARGE', 'torso'));
  check('P7A 9 a strict guided table refuses a hand flip face-up', ok(r, flip(m, 'rightHand', true)), false);
  send(r, flip(m, 'torso', false));
  check('P7A 9 but refunds the token just spent for an attack abandoned', send(r, flip(m, 'torso', true)).ok, true);
  send(r, flip(m, 'torso', false));
  send(r, act(m, '098_B'));
  check('P7A 9 and not once an Action has been made', ok(r, flip(m, 'torso', true)), false);
  const f = freeTable();
  const n = put(f, 's1', L({ rightHand: '122' }), 1, 1);
  check('P7A 9 a free table keeps the hand flip', ok(f, flip(n, 'rightHand', true)), true);
}

// ---------- P7A 12: the words, the History and the hands ----------
{
  const s = table();
  const a = put(s, 's1', L({ torso: '098' }), 1, 1, { timing: 'swift' });
  a.label = 'Wild Cat';
  open(s);
  check('P7A 12 a standing Part with nothing to Charge is not called destroyed',
    [/no Action with a Charge Icon/.test(why(s, named(a, 'COMMON_CHARGE', 'chasis'))), /destroyed/.test(why(s, named(a, 'COMMON_CHARGE', 'chasis')))], [true, false]);
  const names = M.namesFrom(data);
  check('P7A 12 the History names the Part each acts on',
    [M.labelFor(named(a, 'COMMON_CHARGE', 'rightHand'), s, names).label, M.labelFor(named(a, 'COMMON_DISCARD', 'leftHand'), s, names).label,
      M.labelFor(disarm(a, a, 'leftHand'), s, names).label, M.labelFor(flip(a, 'rightHand', false), s, names).label],
    ['Charge (Right hand) - Wild Cat', 'Discard (Left hand) - Wild Cat', 'Wild Cat Discards its Left hand', 'Wild Cat: Charge Token spent, Right hand']);
  const app = src('../src/main.ts');
  const pad = src('../pad/pad.ts');
  check('P7A 12 the tabletop\'s Common Charge is one command, so one Undo', /if \(action\.id !== 'COMMON_CHARGE' && state\.script\?\.opp\?\.uid !== t\.uid\) setCharge\(t, slot, true\);/.test(app), true);
  check('P7A 12 the pad\'s Freeform Discard is keyed to the hand', /spendFree\(t, 'COMMON_DISCARD', `COMMON_DISCARD@\$\{slot\}`\)/.test(pad), true);
}

// ---------- P7A 13: the texts ----------
{
  const mech = JSON.parse(src('../../data/mechanics.json')).mechanics;
  const ac = mech.find((m) => m.id === 'ammo_and_charge');
  const dc = mech.find((m) => m.id === 'discard');
  check('P7A 13 the Reference calls the Charge Action Swift, never Tactical',
    [/Swift, Short and Silent/.test(ac.points[2]), /Tactical/.test(JSON.stringify(ac))], [true, false]);
  const plainLayer = (m) => [m.basic, ...m.points].every((x) => !/\b\d+\.\d+|FAQ|p\.\d/.test(x)) && m.points.length >= 2 && m.points.length <= 5;
  check('P7A 13 a Discard entry teaches the Handheld tag in both layers, the basic one free of rule numbers',
    [!!dc, dc && plainLayer(dc), dc && /Handheld/.test(dc.basic) && /Advanced|\n\n/.test(dc.text)], [true, true, true]);
  const hook = data.byId.get('050');
  const reaches = (m) => (hook.actions ?? []).some((a) => m.match.some((p) => `${a.description?.en ?? ''} ${a.description?.zh ?? ''}`.toLowerCase().includes(p.toLowerCase())));
  check('P7A 13 and it reaches the Grappling Hook, whose Disarm turns a Part over', reaches(dc), true);
  check('P7A 13 the Common Actions file says one Part, as the Quick Cards print it',
    [/one Part with an Action/.test(common('COMMON_CHARGE').description.en), /one Part with the Handheld Tag/.test(common('COMMON_DISCARD').description.en)], [true, true]);
}

console.log('\nB. Punch/Kick, Crawl and the Maneuver (P7B)\n');

const PUNCH = 'COMMON_PUNCH_MELEE';
const CRAWL = 'COMMON_CRAWL';
// An Opportunity handed straight to the Mech, the way mechanics4-6 build one.
const opp = (uid, over = {}) => ({ uid, timing: 'movement', extra: undefined, maneuver: 1, action: 2, extras: [], maneuvered: false, moved: false, started: false, overload: 0, performed: [], spentExtras: [], ...over });
const move = (t, c, r, extra = {}) => ({ kind: 'maneuver', seat: t.side, uid: t.uid, to: G(c, r), ...extra });
const WD = { torso: '288', chasis: '289', leftHand: '291', rightHand: '290', backpack: '292', pilot: 'FPA-04-2' };
const appSrc = src('../src/main.ts');
const hudSrc = src('../src/matchhud.ts');
const guideSrc = src('../src/playguide.ts');
const padSrc = src('../pad/pad.ts');
const guidedSrc = src('../pad/guided.ts');

// The tabletop's own startMove, moveOpts and sandbox Common Actions, and the
// Match Centre's moveOptsFor, cut out of their pages with the closure stubbed
// (the mechanics4 way), so the planner and the rows a player gets are driven.
const cut = (s, a, b) => {
  const i = s.indexOf(a);
  const j = s.indexOf(b, i + a.length);
  if (i < 0 || j <= i) throw new Error(`could not cut ${a.trim()}`);
  return s.slice(i, j);
};
const pageEntry = new URL('./_mechanics7.pages.ts', import.meta.url);
const pageOut = new URL('./_mechanics7.pages.bundle.mjs', import.meta.url);
writeFileSync(pageEntry, `
import { immobilizedStop, nonHumanoidStop, maneuverRange, straightLineBonus, chassisGone, envMoveRules, phasesThroughUnits, nonHumanoidCost, commonActionStop, actionPartWhy, tokenCards, actionIdleWhy, autoTargetsFor, electronicAll, highlightTargets, linkShockOf, tetheredBy, actionRange } from '../src/units';
import { breakAwayCost, breakAwayLinkBudget, crawlHolders, obstructSurcharge, tetherCap } from '../src/melee';
import { crushTargets, largeGridOf, losNote as losNoteFor } from '../src/rules';
import { discardFaceOf } from '../src/data';
import { check, checkAfter } from '../src/commands';
import { statusCount } from '../src/types';
type Token = any; type CardAction = any; type Facing = any; type MoveOpts = any; type HudCtx = any;
export function tabletop(ctx: any) {
  const { state, data } = ctx;
  let movePlan: any = null;
  const said: string[] = [];
  const hints: string[] = [];
  const calls: any[] = [];
  const say = (kind: string, text: string) => { said.push(kind + ': ' + text); };
  const setHint = (text: string) => { hints.push(text); };
  const moveRangeFor = (t: Token) => maneuverRange(data, t);
  const flyingChoice = async () => ctx.flying ?? false;
  const offerHarpyDrag = async () => null;
  const onChanged = () => {};
  const selectToken = () => {};
  const board: any = { showReachable() {}, panEnabled: true };
  const reachableGrids = () => [];
  const currentTerrain = () => ctx.terrain ?? [];
  const renderMoveCtrl = () => {};
  const breakAwayNote = () => '';
  const tetherNote = () => '';
  const idleWorld = () => ({ tokens: state.tokens, terrain: [] });
  const playGuide = { performFromCard: (uid: number, id: string) => { calls.push(['guide', id]); return !!ctx.guideTakes; } };
  const startCardAttack = (t: Token, id: string) => { calls.push(['attack', id]); };
  const pickDiscardPart = async () => null;
  const perform = () => ({ ok: true });
  const strictNow = () => !!state.script?.strict;
  const logTo = () => {};
  const SLOT_LABEL: any = {};
  const panel = { showToken() {} };
${cut(appSrc, '  function moveOpts(t: Token, flying: boolean', '\n  }\n')}
  }
  const startMoveReal = ${cut(appSrc, '  async function startMove(', '  // A turn on the spot is Movement in its own right').trim().replace(/^async function startMove/, 'async function')};
  const startMove = async (uid: number, opts: any, done: any) => { calls.push(['move', opts.range, opts.action?.id ?? null]); return startMoveReal(uid, opts, done); };
  const cb: any = {
${cut(appSrc, '    commonActions(t) {', '    // The sandbox may nudge anything')}
  };
${cut(appSrc, '  function targetProblem(', '  // Designating a unit in the Optical Camouflage State earns one FREE Scan')}
${cut(appSrc, '  function highlightForced(', '  // A camouflaged unit that performs an Action without Silence Reveals')}
  return { startMove, moveOpts, cb, targetProblem, said, hints, calls, plan: () => movePlan };
}
const terrainOf = (ctx: any) => ctx.terrain ?? [];
const actionOn = (ctx: any, t: any, id: string) => ctx.actions?.[id];
${cut(hudSrc, 'function moveOptsFor(', '\n}\n')}
}
export { moveOptsFor };
`);
await build({
  entryPoints: [fileURLToPath(pageEntry)], outfile: fileURLToPath(pageOut),
  bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': '"/"' },
});
const P = await import(`${pageOut.href}?t=${Date.now()}`);

// ---------- P7B 1: every Melee Action needs line of sight (4.6, p.59) ----------
{
  // A Small enemy in the next Grid, a 3" wall between the two bases: the
  // research probe's board.
  const s = table();
  const mech = put(s, 's1', L(), 4, 4, { facing: 1 });
  const foe = { ...U.makeDroneToken(s, data, data.byId.get('159'), 's2'), col: 16, row: 13, facing: 3, deployed: true, statuses: [], log: [] };
  s.tokens.push(foe);
  const wall = { id: 'w1', type: 'high_wall', subCells: [{ col: 15, row: 12 }, { col: 15, row: 13 }, { col: 15, row: 14 }], height: 3, blocksLos: true, providesProtection: true, isFragile: false };
  const punch = { ...common(PUNCH), range: U.actionRange(data, s.tokens, mech, common(PUNCH)) };
  const note = (a, terrain) => R.losNote(mech, foe, a, terrain, s.tokens, [], true);
  check('P7B 1 a Punch at an Adjacent unit behind a 3" wall is refused', /✕ Melee needs line of sight/.test(note(punch, [wall])), true);
  check('P7B 1 and so is a Part\'s "--" Melee', /✕ Melee needs line of sight/.test(note(actionOf('ZHDR-201', 'ZHDR-201_A'), [wall])), true);
  check('P7B 1 with the wall gone it lands', note(punch, []).includes('✕'), false);
  check('P7B 1 Extended Melee keeps its own line', /✕ Extended Melee needs line of sight/.test(note(actionOf('182', '182_B'), [wall])), true);
  check('P7B 1 the same wall denies the Melee Lock (p.46)', ML.lockersOf(data, foe, s.tokens, [wall]).length, 0);
  check('P7B 1 the Match Centre names a refusal off its ✕ lines alone, so "adjacent (R1)" no longer reads as out of Range',
    /const bad = note\.split\(' · '\)\.filter\(\(x\) => x\.startsWith\('✕'\)\)\.join\(' · '\);\n\s*if \(bad\) \{/.test(hudSrc), true);
}

// ---------- P7B 5: the strict tabletop refuses Range, the arc and sight ----------
{
  // The tabletop's own target gate, which a strict table refuses the click on.
  const s = table();
  const m = put(s, 's1', L(), 4, 4, { facing: 0 });
  const far = put(s, 's2', L(), 4, 0);
  const behind = put(s, 's2', L(), 4, 5);
  const front = put(s, 's2', L(), 5, 3);
  const h = P.tabletop({ state: s, data });
  const problem = (foe) => h.targetProblem(m, foe, common(PUNCH), 'attack');
  check('P7B 5 a Punch 4 Grids ahead is refused, not only warned about', /target not adjacent/.test(problem(far) ?? ''), true);
  check('P7B 5 and one behind the Mech', /NOT in forward arc/.test(problem(behind) ?? ''), true);
  check('P7B 5 while the front diagonal is a target (FAQ A9)', problem(front), null);
  const w = table();
  const mech = put(w, 's1', L(), 4, 4, { facing: 1 });
  const foe = { ...U.makeDroneToken(w, data, data.byId.get('159'), 's2'), col: 16, row: 13, facing: 3, deployed: true, statuses: [], log: [] };
  w.tokens.push(foe);
  const wall = { id: 'w1', type: 'high_wall', subCells: [{ col: 15, row: 12 }, { col: 15, row: 13 }, { col: 15, row: 14 }], height: 3, blocksLos: true, providesProtection: true, isFragile: false };
  check('P7B 5 and one behind a 3" wall (P7B 1)', /Melee needs line of sight/.test(P.tabletop({ state: w, data, terrain: [wall] }).targetProblem(mech, foe, common(PUNCH), 'attack') ?? ''), true);
  check('P7B 5 a strict table refuses the click on it', /const problem = attacker && defender && action && !intercepting \? targetProblem\(attacker, defender, action, mode\) : null;\n\s*if \(problem && strictNow\(state\)\) \{/.test(appSrc), true);
}

// ---------- R1 / P7B 3: an arm may Crawl with the Chassis destroyed ----------
{
  const s = table();
  const m = put(s, 's1', L(), 4, 4, { timing: 'movement' });
  m.partStates.chasis = 'destroyed';
  s.script.opp = opp(m.uid);
  check('R1 the Crawl is the one Movement Action a destroyed Chassis leaves',
    [U.chassisStop(m, common(CRAWL)), /cannot perform Movement Actions but a Crawl/.test(U.chassisStop(m, actionOf('020', '020_A')) ?? '')], [null, true]);
  check('R1 so the engine takes it, unnamed or by an arm', [ok(s, act(m, CRAWL)), ok(s, named(m, CRAWL, 'leftHand'))], [true, true]);
  check('R1 but never by the dead Chassis itself', /Chassis is destroyed/.test(why(s, named(m, CRAWL, 'chasis'))), true);
  check('R1 the pages name the first arm', U.commonPartKey(data, m, common(CRAWL)), `${CRAWL}@leftHand`);
  send(s, named(m, CRAWL, 'leftHand'));
  check('R1 and it moves 1 Grid, not 2', [ok(s, move(m, 5, 4, { free: true, actionId: CRAWL })), ok(s, move(m, 6, 4, { free: true, actionId: CRAWL }))], [true, false]);
  const t = table();
  const n = put(t, 's1', L(), 4, 4, { timing: 'movement', statuses: ['immobilized'] });
  t.script.opp = opp(n.uid);
  check('R1 Immobilized still stops it', ok(t, act(n, CRAWL)), false);
}

// ---------- P7B 2: the tabletop guide turns a Mech with no Chassis (FAQ E4) ----------
{
  const s = table();
  const m = put(s, 's1', L(), 4, 4, { facing: 0 });
  m.partStates.chasis = 'destroyed';
  const h = P.tabletop({ state: s, data });
  let done = 'pending';
  await h.startMove(m.uid, { range: U.maneuverRange(data, m), label: 'Maneuver', maneuver: true, turn: 1 }, (moved) => { done = moved; });
  check('P7B 2 Q/E opens a turn on the spot instead of refusing at Range 0', [h.said, h.plan()?.steps, m.facing, done], [[], 0, 1, 'pending']);
  check('P7B 2 and says it may only turn', /may only change its Facing \(FAQ E4\)/.test(h.hints.at(-1) ?? ''), true);
  const h2 = P.tabletop({ state: s, data });
  await h2.startMove(m.uid, { range: 0, label: 'Sprint', action: actionOf('020', '020_A') }, (moved) => { done = moved; });
  check('P7B 2 a Movement Action with no Range is still refused', [!!h2.plan(), done], [false, false]);
  check('P7B 2 the guide\'s button reads "turn only"',
    [/const turnOnly = range <= 0 && chassisGone\(t\);/.test(guideSrc), /\$\{turnOnly \? 'Maneuver · turn only' : `Maneuver \$\{range\}`\}/.test(guideSrc)], [true, true]);
}

// ---------- R2 / P7B 14: a Crawl never leaves a Melee Lock, flown or walked ----------
{
  const s = table();
  const f = put(s, 's1', L({ leftHand: '117', rightHand: '119' }), 4, 4, { timing: 'movement' });
  put(s, 's2', L(), 5, 4);
  s.script.opp = opp(f.uid);
  check('R2 the Fairy pair flies every move, and is held where it stands', [U.flightGrant(data, f), ML.crawlHolders(data, f, common(CRAWL), s.tokens, []).length], ['always', 1]);
  send(s, named(f, CRAWL, 'chasis'));
  check('R2 the engine refuses its Crawl out of the locked Grid', /a Crawl cannot be used to Break Away \(6\.1\)/.test(why(s, move(f, 4, 3, { free: true, actionId: CRAWL, flying: true }))), true);
  check('R2 and takes a turn in it', ok(s, move(f, 4, 4, { facing: 2, free: true, actionId: CRAWL, flying: true })), true);
  const reach = (opts) => R.reachableGrids(f, 1, [], s.tokens, true, opts).map((g) => `${g.c},${g.r}`);
  const h = P.tabletop({ state: s, data, flying: true });
  check('R2 the tabletop planner lights no Grid out of it for a Crawl', reach(h.moveOpts(f, true, common(CRAWL))), []);
  check('R2 while any other Movement flies out as before', reach(h.moveOpts(f, true, actionOf('020', '020_A'))).length > 0, true);
  check('R2 and the Match Centre planner the same', reach(P.moveOptsFor({ data, state: s, actions: { [CRAWL]: common(CRAWL) } }, f, true, CRAWL)), []);
  await h.startMove(f.uid, { range: 1, label: 'Crawl', action: common(CRAWL) }, () => {});
  check('R2 the tabletop hint says why', /a Crawl cannot be used to Break Away \(6\.1\): it may only turn in its Grid/.test(h.hints.at(-1) ?? ''), true);
  check('R2 the Match Centre move bar says so too', /const held = crawlHolders\(ctx\.data, t, movePlan\.actionId \? actionOn\(ctx, t, movePlan\.actionId\) : null/.test(hudSrc), true);
}

// ---------- R3 / P7B 9: a second Punch or Crawl by another Part ----------
{
  const s = table();
  const m = put(s, 's1', L({ backpack: '090' }), 4, 4, { timing: 'melee', link: 4 });
  s.script.opp = opp(m.uid, { timing: 'melee', action: 4, overload: 2 });
  const first = U.commonPartKey(data, m, common(PUNCH), s.script.opp.performed);
  send(s, act(m, PUNCH, { partKey: first }));
  const second = U.commonPartKey(data, m, common(PUNCH), s.script.opp.performed);
  check('R3 each Punch is keyed to the next Part still free, the Chassis first', [first, second], [`${PUNCH}@chasis`, `${PUNCH}@leftHand`]);
  check('R3 so a second Punch by another Part is taken, the same Part again is not', [ok(s, act(m, PUNCH, { partKey: second })), ok(s, act(m, PUNCH, { partKey: first }))], [true, false]);
  check('R3 every Action other than these two keeps its own key', U.commonPartKey(data, m, common('COMMON_SCAN'), []), 'COMMON_SCAN');
  check('R3 the tabletop guide pays its row under that key', /partKey: commonPartKey\(this\.data, t, c, opp\?\.performed \?\? \[\]\),/.test(guideSrc), true);
  check('R3 the Match Centre keys its row, and its press pays under the Part the engine takes',
    [/key: commonPartKey\(ctx\.data, t, a, o\.performed\)/.test(hudSrc), /partKey: own && first \? first : key \};/.test(hudSrc)], [true, true]);
  check('R3 the pad keys its Freeform row, its attack and its Crawl',
    [/const key = commonKey\(t, a\) \?\? a\.id;/.test(padSrc), /spendFree\(attacker, actionId, lent\.partKey \?\? part\);/.test(padSrc), /const own = commonPartKey\(d, t, a, opp\?\.uid === t\.uid \? opp\.performed : \[\]\);/.test(guidedSrc)], [true, true, true]);
}

// ---------- R4 / P7B 6: a Riposte may be a Punch/Kick ----------
{
  const s = table();
  const m = put(s, 's1', L({ leftHand: '050' }), 4, 4);
  const foe = put(s, 's2', L(), 4, 3);
  s.script.reactions = [{ uid: m.uid, kind: 'riposte', actionId: '050_B', fromUid: foe.uid }];
  check('R4 the Riposte list holds the Parts\' Melee Actions and Punch/Kick', U.riposteMelees(data, m).map((a) => a.id), ['050_A', PUNCH]);
  check('R4 and the engine takes the granted Punch', ok(s, act(m, PUNCH, { granted: true })), true);
  const cruiser = put(s, 's1', WD, 6, 6, { stance: 'mobility' });
  check('R4 a cruising White Dwarf has no Punch to offer', U.riposteMelees(data, cruiser).map((a) => a.id), []);
  const twin = put(s, 's1', L({ leftHand: '145', rightHand: '145' }), 8, 8);
  twin.partStates.leftHand = 'destroyed';
  check('R4 a twin arm lost does not take its twin\'s Actions with it', U.riposteMelees(data, twin).map((a) => a.id), ['145_A', '145_B', PUNCH]);
  check('R4 every page reads that one list',
    [/const melees = riposteMelees\(data, defender\);/.test(appSrc), /const melees = riposteMelees\(ctx\.data, t\);/.test(hudSrc), /const melees = riposteMelees\(api\.data, t\);/.test(guidedSrc)], [true, true, true]);
  // The tabletop door fired the raw Action (P7A's leftover): [Two-Handed] is
  // offered and [Charged] asked, and the swing they make is what lands.
  check('R4 the tabletop Riposte applies [Two-Handed] and [Charged], and refuses a swing a strict table would',
    /void askTwoHanded\(defender, melee\)\.then\(\(handed\) => askChargeSpend\(defender, melee\.id\)\.then\(\(spent\) => \{\n\s*const swing = chargeAdjusted\(handed, !!spent, spent\?\.choice\);\n\s*const problem = targetProblem\(defender, from, swing, 'attack'\);\n\s*if \(problem && strictNow\(state\)\) \{/.test(appSrc)
      && /attackHelper\.start\(defender, swing, from, losNote\(defender, from, swing\)/.test(appSrc), true);
  check('R4 the Match Centre prints "--" rather than R0', /\$\{a\.range \? `R\$\{a\.range\}` : 'R --'\}/.test(hudSrc), true);
}

// ---------- R5 / P7B 12: a Repaired Chassis moves as normal (p.96) ----------
{
  const s = table();
  const m = put(s, 's1', L(), 4, 4, { timing: 'movement' });
  m.partStates.chasis = 'destroyed';
  m.repairedSlots = ['chasis'];
  s.script.opp = opp(m.uid);
  check('R5 it gives its Maneuver Value and carries the Shock walk', [U.maneuverRange(data, m) > 0, U.shockMoveAllowed(m), U.chassisGone(m)], [true, true, false]);
  check('R5 so its Maneuver may step', ok(s, move(m, 5, 4)), true);
  const n = put(s, 's1', L(), 8, 8);
  n.partStates.chasis = 'destroyed';
  check('R5 a destroyed one still may not', [U.maneuverRange(data, n), U.shockMoveAllowed(n), U.chassisGone(n)], [0, false, true]);
  check('R5 the Match Centre reads "turn only" and opens its pivot off the same test',
    [/chassisGone\(t\)\n\s*\? 'turn only'/.test(hudSrc), /const pivotOnly = steps <= 0 && !opts\.actionId && !opts\.range && chassisGone\(t\);/.test(hudSrc)], [true, true]);
}

// ---------- R6 and P7B 10: the Shock Attack walk ----------
{
  const s = table();
  const lancer = put(s, 's1', L({ rightHand: 'ZHRA-103' }), 4, 4, { stance: 'offensive', timing: 'melee' });
  s.script.opp = opp(lancer.uid, { timing: 'melee' });
  lancer.partStates.chasis = 'destroyed';
  send(s, act(lancer, 'ZHRA-103_A'));
  const walk = move(lancer, 5, 4, { free: true, actionId: 'ZHRA-103_A' });
  check('P7B 10 the engine refuses the Shock walk with the Chassis destroyed', /cannot make the move of Shock Attack/.test(why(s, walk)), true);
  lancer.repairedSlots = ['chasis'];
  check('P7B 10 a Repaired one makes it (R5)', ok(s, walk), true);
  lancer.repairedSlots = [];
  lancer.partStates.chasis = 'intact';
  lancer.statuses = ['immobilized'];
  check('R6 Immobilized still stops it', /Immobilized/.test(why(s, walk)), true);
}

// ---------- P7B 11: the Common Actions are a Mech's (3.4.3) ----------
{
  const s = table();
  const d = droneOn(s, 's1', '159', 4, 4);
  s.script.opp = opp(d.uid, { timing: 'melee' });
  check('P7B 11 a Drone may not Punch, Crawl or Stabilize',
    [PUNCH, CRAWL, 'COMMON_STABILIZE'].map((id) => /only a Mech has those/.test(why(s, act(d, id)))), [true, true, true]);
}

// ---------- P7B 7: the rows grey what the engine refuses ----------
{
  const s = table();
  const off = put(s, 's1', L(), 4, 4, { stance: 'shutdown' });
  const stuck = put(s, 's1', L(), 6, 6, { statuses: ['immobilized'] });
  check('P7B 7 Shutdown greys every Common Action, Immobilized the Crawl alone',
    [!!U.commonActionStop(off, common(PUNCH)), !!U.commonActionStop(stuck, common(CRAWL)), U.commonActionStop(stuck, common(PUNCH))], [true, true, null]);
  check('P7B 7 the tabletop guide greys its rows by it', /blocked: commonActionStop\(t, c\) \?\? actionPartWhy\(this\.data, t, c\) \?\? nothing \?\? undefined,/.test(guideSrc), true);
  check('P7B 7 and asks the engine before a Movement Action moves the Mech (P7B 3)',
    /const paid = row\.action\.type === 'Moving'\n\s*\? check\(this\.data, s, \{ kind: 'performAction', seat: t\.side, uid: t\.uid, actionId: row\.action\.id, partKey: row\.partKey \}\)\n\s*: null;\n\s*const why = row\.blocked \?\? \(verdict\.ok \? undefined : verdict\.why\) \?\? \(paid && !paid\.ok \? paid\.why : undefined\);/.test(guideSrc), true);
  check('P7B 7 the Match Centre greys its Common rows by it', /const commonStop = t\.kind === 'mech' && !slot \? commonActionStop\(t, a\) : null;/.test(hudSrc), true);
  check('P7B 7 the pad takes the Freeform chip off by it', /const reason = commonActionStop\(t, a\) \?\? actionPartWhy\(d, t, a\) \?\? undefined;/.test(padSrc), true);
  check('P7B 7 the guide and the Match Centre grey the Maneuver while Immobilized',
    [/const stuck = ticked\.ok \? immobilizedStop\(t, null\) : null;/.test(guideSrc), /const pinned = man0\.ok \? immobilizedStop\(t, null\) : null;/.test(hudSrc)], [true, true]);
  check('P7B 7 pad Guided greys its Moved chip by the engine\'s own answer',
    /const moveCheck = !opp\.maneuvered && opp\.maneuver > 0 && t\.stance !== 'shutdown'\n\s*\? api\.check\(\{ kind: 'maneuver', seat: t\.side, uid: t\.uid, to: \{ col: 0, row: 0 \} \}\)/.test(guidedSrc)
      && /moveCheck\.ok \? '' : refused\(api, moveCheck\.why\)/.test(guidedSrc), true);
  // The engine side of that chip: after a Punch the Maneuver Tick is gone.
  const t = table();
  const m = put(t, 's1', L(), 4, 4, { timing: 'melee' });
  put(t, 's2', L(), 4, 3);
  t.noBoard = true;
  t.script.opp = opp(m.uid, { timing: 'melee' });
  send(t, act(m, PUNCH));
  check('P7B 7 and the engine refuses a Maneuver after the Punch', /before any Action Tick/.test(why(t, { kind: 'maneuver', seat: 's1', uid: m.uid, to: { col: 0, row: 0 } })), true);
}

// ---------- P7B 4: the sandbox's Common Actions area ----------
{
  const s = freeTable();
  const m = put(s, 's1', L(), 4, 4);
  const h = P.tabletop({ state: s, data });
  const rows = (t) => h.cb.commonActions(t).map((r) => [r.id, r.why ? 'greyed' : 'live']);
  check('P7B 4 the sandbox offers Punch/Kick and Crawl beside the Discard', rows(m), [[PUNCH, 'live'], [CRAWL, 'live'], ['COMMON_DISCARD', 'live']]);
  const row = (t, id) => h.cb.commonActions(t).find((r) => r.id === id);
  row(m, PUNCH).go();
  row(m, CRAWL).go();
  check('P7B 4 its Punch opens the card attack door, its Crawl the planner at Range 1', h.calls, [['attack', PUNCH], ['move', 1, CRAWL]]);
  m.partStates.chasis = 'destroyed';
  check('P7B 4 with the Chassis destroyed the Crawl stays live (R1)', row(m, CRAWL).why, null);
  m.partStates.chasis = 'intact';
  m.stance = 'shutdown';
  check('P7B 4 in Shutdown both are greyed', [!!row(m, PUNCH).why, !!row(m, CRAWL).why], [true, true]);
  const d = droneOn(s, 's1', '159', 8, 8);
  check('P7B 4 a Drone has none', h.cb.commonActions(d), []);
}

// ---------- P7B 8: a cruising White Dwarf is told why ----------
{
  const s = table();
  const wd = put(s, 's1', WD, 4, 4, { stance: 'mobility' });
  check('P7B 8 Cruise Mode, not a destroyed Part, is the reason', [U.actionPartWhy(data, wd, common(PUNCH)), U.actionPartWhy(data, wd, common(CRAWL))].map((x) => /Cruise Mode only the Torso acts/.test(x ?? '')), [true, true]);
  const bare = put(s, 's1', L(), 6, 6);
  bare.partStates.chasis = 'destroyed'; bare.partStates.leftHand = 'destroyed'; bare.partStates.rightHand = 'destroyed';
  check('P7B 8 while a Mech with no limb left keeps its own words', /No surviving Part can initiate Punch/.test(U.actionPartWhy(data, bare, common(PUNCH)) ?? ''), true);
}

// ---------- P7B 13 and 15: the data and the words ----------
{
  const punch = common(PUNCH);
  check('P7B 13 Punch/Kick carries its printed "--" as Range 0, and only its printed line',
    [punch.range, punch.description.en], [0, '· Performed with Chassis, Left Arm or Right Arm.']);
  check('P7B 13 the pad prints "--" where the Scan-first lead read "Range 0"', /const range = a\?\.range === 0 \? 'Range --'/.test(padSrc), true);
  check('P7B 15 the pad names the Crawl\'s 1 Grid and its Melee Lock bar', /Crawl, 1 Grid\$\{part \? ` with its \$\{part\}` : ''\}\. It cannot be used to Break Away/.test(guidedSrc), true);
  check('P7B 15 and its Moved chip reads Turned on a destroyed Chassis', /turnOnly \? 'Turned \(M\)' : 'Moved \(M\)'/.test(guidedSrc), true);
}

// ---------- the Reference ----------
{
  const mech = JSON.parse(src('../../data/mechanics.json')).mechanics;
  const by = (id) => mech.find((m) => m.id === id);
  check('Reference: The Maneuver, Punch / Kick and Crawl have entries of their own', ['maneuver', 'punch_kick', 'crawl'].map((id) => by(id)?.name ?? null), ['The Maneuver', 'Punch / Kick', 'Crawl']);
  check('Reference: the Maneuver reaches the cards that print it', by('maneuver').match, ['调整移动']);
  check('Reference: Crawl states R1 and R2 in both layers',
    [/Chassis destroyed a Mech can still Crawl with an arm/.test(by('crawl').points.join(' ')), /not even flying/.test(by('crawl').points.join(' ')), /Chassis destroyed a Mech may still Crawl with an arm/.test(by('crawl').text), /pending ruling/.test(by('crawl').text)],
    [true, true, true, false]);
  check('Reference: Punch / Kick needs sight in its basic view', /in sight/.test(by('punch_kick').basic), true);
  check('Reference: movement and break_away follow R1 and R2',
    [by('movement').points.includes('A Mech with a destroyed Chassis makes no Movement Action but a Crawl, and its Maneuver may only turn it.'), /a Crawl cannot Break Away at all, even as Flying Movement/.test(by('break_away').text)], [true, true]);
}

console.log('\nC. Reveal, Scan and Remote Access (P7C)\n');

// TM641 Octopus Stealth Core: 096_B Activates Optical Camouflage (Tactical,
// Medium), Stealth 2; 096_A Ambush is Silent.
const OCT = L({ torso: '096' });
const FOE = L({ pilot: 'FPA-01' });
const hop = (t, c, r) => ({ kind: 'reveal', seat: t.side, uid: t.uid, to: G(c, r), facing: 1 });
const scanAt = (by, u, over = {}) => ({ kind: 'startCounterRoll', seat: by.side, uid: by.uid, actionId: 'COMMON_SCAN', targetUid: u.uid, ...over });
const kinds = (win) => win.cmds.filter((c) => c.kind === 'queueReactions').flatMap((c) => c.items.map((i) => i.kind));
const diceData = JSON.parse(src('../../data/dice.json'));

// ---------- R1 / P7C 1: a Reveal needs its trigger, and camouflage its Action ----------
{
  const s = table();
  const oct = put(s, 's1', OCT, 6, 6, { statuses: ['camouflage'] });
  const foe = put(s, 's2', FOE, 0, 0);
  s.script.opp = opp(foe.uid, { timing: 'tactical' });
  check('R1 a strict table refuses a Reveal nothing owes, a hop or in place',
    [ok(s, hop(oct, 8, 6)), ok(s, { kind: 'reveal', seat: 's1', uid: oct.uid })], [false, false]);
  check('R1 and says what Reveals a unit', /^Nothing Reveals .* now: a unit leaves Optical Camouflage when it performs \|Reveal\|/.test(why(s, hop(oct, 8, 6))), true);
  s.script.reactions = [{ uid: oct.uid, actionId: 'COMMON_SCAN', count: 1, range: 0, kind: 'manifest', fromUid: foe.uid }];
  check('R1 an enemy\'s won Scan backs it', ok(s, hop(oct, 8, 6)), true);
  s.script.reactions = [];
  // The tabletop walks a token before recording the walk, so the Contact is
  // read off the board as well.
  const touching = put(s, 's2', FOE, 7, 6);
  check('R1 Contact with an enemy backs it, read off the board', ok(s, hop(oct, 6, 8)), true);
  s.tokens = s.tokens.filter((x) => x !== touching);
  s.script.opp = opp(oct.uid, { timing: 'tactical' });
  check('R1 |Reveal| performed owes it, and the Reveal pays the debt',
    [send(s, act(oct, 'COMMON_REVEAL')).ok, send(s, hop(oct, 8, 6)).ok, s.script.revealDue ?? [], oct.statuses.includes('camouflage')], [true, true, [], false]);
  const teach = table();
  teach.script.strict = false;
  const t1 = put(teach, 's1', OCT, 6, 6, { statuses: ['camouflage'] });
  const f = freeTable();
  const t2 = put(f, 's1', OCT, 6, 6, { statuses: ['camouflage'] });
  check('R1 Teaching and a free table keep the hand Reveal', [ok(teach, hop(t1, 8, 6)), ok(f, hop(t2, 8, 6))], [true, true]);
}
{
  const s = table();
  const oct = put(s, 's1', OCT, 6, 6);
  put(s, 's2', FOE, 0, 0);
  s.script.opp = opp(oct.uid, { timing: 'tactical' });
  const cam = { kind: 'applyStatus', seat: 's1', uid: oct.uid, targetUid: oct.uid, statusId: 'camouflage' };
  check('R1 a strict table puts the camouflage on only for its Action', [ok(s, cam), /performs its Activate Optical Camouflage Action first/.test(why(s, cam))], [false, true]);
  send(s, act(oct, '096_B'));
  check('R1 after 096_B it goes on, and the Action is spent on it', [send(s, cam).ok, oct.statuses.includes('camouflage'), s.script.camoOwed ?? null], [true, true, null]);
  s.script.reactions = [{ uid: oct.uid, actionId: 'COMMON_SCAN', count: 1, range: 0, kind: 'manifest', fromUid: 99 }];
  send(s, hop(oct, 8, 6));
  check('R1 so a hop and a hand re-hide no longer make a teleport', ok(s, cam), false);
  const f = freeTable();
  const loose = put(f, 's1', OCT, 6, 6);
  check('R1 a free table keeps its hand tool', ok(f, { kind: 'applyStatus', seat: 's1', uid: loose.uid, targetUid: loose.uid, statusId: 'camouflage' }), true);
  check('R1 pad Guided drops the camouflage tile from its token picker', /d\.handPlaced !== false && !\(d\.id === 'camouflage' && guidedOn\(table\)\)/.test(padSrc), true);
}
// Every page pays before it Reveals or hides.
{
  check('R1 the tabletop\'s |Reveal| pays, and the guide Reveals it by name, never as a house rule',
    [/if \(action\.id === 'COMMON_REVEAL'\) \{\n\s*done\(true\);\n\s*return;\n\s*\}/.test(appSrc),
      /const own = row\.action\.id === 'COMMON_REVEAL';\n\s*const why = own \? 'Reveal \(6\.1\):'/.test(guideSrc),
      /this\.cb\.onReveal\(t, why, !own && !this\.script\(s\)\.strict\);/.test(guideSrc)], [true, true, true]);
  check('R1 the tabletop\'s camouflage is paid, then put on',
    /const can = checkAfter\(data, state, \{ kind: 'performAction', seat: t\.side, uid: t\.uid, actionId: action\.id \}, camo\);[\s\S]{0,200}?done\(true\);\n\s*if \(!performChecked\(camo\)\.ok\) return;/.test(appSrc), true);
  check('R1 the tabletop\'s attack Reveals its attacker after the Tick, not before',
    [/done\?\.\(true\);\n(?:\s*\/\/[^\n]*\n)*\s*if \(!intercepting\) revealForAction\(attacker, action\);/.test(appSrc),
      /if \(!paid\) s\.done\?\.\(true\);\n(?:\s*\/\/[^\n]*\n)*\s*revealForAction\(attacker, s\.action\);/.test(appSrc)], [true, true]);
  check('R1 its Maneuver and pivot Reveal once the Movement is recorded',
    [/m\.done\(true\);\n(?:\s*\/\/[^\n]*\n)*\s*const now = state\.tokens\.find\(\(x\) => x\.uid === t\.uid\);\n\s*if \(hidden && now\) promptReveal/.test(appSrc),
      /m\.done\(true, halt\);\n\s*const now = state\.tokens\.find\(\(x\) => x\.uid === t\.uid\);\n\s*if \(revealWhy && now\) promptReveal\(now, revealWhy\);/.test(appSrc)], [true, true]);
  check('R1 and the guide\'s own Reveal waits its turn with the board\'s (one picker per unit)',
    /onReveal: \(t, why, ask\) => \{\n\s*if \(ask\) \{ promptReveal\(t, why\); return; \}\n\s*if \(revealOpen\.has\(t\.uid\)\) return;\n\s*revealOpen\.add\(t\.uid\);/.test(appSrc), true);
}

// ---------- R7 / P7C 7: an owed Reveal holds the Opportunity; the Scan's debt waits for it ----------
{
  const s = table();
  const oct = put(s, 's1', OCT, 6, 6, { statuses: ['camouflage'] });
  put(s, 's2', FOE, 0, 0);
  s.script.opp = opp(oct.uid, { timing: 'tactical' });
  send(s, act(oct, 'COMMON_REVEAL'));
  const end = { kind: 'endOpportunity', seat: 's1', uid: oct.uid };
  check('R7 the unit that owes a Reveal ends no Opportunity of its own first', [ok(s, end), /owes its Reveal/.test(why(s, end))], [false, true]);
  send(s, { kind: 'reveal', seat: 's1', uid: oct.uid });
  check('R7 made, it may', ok(s, end), true);
  const t = table();
  const hid = put(t, 's1', OCT, 6, 6, { statuses: ['camouflage'] });
  const scanner = put(t, 's2', FOE, 4, 6);
  t.script.reactions = [{ uid: hid.uid, actionId: 'COMMON_SCAN', count: 1, range: 0, kind: 'manifest', fromUid: scanner.uid }];
  const clear = { kind: 'resolveReaction', seat: 's1', uid: hid.uid, actionId: 'COMMON_SCAN' };
  check('R7 the Scan\'s debt is not cleared while its unit is still hidden', ok(t, clear), false);
  send(t, hop(hid, 6, 8));
  check('R7 the Reveal pays it, hop and all', [t.script.reactions, Math.floor(hid.row / 3)], [[], 8]);
  check('R7 every page Reveals first: the Match Centre, the tabletop, pad Guided',
    [/if \(r\.kind === 'manifest' && statusCount\(t\.statuses, 'camouflage'\) > 0\) \{\n\s*openManifest\(ctx, t, 'Scanned:'\);/.test(hudSrc),
      /if \(revealOpen\.has\(defender\.uid\)\) return;\n\s*revealOpen\.add\(defender\.uid\);\n\s*void offerManifestation\(defender, 'Scanned:'\)/.test(appSrc),
      /if \(r\.kind === 'manifest' && \(t\.statuses \?\? \[\]\)\.includes\('camouflage'\)\) \{ api\.send\(\{ kind: 'reveal', seat: t\.side, uid \}\); return; \}/.test(guidedSrc)], [true, true, true]);
}

// ---------- P7C 8: |Reveal| and the Scan with nothing to change ----------
{
  const s = table();
  const m = put(s, 's1', L(), 2, 2);
  const foe = put(s, 's2', FOE, 4, 2);
  s.script.opp = opp(m.uid, { timing: 'tactical' });
  check('P7C 8 |Reveal| by a unit not hidden, and a Scan with no one to change, are refused (FAQ H2, J8)',
    [ok(s, act(m, 'COMMON_REVEAL')), ok(s, act(m, 'COMMON_SCAN'))], [false, false]);
  m.statuses = ['camouflage'];
  foe.statuses = ['lowProfile'];
  check('P7C 8 the controls: hidden it may Reveal, and a Low Profile enemy in Range may be Scanned',
    [ok(s, act(m, 'COMMON_REVEAL')), ok(s, act(m, 'COMMON_SCAN'))], [true, true]);
}

// ---------- R8: |Reveal| by any Part that can still act ----------
{
  const s = table();
  const oct = put(s, 's1', OCT, 6, 6, { statuses: ['camouflage'] });
  for (const k of ['chasis', 'leftHand', 'rightHand', 'backpack']) oct.partStates[k] = 'destroyed';
  s.script.opp = opp(oct.uid, { timing: 'tactical' });
  check('R8 every Part may initiate it, and a Mech left with its Torso still does', [common('COMMON_REVEAL').slots.length, ok(s, act(oct, 'COMMON_REVEAL'))], [5, true]);
}

// ---------- R2 / P7C 2: one paid Action, one Counter-roll ----------
{
  const s = table();
  const m = put(s, 's1', L(), 2, 2);
  const lp = put(s, 's2', FOE, 5, 2, { statuses: ['lowProfile'] });
  s.script.opp = opp(m.uid, { timing: 'tactical' });
  check('R2 no roll opens that no Action paid for', [ok(s, scanAt(m, lp)), /has no Counter-roll paid for/.test(why(s, scanAt(m, lp)))], [false, true]);
  check('R2 asked as the table will stand once paid, on a copy', [M.checkAfter(data, s, act(m, 'COMMON_SCAN'), scanAt(m, lp)).ok, s.script.counterOwed ?? null], [true, null]);
  send(s, act(m, 'COMMON_SCAN'));
  check('R2 the paid Scan opens its roll', send(s, scanAt(m, lp)).ok, true);
  send(s, { kind: 'clearCounterRoll', seat: 's1' });
  check('R2 and one roll only: a second on the same Tick is refused', ok(s, scanAt(m, lp)), false);
  const e = table();
  const pod = put(e, 's1', L({ backpack: '089' }), 2, 2);
  const target = put(e, 's2', FOE, 6, 2);
  const foe = put(e, 's2', FOE, 11, 11);
  e.script.opp = opp(foe.uid, { timing: 'swift' });
  const ea = { kind: 'startCounterRoll', seat: 's1', uid: pod.uid, actionId: '089_A', targetUid: target.uid };
  check('R2 an Electronic Attack opens none in the enemy\'s Opportunity', ok(e, ea), false);
  e.script.opp = opp(pod.uid, { timing: 'swift' });
  send(e, act(pod, '089_A'));
  check('R2 its own, paid, does', ok(e, ea), true);
  send(e, { kind: 'endOpportunity', seat: 's1', uid: pod.uid });
  check('R2 and the payment does not outlive its Opportunity', e.script.counterOwed ?? null, null);
  // A Target Tracing reaction keeps its own proof, the Passive and its Token.
  const tr = table();
  const hunter = put(tr, 's1', L({ torso: '174' }), 0, 0, { statuses: ['command'] });
  const shooter = put(tr, 's2', FOE, 3, 0);
  check('R2 Target Tracing needs no paid Action', ok(tr, { kind: 'startCounterRoll', seat: 's1', uid: hunter.uid, targetUid: shooter.uid, actionId: '174_B', reaction: true }), true);
  check('R2 the tabletop and the Match Centre ask the roll after the payment they are about to make',
    [/const verdict = checkAfter\(data, state, pay, \{ kind: 'startCounterRoll'/.test(appSrc),
      /const can = checkPaid\(ctx, open\);/.test(hudSrc), /const can = checkPaid\(ctx, scan\);/.test(hudSrc)], [true, true, true]);
}
{
  // The tabletop's own reading, driven: a legal Electronic target before the
  // payment is no problem, as it will be once the Action is paid.
  const s = table();
  const pod = put(s, 's1', L({ backpack: '089' }), 2, 2);
  const target = put(s, 's2', FOE, 6, 2);
  s.script.opp = opp(pod.uid, { timing: 'swift' });
  const h = P.tabletop({ state: s, data });
  check('R2 the tabletop\'s target click takes a legal Electronic target before it pays', h.targetProblem(pod, target, actionOf('089', '089_A'), 'electronic'), null);
}

// ---------- R2: a Terminal is accessed only on a won roll ----------
{
  const theft = data.missions.cards.find((c) => c.id === 'terminal-data-extraction');
  const setUp = () => {
    const s = table();
    s.mission = theft.id;
    s.tasks = Tk.taskItemsFor(data.zoneData.zones, theft);
    const me = put(s, 's1', L(), 6, 5);
    put(s, 's2', FOE, 9, 9);
    s.script.opp = opp(me.uid, { timing: 'tactical' });
    const bravo = Tk.normaliseTasks(s.tasks).items.find((i) => i.zone === 'bravo');
    return { s, me, bravo, access: { kind: 'accessTerminal', seat: 's1', uid: me.uid, itemId: bravo.id } };
  };
  const rolled = (mine, theirs) => {
    const w = setUp();
    send(w.s, act(w.me, 'COMMON_REMOTE_ACCESS'));
    send(w.s, { kind: 'startCounterRoll', seat: 's1', uid: w.me.uid, actionId: 'COMMON_REMOTE_ACCESS', targetUid: Tk.TERMINAL_UID, terminal: w.bravo.id });
    const open = ok(w.s, w.access);
    send(w.s, { kind: 'rollCounter', seat: 's1', uid: w.me.uid, faces: mine });
    send(w.s, { kind: 'rollTerminal', seat: 's2', faces: theirs });
    send(w.s, { kind: 'declareCounterFocus', seat: 's1', uid: w.me.uid, use: false });
    return { ...w, open };
  };
  // Yellow faces: 5 is Lightning, 7 a blank.
  const lost = rolled([7, 7], [5, 5, 5]);
  check('R2 no access while the roll is still open', lost.open, false);
  check('R2 a lost roll accesses nothing (p.87)', [ok(lost.s, lost.access), /The Terminal held/.test(why(lost.s, lost.access))], [false, true]);
  const won = rolled([5, 5], [7, 7, 7]);
  check('R2 a won one accesses it', send(won.s, won.access).ok, true);
  const bare = setUp();
  send(bare.s, act(bare.me, 'COMMON_REMOTE_ACCESS'));
  M.setLocalSeat('s1');
  try {
    // A room: the tabletop's own window keeps no record, so the paid Remote
    // Access is its one access; a shared window spent it opening the record.
    check('R2 in a room with no record, only the unspent paid Remote Access accesses', ok(bare.s, bare.access), true);
    M.apply(data, bare.s, bare.access);
    bare.s.tasks.items.find((i) => i.id === bare.bravo.id).accessed = null;
    check('R2 and it is spent by that access', [bare.s.script.counterOwed ?? null, ok(bare.s, bare.access)], [null, false]);
    const fr = freeTable();
    fr.mission = theft.id;
    fr.tasks = Tk.taskItemsFor(data.zoneData.zones, theft);
    const fm = put(fr, 's1', L(), 6, 5);
    const fb = Tk.normaliseTasks(fr.tasks).items.find((i) => i.zone === 'bravo');
    check('R2 a Freeform table in a room keeps its own judgement', ok(fr, { kind: 'accessTerminal', seat: 's1', uid: fm.uid, itemId: fb.id }), true);
  } finally {
    M.setLocalSeat(null);
  }
  const local = setUp();
  send(local.s, act(local.me, 'COMMON_REMOTE_ACCESS'));
  check('R2 one screen\'s own window judges its own roll', ok(local.s, local.access), true);
}

// ---------- R3 / P7C 3, 4: the free Scan, and a Multi-Target's extra targets ----------
{
  const s = table();
  const gun = put(s, 's1', L({ torso: '547' }), 2, 2, { facing: 1 });   // 547_A Full-auto: Firing, R8, Multi-Target 5
  const first = put(s, 's2', FOE, 4, 2);
  const hid6 = put(s, 's2', L({ torso: '096', pilot: 'FPA-01' }), 8, 2, { statuses: ['camouflage'] });
  const hid7 = put(s, 's2', L({ torso: '096', pilot: 'FPA-01' }), 9, 2, { statuses: ['camouflage'] });
  const behind = put(s, 's2', L({ torso: '096', pilot: 'FPA-01' }), 0, 2, { statuses: ['camouflage'] });
  s.script.opp = opp(gun.uid, { timing: 'firing' });
  send(s, act(gun, '547_A'));
  const extra = (u) => scanAt(gun, u, { thenAttack: { actionId: '547_A', extra: true } });
  check('R3 an extra camouflaged target gets its own free Scan, at the attack\'s Range 8', send(s, extra(hid7)).ok, true);
  check('R3 the record carries it as an extra designation', s.script.counter?.thenAttack, { actionId: '547_A', extra: true });
  check('R3 whose win owes the Reveal alone, no second attack', kinds(U.ewWinCommands(data, gun, hid7, common('COMMON_SCAN'), { thenAttack: s.script.counter.thenAttack })), ['manifest']);
  send(s, { kind: 'clearCounterRoll', seat: 's1' });
  check('R3 that unit has had its Scan: a failure drops only that designation', [ok(s, extra(hid7)), /already made its free Scan of that unit/.test(why(s, extra(hid7)))], [false, true]);
  check('R3 the others keep theirs', ok(s, extra(hid6)), true);
  check('R3 the marker behind the attacker is refused (F8)', ok(s, extra(behind)), false);
  const one = table();
  const rifle = put(one, 's1', L(), 2, 2, { facing: 1 });
  const h1 = put(one, 's2', L({ torso: '096', pilot: 'FPA-01' }), 5, 2, { statuses: ['camouflage'] });
  const h2 = put(one, 's2', L({ torso: '096', pilot: 'FPA-01' }), 6, 2, { statuses: ['camouflage'] });
  one.script.opp = opp(rifle.uid, { timing: 'firing' });
  send(one, act(rifle, '058_A'));
  check('R3 a single-target attack designates no extra one', ok(one, scanAt(rifle, h2, { thenAttack: { actionId: '058_A', extra: true } })), false);
  send(one, scanAt(rifle, h1, { thenAttack: { actionId: '058_A' } }));
  send(one, { kind: 'clearCounterRoll', seat: 's1' });
  check('R3 and after its one free Scan it makes no second at another unit', ok(one, scanAt(rifle, h2, { thenAttack: { actionId: '058_A' } })), false);
}
{
  // The split screen, driven: who it offers a free Scan, and what it draws again.
  const s = table();
  const gun = put(s, 's1', L({ torso: '547' }), 2, 2, { facing: 1 });
  const first = put(s, 's2', FOE, 4, 2);
  const hid6 = put(s, 's2', L({ torso: '096', pilot: 'FPA-01' }), 8, 2, { statuses: ['camouflage'], label: 'Hidden Six' });
  const hid7 = put(s, 's2', L({ torso: '096', pilot: 'FPA-01' }), 9, 2, { statuses: ['camouflage'], label: 'Hidden Seven' });
  put(s, 's2', L({ torso: '096', pilot: 'FPA-01' }), 0, 2, { statuses: ['camouflage'], label: 'Hidden Behind' });
  const a = actionOf('547', '547_A');
  const root = makeEl('div');
  const h = new M.AttackHelper(data, diceData, root, () => {}, () => {});
  h.tokens = () => s.tokens;
  h.terrain = () => [];
  h.smoke = () => [];
  const asked = [];
  let opens = true;
  h.freeScan = (atk, tgt) => { asked.push(tgt.uid); return opens; };
  h.startMulti(gun, a, first, U.multiTargetLimit(a));
  // The test DOM keeps a moved child in both places, so each label is read once.
  const scanButtons = () => [...new Set(findButtons(root).filter((b) => /^Scan .* first/.test(label(b))).map(label))];
  check('P7C 3 the split offers a free Scan only to a marker the attack could designate',
    scanButtons(), [`Scan ${hid6.label} first (free, FAQ I12)`, `Scan ${hid7.label} first (free, FAQ I12)`]);
  opens = false;
  findButtons(root).find((b) => label(b) === `Scan ${hid6.label} first (free, FAQ I12)`).click();
  h.refreshSplit();
  check('R3 a Scan that never opened is offered again', scanButtons().includes(`Scan ${hid6.label} first (free, FAQ I12)`), true);
  opens = true;
  findButtons(root).find((b) => label(b) === `Scan ${hid7.label} first (free, FAQ I12)`).click();
  h.refreshSplit();
  check('R3 one that has had its Scan is not offered another, and is told why',
    [scanButtons().includes(`Scan ${hid7.label} first (free, FAQ I12)`), textOf(root).some((x) => x.includes(`${hid7.label} has had its free Scan`))], [false, true]);
  root.replaceChildren();
  h.refreshSplit();
  check('P7C 4 a panel emptied by the Counter-roll window gets the split back', findButtons(root).some((b) => /^Begin the attack/.test(label(b))), true);
  hid7.statuses = [];
  h.refreshSplit();
  check('P7C 4 once Revealed, still in reach, it is offered as a target', findButtons(root).some((b) => label(b) === `+ ${hid7.label}`), true);
  check('P7C 4 the Match Centre and the pad hand the split a free Scan; the tabletop asks the engine first',
    [/thenAttack: \{ actionId: action\.id, extra: true \} \}\);/.test(src('../src/match.ts')),
      /freeScan: \(attacker, target, action\) => beginFreeScan\(attacker, action\.id, target, false, true\),/.test(padSrc),
      /h\.freeScan = a\.freeScan \? \(attacker, target, action\) => a\.freeScan!\(attacker, target, action\) : null;/.test(src('../pad/attack.ts')),
      /const v = check\(data, state, \{ kind: 'startCounterRoll', seat: attacker\.side, uid: attacker\.uid, actionId: scan\.id, targetUid: target\.uid, thenAttack: \{ actionId: action\.id, extra: true \} \}\);/.test(appSrc)],
    [true, true, true, true]);
  check('P7C 4 each redraws it as it refreshes, and the pad keeps its panel open beside it',
    [/if \(combatBusy\(\)\) attackHelper\?\.refreshSplit\(\);/.test(src('../src/match.ts')), /syncContest\(\); refreshSplit\(\);/.test(padSrc),
      /closeCombat: \(\) => \{ if \(panel === 'combat' && !attackActive\(\)\) \{ panel = null; render\(\); \} \},/.test(padSrc), /attackHelper\.refreshSplit\(\);/.test(appSrc)], [true, true, true, true]);
  check('P7C 4 the Match Centre closes an extra\'s failed Scan without ending the attack',
    /its attack cannot designate \$\{resp\.label\}\. Its other targets stand \(FAQ I11\)/.test(hudSrc), true);
}
{
  // P7C 3: the tabletop judges a camouflaged marker as the engine does, before its free Scan.
  const s = table();
  const rifle = put(s, 's1', L(), 4, 4, { facing: 1 });
  const behind = put(s, 's2', L({ torso: '096', pilot: 'FPA-01' }), 2, 4, { statuses: ['camouflage'] });
  const ahead = put(s, 's2', L({ torso: '096', pilot: 'FPA-01' }), 7, 4, { statuses: ['camouflage'] });
  s.script.opp = opp(rifle.uid, { timing: 'firing' });
  const h = P.tabletop({ state: s, data });
  const shot = actionOf('058', '058_A');
  check('P7C 3 the tabletop refuses to Scan a marker its attack could not designate, and takes one it could',
    [/cannot designate .*'s marker: .*NOT in forward arc/.test(h.targetProblem(rifle, behind, shot, 'attack') ?? ''), h.targetProblem(rifle, ahead, shot, 'attack')], [true, null]);
}

// ---------- R4 / P7C 5, 6: an Action on every enemy is measured from the unit ----------
{
  const s = table();
  s.map = 'hotspot';
  const eagle = droneOn(s, 's1', 'ZHDR-205', 2, 2);
  droneOn(s, 's1', '165', 6, 2);   // the Raven EC, a Repeater 4 Grids off
  const far = put(s, 's2', FOE, 9, 2);   // 7 from the Eagle, 3 from the Raven
  const scream = actionOf('ZHDR-205', 'ZHDR-205_A');
  const board = { terrain: [], smoke: [] };
  check('R4 Scream is measured from the Eagle by both readers',
    [U.autoTargetsFor(data, s.tokens, eagle, scream, board).length, U.electronicAllTargets(data, s.tokens, eagle, scream).length], [0, 0]);
  s.round.phase = 3;
  s.script.opp = opp(eagle.uid, { timing: undefined });
  check('R4 so a warned mixed squad no longer locks the Automatic Phase', [U.autoShotOwed(data, s.tokens, eagle, board), ok(s, { kind: 'endOpportunity', seat: 's1', uid: eagle.uid })], [null, true]);
  // 097_B Manipulation Interference reaches 4: that enemy is 9 from the
  // Alligator and 3 from the Raven, so only the relay finds it.
  const al = put(s, 's1', L({ torso: '097' }), 2, 4);
  check('R4 a single-target Electronic Attack still goes through the Repeater (FAQ O19)',
    U.autoTargetsFor(data, s.tokens, al, { ...actionOf('097', '097_B'), speed: 'auto' }, board).map((x) => x.uid), [far.uid]);
}

// ---------- P7C 9: pad Freeform's Reveal and Remote Access are not Silent ----------
{
  check('P7C 9 pad Freeform\'s |Reveal| sheds the Low Profile Token with the Reveal',
    /const shed = \(t\.statuses \?\? \[\]\)\.includes\('lowProfile'\)\n\s*&& send\(\{ kind: 'removeStatus', seat: t\.side, uid: t\.uid, targetUid: t\.uid, statusId: 'lowProfile'/.test(padSrc), true);
  check('P7C 9 and its Remote Access Reveals and sheds as the attack doors do',
    /const paid = spendFree\(t, 'COMMON_REMOTE_ACCESS'\);\n(?:\s*\/\/[^\n]*\n)*\s*freeformSilence\(t, a\);\n\s*openTerminalRoll/.test(padSrc), true);
}

// ---------- P7C 10, 11, 12: the data, the texts and the words ----------
{
  check('P7C 10 card 032 wears its mirror\'s keywords: no Silence, no Direct Fire', data.byId.get('032').keywords.map((k) => k.en), ['Stationary', 'Armor Piercing X', 'Freehand']);
  const scan = common('COMMON_SCAN').description.en;
  const ra = common('COMMON_REMOTE_ACCESS').description.en;
  check('R5 / P7C 11 the Common Action texts are the printed rule only',
    [scan.split('\n').length, /FAQ|Silent/.test(scan), /tie|any Grid/.test(ra)], [3, false, false]);
  check('R6 |Reveal| keeps its Manifestation Movement, as p.91 prints it', /Manifestation Movement/.test(common('COMMON_REVEAL').description.en), true);
  check('P7C 12 the pad quotes the effective Range on its one-tap panel',
    /const range = a\?\.range === 0 \? 'Range --' : a\?\.range !== undefined \? `Range \$\{actionRange\(data!, table\.tokens, t, a\)\}`/.test(padSrc), true);
  const mech = JSON.parse(src('../../data/mechanics.json')).mechanics;
  const by = (id) => mech.find((m) => m.id === id);
  check('P7C 12 the Reference: Reveal is Tactical and Short in the basic view, the Scan the Torso\'s and no Drone\'s',
    [/Tactical and Short, 1 Action Tick/.test(by('revealed').points[0]), /made with the Torso, at Range 6\. Drones do not have it\./.test(by('scanning').points[0])], [true, true]);
  check('P7C 12 a Multi-Target\'s failed free Scan leaves out only that target (R3)', /leaves out only that target/.test(by('scanning').text), true);
  check('P7C 12 no stale Firewatch exchange, and P12 no longer cited for the Scan',
    [/Firewatch/.test(by('electronic_counter_roll').text), /Remote Access and Scan cannot use a Repeater at all \(FAQ P12\)/.test(by('repeaters_radar').text)], [false, false]);
}

console.log('\nD. The Match Centre halves (P7D)\n');

// ---------- the engine: R1 / P7D 1 and 8, The Red Shoes' Crush ----------
// The steered Large Mech (s2) stands one Grid from the corner Grid 11,11, where
// a small s2 unit has nowhere to be pushed (the Grid above is full), so
// entering it is the 4.3.6 exchange. The controller (s1, TM35NA) is far off;
// its won Counter-roll left the `control` debt.
function steerTable(victim = '164') {
  const s = table();
  const al = put(s, 's1', L({ torso: 'TM35NA' }), 1, 4, { timing: 'tactical' });
  const foe = put(s, 's2', FOE, 10, 11, { timing: 'firing' });
  put(s, 's2', FOE, 11, 10, { timing: 'firing' });
  const drone = droneOn(s, 's2', victim, 11, 11);
  s.script.reactions = [{ uid: al.uid, actionId: 'TM35NA_B', count: 1, range: 0, kind: 'control', fromUid: foe.uid }];
  return { s, al, foe, drone };
}
const swapFor = (w, seat) => {
  const pair = R.crushExchange(w.foe, [w.drone], { c: 11, r: 11 }, { c: 10, r: 11 }, [], w.s.tokens);
  return { kind: 'crushSwap', seat, uid: w.foe.uid, to: pair.crusher, swaps: pair.victims.map((v) => ({ uid: v.uid, to: v.to })) };
};
const steerTo = (w, to, actionId) => ({ kind: 'controlledMove', seat: 's1', uid: w.al.uid, targetUid: w.foe.uid, to, ...(actionId ? { actionId } : {}) });
{
  const w = steerTable();
  check('R1 / P7D 1 the controller\'s seat makes the exchange of the unit it steers', ok(w.s, swapFor(w, 's1')), true);
  check('R1 and the unit\'s own seat still may', ok(w.s, swapFor(w, 's2')), true);
  const none = steerTable();
  none.s.script.reactions = [];
  const other = steerTable();
  other.s.script.reactions[0].fromUid = other.drone.uid;
  const theirs = steerTable();
  theirs.s.script.reactions[0].uid = theirs.foe.uid;
  check('R1 not without the debt, nor with one over another unit, nor one the other squad holds',
    [none, other, theirs].map((x) => /belongs to the other squad/.test(why(x.s, swapFor(x, 's1')))), [true, true, true]);
  const swap = swapFor(w, 's1');
  send(w.s, swap);
  check('R1 the exchange stamps the debt where it left the unit', w.s.script.reactions[0].placed, swap.to);
  check('R1 so no second exchange rides the same debt', /already ended in its Crush/.test(why(w.s, swap)), true);
  check('R1 nor a Sprint on from there: the Crush ended the Movement (4.3.6)', /ended in the Crush exchange/.test(why(w.s, steerTo(w, G(8, 11), '020_A'))), true);
  check('R1 the controlledMove where the exchange left it records the Movement and spends the debt',
    [send(w.s, steerTo(w, swap.to)).ok, w.s.script.reactions.length], [true, 0]);
  const spent = steerTable();
  send(spent.s, steerTo(spent, G(10, 10)));
  check('R1 a debt already spent makes no exchange', /belongs to the other squad/.test(why(spent.s, swapFor(spent, 's1'))), true);
  const kept = steerTable();
  kept.s.script.reactions[0].placed = { col: 33, row: 33 };
  const good = U.migrateState(JSON.parse(JSON.stringify(kept.s)), data).script.reactions[0];
  kept.s.script.reactions[0].placed = { col: 'x', row: 3 };
  const bad = U.migrateState(JSON.parse(JSON.stringify(kept.s)), data).script.reactions[0];
  check('R1 a checkpoint keeps the stamp and drops a malformed one', [good.placed, 'placed' in bad, bad.kind], [{ col: 33, row: 33 }, false, 'control']);
}

// ---------- the engine: R3 / P7D 1, who closes an Electronic Counter-roll ----------
{
  // Yellow faces: 5 is Lightning, 7 a blank. Both hands in and neither side
  // Focusing is a settled record (FAQ G4).
  const settled = (initRoll, respRoll) => ({ initRoll, respRoll, initFocused: false, respFocused: false,
    initDeclare: initRoll ? false : null, respDeclare: respRoll ? false : null, provoke: null, thenAttack: null });
  const duelTable = (initRoll, respRoll) => {
    const s = table();
    const me = put(s, 's1', L({ torso: '097' }), 2, 2, { timing: 'tactical' });
    const foe = put(s, 's2', FOE, 2, 4, { timing: 'firing' });
    s.script.counter = { initiatorUid: me.uid, responderUid: foe.uid, actionId: '097_B', ...settled(initRoll, respRoll) };
    return s;
  };
  const theft = data.missions.cards.find((c) => c.id === 'terminal-data-extraction');
  const terminalTable = (initRoll, respRoll) => {
    const s = table();
    s.mission = theft.id;
    s.tasks = Tk.taskItemsFor(data.zoneData.zones, theft);
    const me = put(s, 's1', L(), 6, 5, { timing: 'tactical' });
    put(s, 's2', FOE, 9, 9);
    const bravo = Tk.normaliseTasks(s.tasks).items.find((i) => i.zone === 'bravo');
    s.script.counter = { initiatorUid: me.uid, responderUid: Tk.TERMINAL_UID, actionId: 'COMMON_REMOTE_ACCESS', terminal: bravo.id, ...settled(initRoll, respRoll) };
    return s;
  };
  const close = (seat) => ({ kind: 'clearCounterRoll', seat });
  M.setLocalSeat('s2');
  try {
    check('R3 across a table the Responder may not close it before the verdict',
      [ok(duelTable(null, null), close('s2')), /closes this Electronic Counter-roll/.test(why(duelTable(null, null), close('s2')))], [false, true]);
    check('R3 nor once the Initiator has won, its Apply still to come', ok(duelTable([5], [7]), close('s2')), false);
    check('R3 but either seat may once the Initiator has lost', ok(duelTable([7], [5]), close('s2')), true);
    check('R3 the Initiator\'s seat closes it at any stage', [ok(duelTable(null, null), close('s1')), ok(duelTable([5], [7]), close('s1'))], [true, true]);
    check('R3 a Remote Access too: the Terminal\'s player closes it only once the Initiator lost',
      [ok(terminalTable([5], [7, 7, 7]), close('s2')), ok(terminalTable([7], [5, 5, 5]), close('s2'))], [false, true]);
  } finally {
    M.setLocalSeat(null);
  }
  check('R3 one screen holds both hands and closes it freely', ok(duelTable([5], [7]), close('s2')), true);
}

// ---------- the Match Centre, two seats in one process ----------
// The real matchhud.ts, bundled with its module-private surface exposed by an
// in-memory onLoad hook (the file on disk is untouched) and dialog.ts answered
// with its cancel. Importing the bundle twice gives two pages, each with its
// own HUD state, command hooks and local seat. The relay hands what one
// performs to the other through applyRemote and drops what the server would,
// a command sent as the other squad (match.ts relay.onCommand).
globalThis.sessionStorage ??= globalThis.localStorage;
globalThis.location ??= { search: '', hash: '', href: 'http://localhost/', pathname: '/', origin: 'http://localhost' };
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.addEventListener ??= () => {};
globalThis.removeEventListener ??= () => {};
globalThis.getComputedStyle ??= () => ({ getPropertyValue: () => '' });
try { Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', clipboard: { writeText: async () => {} } }, configurable: true }); } catch {}
{
  const styled = (el) => { el.style.setProperty = () => {}; el.style.removeProperty = () => {}; return el; };
  const make = globalThis.document.createElement;
  globalThis.document.createElement = (tag) => styled(make(tag));
  styled(globalThis.document.documentElement);
  styled(globalThis.document.body);
  globalThis.document.activeElement = null;
}
const HUD_EXPOSE = `
export const __p7d = {
  panelHtml, renderBoard, boardCallbacks, previewMove, commitWaypoint, commitMove, contestAct,
  setBoard(b) { board = b; }, setHudRef(c) { hudRef = c; },
  get crushPlan() { return crushPlan; },
};
`;
const DIALOG_STUB = `
export const choiceDialog = async () => null;
export const pickManyDialog = async () => null;
export const confirmDialog = async () => false;
export const alertDialog = async () => {};
export const promptDialog = async () => null;
`;
// The tabletop's commit, cut from main.ts with what it closes over stubbed:
// its planner records a steered Movement, and its Crush sends the Crush's
// commands, where the engine can hear them.
writeFileSync(new URL('./_mechanics7.tabletop.ts', import.meta.url), `
import { check, perform as performReal } from '../src/commands';
import { crushEscapeGrids, crushExchange, crushExchangeSpots, crushTargets, pathCost, breakAwayLinkDue, standingSpot } from '../src/rules';
import { canBeForceMoved } from '../src/melee';
import { mineStopIndex, nonHumanoidCost, envHotEntries, isSilentAction, maneuverIsSilent, actionSilenceDenier, interceptsOwed, isGroundUnit, envCardAt } from '../src/units';
import { statusCount, gridsOf } from '../src/types';
import { snapPlacement } from '../src/board';
export function steered(ctx: any) {
  const { state, data } = ctx;
  let movePlan: any = null;
  let goOn: any = null;
  const said: string[] = [];
  const logs: string[] = [];
  const sent: any[] = [];
  const perform = (d: any, s: any, cmd: any) => { const v = performReal(d, s, cmd); sent.push([cmd.seat, cmd.kind, cmd.uid, v.ok]); return v; };
  const board: any = { animateMove: (_u: number, _s: any, cb: () => void) => cb(), clearHighlights() {}, clearMovePath() {}, renderTokens() {}, renderTerrain() {}, showSmokeTargets() {}, panEnabled: false };
  const logTo = (_t: any, text: string) => { logs.push(text); };
  const say = (kind: string, text: string) => { said.push(kind + ': ' + text); };
  const onChanged = () => {};
  const setHint = () => {};
  const renderMoveCtrl = () => {};
  const currentTerrain = () => [];
  const gridRef = (c: number, r: number) => c + ',' + r;
  const moveOpts = () => ({});
  const promptReveal = (_t: any, why: string) => { said.push('reveal: ' + why); };
  const offerMines = async () => { said.push('offerMines'); };
  const offerBlackBoxes = async () => { said.push('offerBlackBoxes'); };
  const askTowFacing = async () => null;
  const askCrushFacing = async () => undefined;
  const getLocalSeat = () => ctx.seat ?? null;
  const strictNow = (s: any) => !!s.script?.strict;
${cut(appSrc, '  function commitPivot(', '  // Resupply (4.13).')}
${cut(appSrc, '  // `by`: who sends the Crush', '  // Who a Forced Movement leaves facing.')}
  return { commitMove, set plan(p: any) { movePlan = p; }, said, logs, sent, goOn: () => goOn };
}
`);
const hudEntry = new URL('./_mechanics7.hud.ts', import.meta.url);
const hudOut = new URL('./_mechanics7.hud.bundle.mjs', import.meta.url);
writeFileSync(hudEntry, [
  "export * as H from '../src/matchhud';",
  "export { check, perform, applyRemote, onPerformed, onRefused } from '../src/commands';",
  "export { setLocalSeat, getLocalSeat } from '../src/loop';",
  "export { loadData } from '../src/data';",
  "export { ElectronicHelper } from '../src/combat';",
  "export { boardFingerprint } from '../src/secrecy';",
  "export * as G from '../src/glue';",
  "export { steered } from './_mechanics7.tabletop';",
].join('\n') + '\n');
await build({
  entryPoints: [fileURLToPath(hudEntry)], outfile: fileURLToPath(hudOut),
  bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
  plugins: [{
    name: 'p7d-hud',
    setup(b) {
      b.onLoad({ filter: /[\\/]src[\\/]matchhud\.ts$/ }, (args) => ({ contents: readFileSync(args.path, 'utf8') + '\n' + HUD_EXPOSE, loader: 'ts' }));
      b.onLoad({ filter: /[\\/]src[\\/]dialog\.ts$/ }, () => ({ contents: DIALOG_STUB, loader: 'js' }));
    },
  }],
});

// The panel is an HTML string wired by attribute selector: its start tags are
// read into fake elements carrying their attributes, so wireHud binds them and
// a test presses one as a player would.
const unesc = (x) => String(x).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
function panelRoot(html) {
  const tags = [];
  const re = /<([a-zA-Z][\w-]*)((?:\s+[^\s=>"']+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const attrs = {};
    const ar = /([^\s=>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    for (let a = ar.exec(m[2]); a; a = ar.exec(m[2])) attrs[a[1]] = unesc(a[2] ?? a[3] ?? a[4] ?? '');
    tags.push({ tag: m[1].toLowerCase(), attrs });
  }
  const els = tags.map((t) => {
    const el = makeEl(t.tag);
    for (const [k, v] of Object.entries(t.attrs)) if (k.startsWith('data-')) el.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
    el.getAttribute = (k) => (k in t.attrs ? t.attrs[k] : null);
    return el;
  });
  const hit = (t, sel) => sel.split(',').map((x) => x.trim()).some((p) => {
    const m = /^([a-z]+)?((?:\[[^\]]+\])*)$/i.exec(p);
    if (!m || (!m[1] && !m[2])) return false;
    if (m[1] && m[1].toLowerCase() !== t.tag) return false;
    return [...m[2].matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].every(([, k, v]) => k in t.attrs && (v === undefined || t.attrs[k] === v));
  });
  const root = makeEl('div');
  root.querySelectorAll = (sel) => els.filter((_, i) => hit(tags[i], sel));
  root.querySelector = (sel) => els.find((_, i) => hit(tags[i], sel)) ?? null;
  root.tags = tags;
  return root;
}
let pages = 0;
async function page(seat) {
  const Hm = await import(`${hudOut.href}?page=${++pages}&t=${Date.now()}`);
  const hd = await Hm.loadData();
  const c = { M: Hm, X: Hm.H.__p7d, data: hd, seat, state: null, sent: [], notes: [], root: null, html: '', rolls: [], lit: null };
  const board = new Proxy({}, {
    get(_t, p) {
      if (p === 'animateMove') return (_uid, _stops, cb) => cb?.();
      if (p === 'showReachable') return (grids) => { c.lit = grids; };
      if (p === 'panEnabled') return true;
      return () => {};
    },
    set() { return true; },
  });
  c.ctx = {
    data: hd, get state() { return c.state; }, seat, networked: true,
    send(cmd) {
      const v = Hm.perform(hd, c.state, cmd);
      c.sent.push({ cmd: JSON.parse(JSON.stringify(cmd)), ok: v.ok, why: v.why });
      if (v.ok) { Hm.H.glueAfter(hd, c.state, cmd); Hm.H.offerCoordinationAfterManeuver(cmd); }
      return v;
    },
    check: (cmd) => Hm.check(hd, c.state, cmd),
    // Each seat rolls its own hand: a queued face fills every die.
    rollHits: async (n) => {
      const f = c.rolls.shift() ?? [7];
      const faces = Array.from({ length: n }, (_, i) => f[i % f.length]);
      return { hits: faces.map(() => 0), dice: faces.map((face) => ({ color: 'yellow', face })) };
    },
    rollPool: async () => {}, rollDefense: async () => [], diceFeed: [],
    noteNow: (text, kind) => c.notes.push(`[${kind ?? 'refused'}] ${text}`),
    zonesOn: false, toggleZones() {}, mountSide() {}, syncSide() {}, combatBusy: () => false, syncCombatMirror: () => false,
    startAttack: (...a) => c.notes.push(`startAttack ${JSON.stringify(a)}`),
    showTab() {}, diceData, recordMatch: async () => null,
    refresh: () => c.render(),
  };
  c.use = () => { c.X.setBoard(board); c.X.setHudRef(c.ctx); Hm.setLocalSeat(seat); };
  c.render = () => {
    c.use();
    c.html = c.X.panelHtml(c.ctx);
    c.root = panelRoot(c.html);
    Hm.H.wireHud(c.root, c.ctx);
    c.X.renderBoard(c.ctx);
    return c.html;
  };
  c.press = (sel) => { c.use(); const el = c.root.querySelector(sel); if (!el) return false; el.click(); return true; };
  c.row = (attr, value) => c.root.tags.find((t) => (value === undefined ? attr in t.attrs : t.attrs[attr] === String(value)))?.attrs ?? null;
  return c;
}
async function twoSeats(build) {
  const A = await page('s1');
  const B = await page('s2');
  const set = build(A);
  A.state = set.s;
  B.state = JSON.parse(JSON.stringify(set.s));
  const log = [];
  const hook = (from, to) => (cmd) => {
    if (cmd.seat !== from.seat) { log.push({ from: from.seat, kind: cmd.kind, dropped: true }); return; }
    const was = to.M.getLocalSeat();
    to.M.setLocalSeat(to.seat);
    const v = to.M.applyRemote(to.data, to.state, JSON.parse(JSON.stringify(cmd)));
    if (v.ok) to.M.H.glueAfter(to.data, to.state, cmd);
    log.push({ from: from.seat, kind: cmd.kind, ok: v.ok, why: v.why });
    to.M.setLocalSeat(was);
  };
  A.M.onPerformed(hook(A, B));
  B.M.onPerformed(hook(B, A));
  return { A, B, log, ...set };
}
const pause = () => new Promise((r) => setTimeout(r, 15));
const at = (s, uid) => { const u = s.tokens.find((t) => t.uid === uid); return u ? `${Math.floor(u.col / 3)},${Math.floor(u.row / 3)}` : 'gone'; };
const agree = (A, B) => A.M.boardFingerprint(A.state) === B.M.boardFingerprint(B.state);
const sentBy = (c) => c.sent.map((x) => `${x.cmd.seat}:${x.cmd.kind}:${x.ok}`);
async function walk(c, ...grids) {
  c.render();
  c.use();
  for (const [col, row] of grids) { c.X.previewMove(c.ctx, col, row); c.X.commitWaypoint(c.ctx); }
  c.use();
  c.X.commitMove(c.ctx);
  await pause();
  c.render();
}

// ---------- R6 / P7D 3: a command is sent as the local seat's own ----------
{
  const P1 = await page('s1');
  const s = table();
  put(s, 's1', L(), 1, 1, { timing: 'tactical' });
  const theirs = put(s, 's2', FOE, 6, 6, { timing: 'firing' });
  open(s);
  const heard = [];
  P1.M.onRefused((w) => heard.push(w));
  const move = { kind: 'maneuver', seat: 's2', uid: theirs.uid, to: G(6, 7) };
  P1.M.setLocalSeat('s1');
  try {
    const v = P1.M.perform(P1.data, s, move);
    check('R6 / P7D 3 in a room a command sent as the other squad is refused where it is made, and said',
      [v.ok, /Squad 2's to do/.test(v.why ?? ''), heard.length, at(s, theirs.uid)], [false, true, 1, '6,6']);
    check('R6 a table command\'s seat is attribution, stamped with the local seat as before', P1.M.perform(P1.data, s, { kind: 'noteRoll', seat: 's2', what: 'x' }).ok, true);
  } finally {
    P1.M.setLocalSeat(null);
  }
  check('R6 solo and pass-and-play hold no local seat, so nothing is asked of it', [P1.M.perform(P1.data, s, move).ok, at(s, theirs.uid)], [true, '6,7']);
}

// ---------- P7D 2, 3: the board drag in play ----------
{
  // In the other squad's own Opportunity, where its unit's Maneuver is legal.
  const { A, B, theirs } = await twoSeats(() => {
    const s = table();
    put(s, 's1', L(), 1, 1, { timing: 'tactical' });
    const theirs = put(s, 's2', FOE, 6, 6, { timing: 'firing' });
    open(s);
    return { s, theirs };
  });
  A.render();
  A.use();
  A.X.boardCallbacks().onMove(theirs.uid, 6 * 3 + 1, 7 * 3 + 1, false);
  check('P7D 3 a seated player cannot drag the other squad\'s unit, even in its Opportunity: nothing is sent, and the boards agree',
    [A.state.script.opp?.uid === theirs.uid, A.sent.length, at(A.state, theirs.uid), agree(A, B)], [true, 0, '6,6', true]);
}
{
  const { A, me, drone } = await twoSeats(() => {
    const s = table();
    const me = put(s, 's1', L(), 4, 4, { timing: 'firing' });
    const drone = droneOn(s, 's2', '164', 4, 5);
    put(s, 's2', FOE, 10, 10, { timing: 'tactical' });
    open(s);
    return { s, me, drone };
  });
  A.render();
  A.use();
  A.X.boardCallbacks().onMove(me.uid, 4 * 3 + 1, 5 * 3 + 1, false);
  check('P7D 2 a drop on a smaller unit\'s Grid opens the planner\'s Crush, not a bare maneuver into it',
    [A.sent.length, A.X.crushPlan?.uid === me.uid, /Crush: where does/.test(A.html), at(A.state, drone.uid)], [0, true, true, '4,5']);
}
{
  const { A, B, me, mine } = await twoSeats(() => {
    const s = table();
    const me = put(s, 's1', L(), 5, 8, { timing: 'firing', stance: 'mobility' });
    const mine = droneOn(s, 's2', '074', 0, 0, { col: 16, row: 22 });
    put(s, 's2', FOE, 10, 1, { timing: 'tactical' });
    open(s);
    return { s, me, mine };
  });
  A.render();
  A.use();
  A.X.boardCallbacks().onMove(me.uid, 5 * 3 + 1, 6 * 3 + 1, false);
  check('P7D 2 a drop past a Mine stops in its Grid, the rest kept for after the blast (I16)',
    [sentBy(A), A.sent[0]?.cmd.halt, at(B.state, me.uid), U.minesOwed(data, B.state.tokens).some((x) => x.uid === mine.uid && x.victims.includes(me.uid))],
    [['s1:maneuver:true'], 1, '5,7', true]);
}

// ---------- R4 / P7D 4: Go on waits for the Mine's blast ----------
{
  const { A, B, walker } = await twoSeats(() => {
    const s = table();
    const walker = put(s, 's1', L(), 5, 8, { timing: 'movement', facing: 0 });
    droneOn(s, 's2', '074', 0, 0, { col: 16, row: 19 });
    put(s, 's2', FOE, 11, 11, { timing: 'tactical' });
    open(s);
    return { s, walker };
  });
  A.render();
  A.press('[data-doact="020_A"]');
  await walk(A, [5, 7], [5, 6], [5, 5], [5, 4]);
  const goOn = () => A.row('data-act', 'goon');
  check('R4 / P7D 4 the walk stops in the Mine\'s Grid, and Go on is greyed with the reason while its blast is owed',
    [at(A.state, walker.uid), goOn()?.['aria-disabled'], /blast is still owed/.test(goOn()?.['data-why'] ?? ''), 'disabled' in (goOn() ?? {})], ['5,6', 'true', true, false]);
  const n = A.sent.length;
  A.press('[data-act="goon"]');
  check('R4 a press says why and sends nothing', [A.sent.length - n, /blast is still owed/.test(A.notes.at(-1) ?? '')], [0, true]);
  B.render();
  B.press('[data-minego]');
  B.render();
  B.press(`[data-dettarget="${walker.uid}"]`);
  B.press('[data-act="detdone"]');
  A.render();
  check('R4 once its owner has resolved it, Go on is live', [goOn()?.['aria-disabled'] ?? null, U.minesOwed(data, A.state.tokens).length], [null, 0]);
}

// ---------- P7D 5: a Missile's Explosion waits for the Interception its flight owes ----------
{
  const { A, B, missile, target } = await twoSeats((P) => {
    const s = table();
    s.round.phase = 4;
    const launcher = put(s, 's1', L(), 1, 1);
    const missile = droneOn(s, 's1', '071', 5, 3, { kind: 'projectile', parentUid: launcher.uid });
    const target = put(s, 's2', FOE, 5, 6);
    put(s, 's2', L({ pilot: 'FPA-01', backpack: '003' }), 6, 6);
    P.M.G.enterPhase(P.data, s);
    return { s, missile, target };
  });
  A.use();
  A.M.H.startDetonation(missile.uid, '071_A');
  A.render();
  const stale = A.root;
  A.press(`[data-dettarget="${target.uid}"]`);
  B.render();
  check('P7D 5 the flight owes its Interception on both boards, and the owner\'s panel waits on it, not the Explosion',
    [A.state.script.intercepts.length > 0, B.state.script.intercepts.length === A.state.script.intercepts.length, A.row('data-dettarget') === null], [true, true, true]);
  A.use();
  stale.querySelector(`[data-dettarget="${target.uid}"]`).click();
  check('P7D 5 and a second press on a stale panel is refused while it is owed (4.9)',
    [A.notes.filter((x) => x.startsWith('startAttack')).length, /still owes \d+ Interception attempts? from its flight/.test(A.notes.at(-1) ?? '')], [0, true]);
}

// ---------- P7D 6: the route overlay lights what Obstruct's Link reaches ----------
{
  const { A } = await twoSeats(() => {
    const s = table();
    put(s, 's1', L(), 4, 4, { timing: 'firing', stance: 'mobility', link: 4 });
    put(s, 's2', L({ pilot: 'LPA-20' }), 5, 4, { timing: 'tactical' });
    open(s);
    return { s };
  });
  A.render();
  A.press('[data-act="maneuver"]');
  await pause();
  A.render();
  check('P7D 6 the overlay lights the Grids Obstruct\'s Link reaches (LPA-20; ruling I3)',
    (A.lit ?? []).map((g) => `${g.c},${g.r}`).filter((k) => k !== '4,4').sort(), ['3,4', '4,3', '4,5']);
}

// ---------- R5 / P7D 7: a steered route through a Mine stops there, the rest lost ----------
{
  const { A, B, al, foe, mine } = await twoSeats(() => {
    const s = table();
    const al = put(s, 's1', L({ torso: 'TM35NA' }), 1, 1, { timing: 'tactical' });
    const foe = put(s, 's2', FOE, 5, 8, { timing: 'firing' });
    const mine = droneOn(s, 's1', '074', 0, 0, { col: 16, row: 22 });
    s.script.reactions = [{ uid: al.uid, actionId: 'TM35NA_B', count: 1, range: 0, kind: 'control', fromUid: foe.uid }];
    return { s, al, foe, mine };
  });
  A.render();
  A.press(`[data-controlgo="${al.uid}:${foe.uid}:020_A"]`);
  await walk(A, [5, 7], [5, 6], [5, 5]);
  check('R5 / P7D 7 the Sprint The Red Shoes steers through a Mine ends in its Grid on both boards, and the debt with it',
    [sentBy(A), at(A.state, foe.uid), at(B.state, foe.uid), B.state.script.reactions.length], [['s1:controlledMove:true'], '5,7', '5,7', 0]);
  check('R5 and the Mine owes its blast on the steered unit', U.minesOwed(data, B.state.tokens).some((x) => x.uid === mine.uid && x.victims.includes(foe.uid)), true);
}

// ---------- R1, R2 / P7D 8: a steered Movement that ends in a Crush ----------
{
  const { A, B, log, al, foe, drone } = await twoSeats(() => steerTable());
  A.render();
  A.press(`[data-controlgo="${al.uid}:${foe.uid}:"]`);
  await walk(A, [11, 11]);
  check('P7D 8 it opens the Crush for the controller, who faces the exchanged unit (ruling I5)', [A.X.crushPlan?.uid === foe.uid, /Crush: which way does/.test(A.html)], [true, true]);
  A.press('[data-act="crushgo"]');
  check('R1 / P7D 8 the controller\'s seat sends the exchange and the Movement, and both boards agree',
    [sentBy(A), [at(A.state, foe.uid), at(A.state, drone.uid)], [at(B.state, foe.uid), at(B.state, drone.uid)], agree(A, B), B.state.script.reactions.length],
    [['s1:crushSwap:true', 's1:controlledMove:true'], ['11,11', '10,11'], ['11,11', '10,11'], true, 0]);
  check('R1 nothing went out as the other squad', log.filter((x) => x.dropped || !x.ok).length, 0);
}
{
  // The Delphinium cannot be Force-Moved, so the Crush destroys it.
  const { A, B, al, foe, drone } = await twoSeats(() => steerTable('159'));
  A.render();
  A.press(`[data-controlgo="${al.uid}:${foe.uid}:"]`);
  await walk(A, [11, 11]);
  check('R2 / P7D 1 a unit the steered Mech crushes to death is the controller\'s kill, and the Movement lands',
    [A.sent.map((x) => `${x.cmd.seat}:${x.cmd.kind}:${x.cmd.uid === al.uid}:${x.ok}`), B.state.tokens.some((t) => t.uid === drone.uid), at(B.state, foe.uid), agree(A, B)],
    [['s1:recordKill:true:true', 's1:controlledMove:true:true'], false, '11,11', true]);
}

// ---------- R3 / P7D 1: the Match Centre's close, two seats ----------
{
  const duel = async (initFaces, respFaces) => {
    const { A, B, foe } = await twoSeats(() => {
      const s = table();
      const me = put(s, 's1', L({ torso: '097' }), 2, 2, { timing: 'tactical' });
      const foe = put(s, 's2', FOE, 2, 4, { timing: 'firing' });
      s.script.acted = [foe.uid];
      open(s);
      return { s, me, foe };
    });
    A.render();
    A.press('[data-doact="097_B"]');
    A.render();
    A.press(`[data-ewtarget="${foe.uid}"]`);
    if (initFaces) {
      const c0 = A.state.script.counter;
      A.rolls.push(initFaces); A.use(); A.X.contestAct(A.ctx, 'roll', { uid: c0.initiatorUid }); await pause();
      B.rolls.push(respFaces); B.use(); B.X.contestAct(B.ctx, 'roll', { uid: c0.responderUid }); await pause();
      for (let i = 0; i < 4; i++) {
        const c = A.state.script.counter;
        const st = c && U.counterStage(data, A.state.tokens, c);
        if (st === 'declareI') { A.use(); A.X.contestAct(A.ctx, 'declare', { uid: c.initiatorUid, use: false }); }
        else if (st === 'declareR') { B.use(); B.X.contestAct(B.ctx, 'declare', { uid: c.responderUid, use: false }); }
        else break;
        await pause();
      }
    }
    return { A, B };
  };
  const early = await duel(null);
  early.B.use();
  early.B.X.contestAct(early.B.ctx, 'close');
  check('R3 / P7D 1 the Responder\'s close before anyone has rolled is refused, and the exchange stays open on both boards',
    [!!early.A.state.script.counter, !!early.B.state.script.counter, /closes this Electronic Counter-roll/.test(early.B.notes.at(-1) ?? '')], [true, true, true]);
  const won = await duel([5], [7]);
  won.B.use();
  won.B.X.contestAct(won.B.ctx, 'close');
  check('R3 as is its close of a won exchange, whose Apply is the Initiator\'s', [!!won.A.state.script.counter, !!won.B.state.script.counter], [true, true]);
  won.A.use();
  won.A.X.contestAct(won.A.ctx, 'apply');
  check('R3 the Initiator then Applies it and it closes on both boards', [won.A.state.script.counter ?? null, won.B.state.script.counter ?? null], [null, null]);
  const lost = await duel([7], [5]);
  lost.B.use();
  lost.B.X.contestAct(lost.B.ctx, 'close');
  check('R3 once the Initiator has lost, the Responder closes it for both', [lost.A.state.script.counter ?? null, lost.B.state.script.counter ?? null], [null, null]);
}

// ---------- R3 / P7D 1: the window greys the close the engine refuses ----------
{
  const P2 = await page('s2');
  const s = table();
  const me = put(s, 's1', L({ torso: '097' }), 2, 2);
  const foe = put(s, 's2', FOE, 2, 4);
  const action = actionOf('097', '097_B');
  const record = (initRoll, respRoll) => ({ initiatorUid: me.uid, responderUid: foe.uid, actionId: '097_B', initRoll, respRoll, initFocused: false, respFocused: false,
    initDeclare: initRoll ? false : null, respDeclare: respRoll ? false : null, provoke: null, thenAttack: null });
  const drawn = (role, c) => {
    const root = makeEl('div');
    const h = new P2.M.ElectronicHelper(P2.data, diceData, root, () => {}, () => {});
    const acts = [];
    h.tokens = () => s.tokens;
    h.contestAct = (act) => acts.push(act);
    h.showContest(c, me, foe, action, role);
    h.redraw();
    const head = root.children[0];
    return { head: String(head?.innerHTML ?? ''), done: findButtons(root).find((b) => label(b) === 'Done'), x: head?.querySelector('.ah-cancel'), acts };
  };
  const won = drawn('responder', record([5, 5], [7, 7]));
  won.done?.click();
  won.x?.click();
  check('R3 / P7D 1 the Responder\'s Done and ✕ are greyed with the reason while the Initiator\'s win waits on Apply, and do nothing',
    [/closes this Electronic Counter-roll/.test(won.done?.dataset.why ?? ''), /class="ah-cancel" aria-disabled="true" data-why="[^"]*closes this Electronic Counter-roll/.test(won.head), /title=/.test(won.head.match(/<button class="ah-cancel"[^>]*>/)?.[0] ?? ''), won.acts],
    [true, true, false, []]);
  const lost = drawn('responder', record([7, 7], [5, 5]));
  lost.done?.click();
  check('R3 once the Initiator has lost, the Responder\'s Done closes it', [lost.done?.dataset.why ?? null, lost.acts], [null, ['close']]);
  const mine = drawn('initiator', record(null, null));
  mine.x?.click();
  check('R3 the Initiator\'s ✕ closes it at any stage', [/aria-disabled/.test(mine.head), mine.acts], [false, ['close']]);
}

// ---------- the tabletop's Red Shoes (P7D, "for other passes") ----------
{
  const T = await page('s1');
  const sprint = actionOf('020', '020_A');
  const redShoes = (extra) => {
    const s = table();
    const al = put(s, 's1', L({ torso: 'TM35NA' }), 1, 1, { timing: 'tactical' });
    const foe = put(s, 's2', FOE, 5, 8, { timing: 'firing' });
    if (extra) extra(s);
    s.script.reactions = [{ uid: al.uid, actionId: 'TM35NA_B', count: 1, range: 0, kind: 'control', fromUid: foe.uid }];
    return { s, al, foe };
  };
  const commit = async (w, path, action) => {
    const h = T.M.steered({ state: w.s, data: T.data });
    let result = null;
    const t = w.s.tokens.find((x) => x.uid === w.foe.uid);
    h.plan = { uid: t.uid, side: t.side, steps: action ? action.range : 2, flying: false, path, marks: [1], preview: null, label: 'The Red Shoes', action: action ?? null,
      facing0: t.facing, done: (moved, halt) => { result = [moved, halt ?? null]; }, controller: { uid: w.al.uid, side: 's1' } };
    T.M.setLocalSeat('s1');
    try {
      h.commitMove();
      await pause();
    } finally {
      T.M.setLocalSeat(null);
    }
    return { h, result };
  };
  const line = (n) => Array.from({ length: n + 1 }, (_, i) => ({ c: 5, r: 8 - i }));
  const far = redShoes();
  const tooFar = await commit(far, line(5), sprint);
  check('P7D the tabletop records a steered Movement from where it began: one past its Sprint is refused, and the unit stays',
    [tooFar.h.sent.map(([seat, kind, , v]) => `${seat}:${kind}:${v}`), tooFar.result, at(far.s, far.foe.uid), far.s.script.reactions.length, /reaches at most 4 Grids/.test(tooFar.h.said[0] ?? '')],
    [['s1:controlledMove:false'], [false, null], '5,8', 1, true]);
  const fine = redShoes();
  const ran = await commit(fine, line(3), sprint);
  check('P7D its Sprint is recorded as the controller\'s, the debt spent, and nothing of the unit\'s own player is offered',
    [ran.h.sent.map(([seat, kind, , v]) => `${seat}:${kind}:${v}`), ran.result, at(fine.s, fine.foe.uid), fine.s.script.reactions.length, ran.h.said.filter((x) => /offer/.test(x))],
    [['s1:controlledMove:true'], [true, null], '5,5', 0, []]);
  const mined = redShoes((s) => droneOn(s, 's1', '074', 0, 0, { col: 16, row: 22 }));
  const stopped = await commit(mined, line(3), sprint);
  check('R5 on the tabletop too: it stops in the Mine\'s Grid and the rest is lost, no Go on kept',
    [at(mined.s, mined.foe.uid), stopped.result, stopped.h.goOn(), stopped.h.logs.some((x) => /A Mine stops .* The Red Shoes' Movement ends there/.test(x))], ['5,7', [true, null], null, true]);
  const crush = steerTable();
  const crushed = await commit(crush, [{ c: 10, r: 11 }, { c: 11, r: 11 }], null);
  check('R1 on the tabletop the controller\'s seat makes the exchange and records where it ended',
    [crushed.h.sent.map(([seat, kind, , v]) => `${seat}:${kind}:${v}`), at(crush.s, crush.foe.uid), at(crush.s, crush.drone.uid), crush.s.script.reactions.length],
    [['s1:crushSwap:true', 's1:controlledMove:true'], '11,11', '10,11', 0]);
  const kill = steerTable('159');
  const killed = await commit(kill, [{ c: 10, r: 11 }, { c: 11, r: 11 }], null);
  check('R2 and a Crush kill is sent as the controller\'s own',
    [killed.h.sent.map(([seat, kind, uid, v]) => `${seat}:${kind}:${uid === kill.al.uid}:${v}`), kill.s.tokens.some((t) => t.uid === kill.drone.uid)],
    [['s1:recordKill:true:true', 's1:controlledMove:true:true'], false]);
  check('P7D the tabletop\'s Red Shoes hands the planner its controller and records nothing after the move itself',
    /controller: \{ uid: defender\.uid, side: defender\.side \},\n\s*\}, \(moved\) => \{\n\s*const now = state\.tokens\.find\(\(x\) => x\.uid === target\.uid\);\n\s*if \(moved && now\) logTo\(now, /.test(appSrc), true);
}

// ---------- R6 / P7D 3: the pad in a room ----------
{
  check('R6 / P7D 3 the pad offers a Black Box only to its own squad\'s units in a room', /&& !isDead\(u\) && canCommand\(u\)\)/.test(padSrc), true);
  check('R6 and records a drop under one of its own units, from the sheet and from the Penetration',
    (padSrc.match(/send\(\{ kind: 'dropBlackBox', \.\.\.sourceFor\((?:t|bearer)\),/g) ?? []).length, 2);
}

// ---------- P7D 9: the Match Centre's list rows are greyed, never disabled ----------
{
  const rows = ['data-endstep', 'data-tactic', 'data-owmech', 'data-inttarget', 'data-attacktarget', 'data-dettarget'];
  const drawnAt = (attr) => hudSrc.split('\n').filter((l) => new RegExp(`${attr}(?:'\\})?="`).test(l) && /<button/.test(l));
  check('P7D 9 the six list rows are drawn greyed, never truly disabled or titled',
    rows.map((a) => drawnAt(a).length > 0 && drawnAt(a).every((l) => /aria-disabled="true" data-why=/.test(l) && !/' disabled'|disabled title/.test(l))), rows.map(() => true));
  check('P7D 9 and each says why when pressed, sending nothing',
    [...rows, 'data-detscan'].map((a) => new RegExp(`on\\('\\[${a}\\]', \\(el\\) => \\{\\n\\s*if \\(el\\.dataset\\.why\\) \\{ ctx\\.noteNow\\(el\\.dataset\\.why\\); ctx\\.refresh\\(\\); return; \\}`).test(hudSrc)),
    [...rows, 'data-detscan'].map(() => true));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
