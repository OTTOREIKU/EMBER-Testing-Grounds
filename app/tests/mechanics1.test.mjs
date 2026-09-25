// MECHANICS AUDIT, PHASE 1 (2026-09-25): attack and damage, driven through the
// real attack window. Each block is one finding of Project-Documents/
// MECHANICS-AUDIT.md, pinned by behaviour rather than by the shape of the
// source: the dice are set by hand, so every case is deterministic, and each
// one was mutation-checked - put its fix back the way it was and it fails.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { installDom, makeEl, findButtons, label, textOf, mech, settle } from './_combatdrive.mjs';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

installDom();
const entry = new URL('./_mechanics1.entry.ts', import.meta.url);
const out = new URL('./_mechanics1.bundle.mjs', import.meta.url);
writeFileSync(entry, [
  "export { AttackHelper, surplusEffects } from '../src/combat';",
  "export { loadData } from '../src/data';",
  "export { onHitRiders, denseArmorSlot, lightningRiderOf, autoParryValue, dodgeEnhanceOf, twoHandedRider } from '../src/units';",
].join('\n') + '\n');
await build({
  entryPoints: [fileURLToPath(entry)], outfile: fileURLToPath(out),
  bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': '"/"' },
});
const M = await import(`${out.href}?t=${Date.now()}`);
const data = await M.loadData();
const dice = JSON.parse(readFileSync(new URL('../../data/dice.json', import.meta.url), 'utf8'));
const { AttackHelper } = M;

const faceOf = (colour, type, hollow = false) => dice.dice[colour].faces.findIndex((f) => f.length === 1 && f[0].type === type && !!f[0].hollow === hollow);
const BLANK = (colour) => dice.dice[colour].faces.findIndex((f) => f.length === 0);
const RED_HEAVY = faceOf('red', 'heavyHit');
const RED_LIGHTNING = faceOf('red', 'lightning');
const RED_EYE = faceOf('red', 'eye');
const YEL_EYE = faceOf('yellow', 'eye');
const YEL_BLANK = BLANK('yellow');
const WHITE_DEF = faceOf('white', 'defense');
const WHITE_BLANK = BLANK('white');
const BLUE_DODGE = faceOf('blue', 'dodge');
check('the shipped dice carry every face this file sets',
  [RED_HEAVY, RED_LIGHTNING, RED_EYE, YEL_EYE, YEL_BLANK, WHITE_DEF, WHITE_BLANK, BLUE_DODGE].every((i) => i >= 0), true);

const act = (cardId, actionId) => data.byId.get(cardId)?.actions?.find((a) => a.id === actionId);
const common = (id) => data.commonActions.find((a) => a.id === id);
const kit = (t, parts) => { t.mech = { torso: '172', chasis: '179', leftHand: '', rightHand: '', backpack: '', pilot: '', ...parts }; return t; };
const drone = (uid, side, cardId, col) => ({
  uid, side, kind: 'drone', cardId, label: cardId, col, row: 1, size: 1, facing: 0, aerial: false,
  stance: 'defensive', deployed: true, partStates: { main: 'intact' }, statuses: [], ammo: {}, log: [],
});

// A window on a board, with the commands it sends landing on the tokens the way
// the page's own perform() would, for the few that change what it reads next.
function windowOn(tokens, opts = {}) {
  const cmds = [];
  const knocks = [];
  const root = makeEl('div');
  const h = new AttackHelper(
    data, dice, root,
    () => {}, () => {}, () => {},
    (a, d, action, hits) => knocks.push({ d: d.uid, hits }),
    () => {}, () => {},
    (cmd) => {
      cmds.push(cmd);
      const t = tokens.find((x) => x.uid === (cmd.targetUid ?? cmd.uid));
      if (cmd.kind === 'applyPenetration' && t) {
        const cur = t.partStates[cmd.slot] ?? 'intact';
        t.partStates[cmd.slot] = cur === 'intact' && t.kind === 'mech' ? 'damaged' : 'destroyed';
      }
      if (cmd.kind === 'breakRepaired' && t) t.repairedSlots = (t.repairedSlots ?? []).filter((s) => s !== cmd.slot);
      if (cmd.kind === 'forceShutdown' && t) t.stance = 'shutdown';
      return opts.refuse?.(cmd) ? { ok: false, why: 'refused' } : { ok: true };
    },
  );
  h.tokens = () => tokens;
  h.terrain = () => [];
  h.smoke = () => [];
  return { h, root, cmds, knocks };
}
const rolls = (pairs) => pairs.map(([color, face]) => ({ color, face, selected: false }));
const press = (root, rx) => {
  const b = findButtons(root).find((x) => rx.test(label(x)) && !x.disabled);
  if (b) b.click();
  return !!b;
};
// Straight to the Resolution with these dice: the steps in between are not
// what these cases are about, and their own suites drive them.
function resolveWith(h, atk, def) {
  const c = h.ctx;
  c.attackRoll = rolls(atk);
  c.defenseRoll = rolls(def);
  c.focus = { stage: 'done', attackerUse: false, defenderUse: false };
  c.step = 'resolve';
  h.render();
}
async function finishAttack(root) {
  press(root, /^Apply Penetration|^Done$/);
  await settle();
}

