// HINDERED (GoF 1.021): "[On hit], target gains 1 Hindered Token." on the N13
// Vanguard III "Claymore", and the Token's own rule, "-1 Blue Dice in their
// Defense Roll" -- a definition the publisher's PDF itself truncates after the
// comma, so the Blue subtraction is the whole of what is built.
//
// Everything here runs against the REAL merged data (loadCombat runs the app's
// own loadData), so these pins fail if the ZHDR-103_A override is lost as well
// as if the engine forgets the rule.
import { findButtons, installDom, label, loadCombat, makeEl, settle } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

installDom();
const { AttackHelper, data, dice } = await loadCombat('hindered');

console.log('Hindered: the Claymore rider, and the Blue dice it eats\n');

// ---------- the data carries the rider ----------
const claymore = data.byId.get('ZHDR-103');
const gun = (claymore?.actions ?? [])[0];
check('the merged Claymore action prints the rider',
  /\[On hit\],? target gains 1 Hindered Token/i.test(gun?.description?.en ?? ''), true);
check('and the Crossbow, regunned alongside it, no longer intercepts',
  (data.byId.get('ZHDR-102')?.actions ?? []).some((a) =>
    (a.keywords ?? []).some((k) => /拦截/.test(k.inline ?? k.key ?? ''))
    || /拦截|Intercept/i.test((a.description?.en ?? '') + (a.description?.zh ?? ''))), false);

// ---------- the rest of the 1.021 regunning, pinned on the merged data ----------
{
  const scutum = data.byId.get('ZHDR-101');
  check('the Scutum has its 1.021 gun', (scutum?.actions ?? []).map((a) => a.id), ['ZHDR-101_A', 'ZHDR-101_B']);
  const shot = scutum.actions[1];
  check('Single Shot, 3Y1R, Range 3',
    [shot.name?.en, shot.yellowDice, shot.redDice, shot.range], ['Single Shot', 3, 1, 3]);
  const xbow = data.byId.get('ZHDR-102').actions[0];
  check('the Crossbow action is renamed Single Shot', xbow.name?.en, 'Single Shot');
  check('and rolls 3R instead of the bundle 2Y1R', [xbow.yellowDice, xbow.redDice], [0, 3]);
  const javelin = data.byId.get('ZHDR-104').actions[0];
  check('the Javelin carries its Ammo 2', javelin.storage, 2);
}

// ---------- the rider rides the on-hit seam ----------
const mech = (uid, side, lbl, col) => ({
  uid, side, kind: 'mech', cardId: '172', label: lbl, col, row: 1,
  size: 3, facing: 1, aerial: false, stance: 'offensive', link: 3, deployed: true,
  mech: { torso: '172' }, partStates: { torso: 'intact' }, ammo: {}, statuses: [], log: [],
});
async function strike(action, boost) {
  const atk = mech(1, 's1', 'Attacker', 1);
  const def = mech(2, 's2', 'Defender', 3);
  const cmds = [];
  const root = makeEl('div');
  const h = new AttackHelper(
    data, dice, root,
    () => {}, () => {}, () => {}, () => {}, () => {}, () => {},
    (cmd) => cmds.push(cmd),
  );
  h.tokens = () => [atk, def];
  h.terrain = () => [];
  h.smoke = () => [];
  h.start(atk, action, def, 'clear');
  h.pickPart('torso');
  if (boost && h.ctx) h.ctx.attackPool = boost;
  for (const want of [/roll attack dice/i, /continue to defense/i, /roll defense dice/i]) {
    const b = findButtons(root).find((x) => want.test(label(x)));
    if (b) b.click();
    await settle();
  }
  for (let i = 0; i < 2; i++) {
    const b = findButtons(root).find((x) => label(x) === 'Pass' && !x.disabled);
    if (b) b.click();
  }
  const res = findButtons(root).find((x) => /^Resolve/.test(label(x)));
  if (res) res.click();
  await settle();
  const hits = h.ctx?.hits ?? 0;
  const end = findButtons(root).find((x) => /apply penetration|^Done$/i.test(label(x)) && !x.disabled);
  if (end) end.click();
  await settle();
  return { cmds, hits };
}

{
  const { cmds, hits } = await strike(gun, { red: 4, yellow: 4 });
  check('the Claymore landed a Hit', hits > 0, true);
  const st = cmds.filter((c) => c.kind === 'applyStatus' && c.statusId === 'hindered');
  check('and the hit granted 1 Hindered Token through the seam', st.length, 1);
  check('to the defender', st[0]?.targetUid, 2);
}

// ---------- the Token eats Blue dice ----------
// A defender in Mobility Stance rolls its dodge as Blue; the 181 chassis
// prints Dodge 3, which gives the subtraction something real to eat.
const dodgy = (statuses) => ({
  uid: 2, side: 's2', kind: 'mech', cardId: '172', label: 'Defender', col: 3, row: 1,
  size: 3, facing: 1, aerial: false, stance: 'mobility', link: 3, deployed: true,
  mech: { torso: '172', chasis: '181' }, partStates: { torso: 'intact', chasis: 'intact' },
  ammo: {}, statuses, log: [],
});
function poolFor(def) {
  const atk = mech(1, 's1', 'Attacker', 1);
  const root = makeEl('div');
  const h = new AttackHelper(data, dice, root,
    () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
  h.tokens = () => [atk, def];
  h.terrain = () => [];
  h.smoke = () => [];
  h.start(atk, gun, def, '');
  h.pickPart('torso');
  return h.ctx.defensePool;
}
const clean = poolFor(dodgy([]));
check('the clean pool has Blue to lose', clean.blue >= 3, true);
check('one Token costs exactly one Blue', poolFor(dodgy(['hindered'])).blue, clean.blue - 1);
check('they stack', poolFor(dodgy(['hindered', 'hindered'])).blue, clean.blue - 2);
check('and clamp at zero rather than going negative',
  poolFor(dodgy(['hindered', 'hindered', 'hindered', 'hindered', 'hindered'])).blue, 0);
check('White is untouched — the Token names Blue',
  poolFor(dodgy(['hindered'])).white, clean.white);
check('Immobilized still deletes the whole pool regardless',
  poolFor(dodgy(['hindered', 'immobilized'])).blue, 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