console.log('Phase 1: attack and damage\n');

// ---------- A1: Laser Weapon rides only the laser's own Action ----------
{
  const atk = kit(mech(1, 's1', 'Laser Mech', 1), { leftHand: '117' });
  const def = kit(mech(2, 's2', 'Target', 3));
  const { h, root, cmds } = windowOn([atk, def]);
  h.start(atk, common('COMMON_PUNCH_MELEE'), def, 'clear');
  h.pickPart('torso');
  resolveWith(h, [['red', RED_HEAVY]], [['white', WHITE_BLANK]]);
  await finishAttack(root);
  check('A1 a Punch from a Mech carrying a laser arm grants no Fragile',
    cmds.some((c) => c.kind === 'applyStatus' && c.statusId === 'fragile'), false);
  check('A1 while the laser Action itself still carries it',
    M.onHitRiders(act('117', '117_A'), []).some((r) => r.statusId === 'fragile'), true);
}

// ---------- A2: the White-dice floor, and no Armor Piercing in Surplus ----------
{
  const atk = kit(mech(1, 's1', 'Railgun', 1), { rightHand: 'ZHRA-202' });
  const def = kit(mech(2, 's2', 'Thin Arm', 3), { leftHand: 'ZHLA-201' });
  def.statuses = ['fragile', 'fragile'];
  const { h } = windowOn([atk, def]);
  h.start(atk, act('ZHRA-202', 'ZHRA-202_A'), def, 'clear');
  h.pickPart('leftHand');
  const sum = (xs) => xs.reduce((n, p) => n + p.n, 0);
  check('A2 Armor 1 under two Fragile and Armor Piercing 1 still rolls 1 White (p.50)', sum(h.whiteSources()), 1);
  check('A2 and nothing is said to come off that did not', h.whiteSources().filter((p) => p.n < 0).length, 0);
  // Against a Part with dice to spare, so the removal would show if it ran.
  def.statuses = [];
  h.pickPart('torso');
  check("A2 an ordinary roll pierces the Torso's Armor 5", sum(h.whiteSources()), 4);
  h.ctx.surplusRound = 1;
  check('A2 a Surplus roll carries no Armor Piercing (4.8)', [sum(h.whiteSources()), h.whiteSources().some((p) => p.why === 'Armor Piercing')], [5, false]);
}

// ---------- A3: a conditional Mutilation is a grant, not a keyword ----------
{
  check('A3 an Ion shot with no Charge spent does not Mutilate', M.surplusEffects(act('122', '122_A')).map((e) => e.name), []);
  check('A3 nor a one-handed [Two-Handed] Mutilation', M.surplusEffects(act('145', '145_B')).map((e) => e.name), []);
  check('A3 while a printed Mutilation still does', M.surplusEffects(act('005', '005_A')).map((e) => e.name), ['Mutilation']);
  check('A3 and a Scatter-shot beside a [Charged] grant keeps its own line',
    M.surplusEffects(act('140', '140_A')).map((e) => e.name), ['Scatter-shot']);
}

// ---------- A4: a Parry that held stops every On Hit effect ----------
const SHOVE = { id: 'KB_TEST', type: 'Melee', name: { en: 'Shove Strike' }, redDice: 2, yellowDice: 0, range: 0,
  description: { en: '· [On Hit] Knockback 1' }, keywords: [] };
{
  const atk = kit(mech(1, 's1', 'Striker', 1));
  const def = kit(mech(2, 's2', 'Parrier', 3), { leftHand: 'ZHLA-202' });
  const { h, root, knocks } = windowOn([atk, def]);
  h.start(atk, SHOVE, def, 'clear');
  check('A4 a Melee attack on a Parry Part asks the defender first (FAQ C6)', [h.ctx.step, h.ctx.designateFrom], ['designate', '__roll']);
  press(root, /^Designate L\.Arm/);
  check('A4 the declared Parry Part takes the hit with no Part Die', [h.ctx.targetPart, h.ctx.step, h.ctx.designatedParry > 0], ['leftHand', 'attack', true]);
  // A Light Hit that Defense blocks: a Hit, and no Penetration, so the Parry
  // held while the Hit stood - exactly the case the old gate let through.
  resolveWith(h, [['yellow', faceOf('yellow', 'lightHit')]], [['white', WHITE_DEF]]);
  check('A4 the blocked icon is still a Hit', h.ctx.hits, 1);
  await finishAttack(root);
  check('A4 a Parry that held sends the On Hit Knockback no Hits', knocks[0]?.hits, 0);
}

// ---------- A5: who may designate (4.4.1 step 2, FAQ A14, C3) ----------
{
  // Shield Up in Defensive Stance against a Snipe: both may designate, so the
  // Part Die decides (FAQ A14).
  const atk = kit(mech(1, 's1', 'Sniper', 1), { rightHand: 'ZHRA-202' });
  const def = kit(mech(2, 's2', 'Shield', 3), { leftHand: 'ZHLA-301' });
  def.stance = 'defensive';
  const { h, root } = windowOn([atk, def]);
  h.start(atk, act('ZHRA-202', 'ZHRA-202_B'), def, 'clear');
  check('A5 Shield Up is declared before the die', h.ctx.step, 'designate');
  press(root, /^Designate L\.Arm/);
  check('A5 against Snipe neither choice stands: roll the Part Die (FAQ A14)', [h.ctx.step, !!h.ctx.declared, h.mayPickPart()], ['part', true, false]);
}
{
  // A Back Attack: the defender may designate nothing at all (4.4.1, FAQ C3).
  const atk = kit(mech(1, 's1', 'Behind', 4));
  atk.row = 6;
  const def = kit(mech(2, 's2', 'Shield', 3), { leftHand: 'ZHLA-301' });
  def.stance = 'defensive';
  const { h } = windowOn([atk, def]);
  h.start(atk, common('COMMON_PUNCH_MELEE'), def, 'clear');
  check('A5 a Back Attack offers the defender nothing, and the attacker designates', [h.ctx.step, h.mayPickPart()], ['part', true]);
}
{
  const atk = kit(mech(1, 's1', 'Striker', 1));
  // Mobile Defense (142), which prints no Stance condition, so only the
  // Shutdown rule itself can keep it off the table.
  const def = kit(mech(2, 's2', 'Shut', 3), { leftHand: '142' });
  def.stance = 'shutdown';
  const { h } = windowOn([atk, def]);
  h.start(atk, common('COMMON_PUNCH_MELEE'), def, 'clear');
  check('A5 a Shutdown target designates nothing either', h.ctx.step, 'part');
}

// ---------- A6: a destroyed Part cannot be designated ----------
{
  const atk = kit(mech(1, 's1', 'Sniper', 1), { rightHand: 'ZHRA-202' });
  const def = kit(mech(2, 's2', 'Wreck', 3), { leftHand: 'ZHLA-201', rightHand: '109' });
  def.partStates.leftHand = 'destroyed';
  const { h, root } = windowOn([atk, def]);
  h.start(atk, act('ZHRA-202', 'ZHRA-202_B'), def, 'clear');
  const chips = findButtons(root).filter((b) => /chip/.test(b.className));
  const left = chips.find((b) => /L\.Arm/.test(label(b)));
  const right = chips.find((b) => /R\.Arm/.test(label(b)));
  check('A6 the destroyed Part\'s chip is dead, a live one is not', [left?.disabled, right?.disabled], [true, false]);
}

// ---------- A7: the Surplus round cannot cancel the first hit's effects ----------
{
  const atk = kit(mech(1, 's1', 'Shotgun', 1), { rightHand: '146' });
  const def = kit(mech(2, 's2', 'Target', 3), { leftHand: 'ZHLA-201', rightHand: '109' });
  const { h, root, cmds } = windowOn([atk, def]);
  h.start(atk, act('146', '146_A'), def, 'clear');
  h.pickPart('torso');
  resolveWith(h, [['red', RED_HEAVY], ['red', RED_HEAVY], ['red', RED_HEAVY], ['red', RED_HEAVY], ['red', RED_HEAVY], ['red', RED_HEAVY]], [['white', WHITE_BLANK]]);
  press(root, /^Apply Penetration/);
  await settle();
  check('A7 the Scatter-shot round opened', h.ctx?.surplusRound, 1);
  h.pickPart('rightHand');
  h.ctx.defenseRoll = rolls([['blue', BLUE_DODGE], ['blue', BLUE_DODGE], ['blue', BLUE_DODGE], ['blue', BLUE_DODGE], ['blue', BLUE_DODGE], ['blue', BLUE_DODGE]]);
  h.ctx.focus = { stage: 'done', attackerUse: false, defenderUse: false };
  h.ctx.step = 'resolve';
  h.render();
  await finishAttack(root);
  check('A7 a fully dodged Surplus round keeps the first hit\'s Fragile',
    cmds.some((c) => c.kind === 'applyStatus' && c.statusId === 'fragile' && c.targetUid === 2), true);
}

// ---------- A13 / E4: Cleaving reaches the adjacent Grids, and a gone target still Cleaves ----------
const CLEAVE = { id: 'CLV_TEST', type: 'Melee', name: { en: 'Cleave Test' }, redDice: 2, yellowDice: 0, range: 0,
  description: { zh: '· 顺劈', en: '· Cleaving' }, keywords: [{ inline: '顺劈' }] };
{
  const atk = kit(mech(1, 's1', 'Cleaver', 1));
  const def = drone(2, 's2', 'ZHDR-201', 3);
  const other = drone(3, 's2', 'ZHDR-202', 4);
  other.row = 4;
  const { h, root } = windowOn([atk, def, other]);
  h.start(atk, CLEAVE, def, 'clear');
  check('A13 a diagonal neighbour is inside Range "--"', h.cleaveTargets().map((u) => u.uid), [3]);
  resolveWith(h, [['red', RED_HEAVY], ['red', RED_HEAVY]], [['white', WHITE_BLANK]]);
  press(root, /^Apply Penetration/);
  await settle();
  check('E4 the Drone is gone, and the Surplus still Cleaves on', [def.partStates.main, h.ctx?.step], ['destroyed', 'surplus']);
  check('E4 into another Unit only', findButtons(root).some((b) => /Another Part/.test(label(b))), false);
}

// ---------- A14: a Drone's Parry is automatic in Melee ----------
{
  const atk = kit(mech(1, 's1', 'Striker', 1));
  const def = drone(2, 's2', 'ZHDR-201', 3);
  const { h } = windowOn([atk, def]);
  h.start(atk, common('COMMON_PUNCH_MELEE'), def, 'clear');
  check('A14 ZHDR-201 adds its Parry 2 to a Melee defence', h.whiteSources().find((p) => p.why === 'Parry')?.n, 2);
}

// ---------- E1: Dense Armor, GoF 1.021 ----------
{
  const atk = kit(mech(1, 's1', 'Gunner', 1));
  const def = kit(mech(2, 's2', 'Dragoon', 3), { torso: '175' });
  const { h, root } = windowOn([atk, def]);
  h.start(atk, common('COMMON_PUNCH_MELEE'), def, 'clear');
  h.pickPart('torso');
  h.ctx.attackRoll = rolls([['red', RED_HEAVY], ['red', RED_LIGHTNING], ['red', RED_EYE], ['yellow', YEL_BLANK], ['yellow', YEL_EYE]]);
  h.render();
  press(root, /Continue to Defense/);
  check('E1 a hit on the Dense Armor Part takes every blank, Lightning and Eye die',
    h.ctx.attackRoll.map((d) => [d.color, d.face]), [['red', RED_HEAVY]]);
  check('E1 and the four carriers are the 1.021 list',
    ['175', '176', 'ZHLA-301'].map((id) => M.denseArmorSlot(data, kit(mech(9, 's2', 'x', 0), id === 'ZHLA-301' ? { leftHand: id } : { torso: id }))), ['torso', 'torso', 'leftHand']);
}

// ---------- E2: the Pursuit Token lets the attacker designate ----------
{
  const atk = kit(mech(1, 's1', 'Gunner', 1));
  const def = kit(mech(2, 's2', 'Marked', 3));
  def.statuses = ['pursuit'];
  const { h } = windowOn([atk, def]);
  h.start(atk, common('COMMON_PUNCH_MELEE'), def, 'clear');
  check('E2 an attacker of a Pursuit bearer counts as having Snipe', h.mayPickPart(), true);
  check('E2 and ZHLA-302 grants the Pursuit Token, not the Target Tracer',
    M.onHitRiders(act('ZHLA-302', 'ZHLA-302_A'), []).map((r) => r.statusId), ['pursuit']);
}

// ---------- E3: the Zealot's Chop is Suppression only ----------
check('E3 Zealot grants no Immobilized Token', M.onHitRiders(act('ZHDR-302', 'ZHDR-302_A'), []).length, 0);

// ---------- D1: the Lightning riders ----------
{
  const atk = drone(1, 's1', 'ZHDR-303', 1);
  const def = kit(mech(2, 's2', 'Target', 3));
  const { h, root, cmds } = windowOn([atk, def]);
  h.start(atk, act('ZHDR-303', 'ZHDR-303_A'), def, 'clear');
  h.pickPart('torso');
  resolveWith(h, [['red', RED_LIGHTNING]], [['white', WHITE_BLANK]]);
  await finishAttack(root);
  check('D1 a Valkyrie Lightning that no Dodge cancelled offers the Shutdown', press(root, /Shutdown Stance$/), true);
  check('D1 and taking it sends it', [cmds.some((c) => c.kind === 'forceShutdown' && c.targetUid === 2), def.stance], [true, 'shutdown']);
}
{
  const atk = drone(1, 's1', '161', 1);
  const def = kit(mech(2, 's2', 'Target', 3));
  const { h, root, cmds } = windowOn([atk, def]);
  h.start(atk, act('161', '161_A'), def, 'clear');
  h.pickPart('torso');
  resolveWith(h, [['red', RED_LIGHTNING], ['red', RED_LIGHTNING]], [['white', WHITE_BLANK]]);
  await finishAttack(root);
  const fci = cmds.find((c) => c.kind === 'applyStatus' && c.statusId === 'fci');
  check('D1 the Microwave gives a Fire Control Interference Token per Lightning', fci?.stacks, 2);
}

// ---------- A17: Link Shock, the MSH1's -2 Blue, the mass-production HALO ----------
{
  const atk = kit(mech(1, 's1', 'Shocker', 1), { rightHand: 'PDRH-202' });
  const def = kit(mech(2, 's2', 'Leashed', 3), { leftHand: 'ZHLA-202' });
  def.stance = 'mobility';
  const { h } = windowOn([atk, def]);
  h.start(atk, act('PDRH-202', 'PDRH-202_B'), def, 'clear');
  check('A17 Link Shock: no Parry and no designation', h.ctx.step, 'part');
  h.pickPart('torso');
  check('A17 and no Blue dice', h.ctx.defensePool.blue, 0);
}
{
  const atk = kit(mech(1, 's1', 'Two Hands', 1), { rightHand: '025', leftHand: '121' });
  const def = kit(mech(2, 's2', 'Dodger', 3), { leftHand: '117' });
  def.stance = 'mobility';
  const { h } = windowOn([atk, def]);
  h.start(atk, act('025', '025_A'), def, 'clear');
  h.pickPart('torso');
  check('A17 121_A as the Freehand takes 2 Blue off the target', h.ctx.defensePool.blue, 5 - 2);
}
check('A17 the mass-production HALO needs no Command Token',
  M.dodgeEnhanceOf(data, kit(mech(2, 's2', 'x', 3), { backpack: 'ZYBP-302-MP' }))?.free, true);

// ---------- A9 / A16: a refused Focus rerolls nothing ----------
{
  const atk = kit(mech(1, 's1', 'Attacker', 1));
  const def = kit(mech(2, 's2', 'Defender', 3));
  const { h, root } = windowOn([atk, def], { refuse: (cmd) => cmd.kind === 'focus' });
  h.start(atk, common('COMMON_PUNCH_MELEE'), def, 'clear');
  h.pickPart('torso');
  h.ctx.attackRoll = rolls([['red', RED_EYE]]);
  h.ctx.defenseRoll = rolls([['white', WHITE_BLANK]]);
  h.ctx.step = 'defense';
  h.render();
  press(root, /^Focus: spend 1 Link \(Attacker\)/);
  check('A16 a refused Focus leaves the declare open, nothing paid or rerolled', [h.ctx.focus?.stage, h.ctx.focus?.attackerUse], ['declareA', false]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
