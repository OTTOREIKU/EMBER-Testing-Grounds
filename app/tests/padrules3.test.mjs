// PAD PLAYTEST FIXES, BATCH 3 (OTTO, 2026-11-18): the rules the pad shows.
//
// 2.1 "X hitting, X stopping" added every icon together, so 2 Heavy Hits
//     against 3 Defense read as safe. It is split by kind, with a warning.
// 2.2 Low Profile is named with the defence roll's other passives.
// 2.3 Suppression tells the defender their Mech is now Defensive.
// 2.4 A Projectile is never "Moved": the engine refuses its bare Maneuver.
// 2.5 A lent Load's "Use" greys out once the Mech's Ticks are spent.
import { readFileSync } from 'node:fs';
import { installDom, loadCombat, mech } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

console.log('PAD playtest fixes, batch 3: the rules shown correctly\n');

installDom();
const { data, mod } = await loadCombat('padrules3', ['feltSplit', 'feltHeavyWarning'], [
  "export { check as checkCmd } from '../src/commands';",
]);

// ---------- 2.1 heavy hits are counted apart ----------
{
  const s = mod.feltSplit([{ heavy: 2, light: 0 }], [{ dodge: 0, defense: 3 }]);
  check('2 Heavy against 3 Defense is split by kind (a kind with none is left out)', [s.attackText, s.defenseText], ['2 Heavy', '3 Defense']);
  check('and warns that Defense cannot stop them', mod.feltHeavyWarning(s), '2 Heavy Hits with no Dodge to stop them: Defense cannot block Heavy Hits.');
  check('one Heavy Hit reads in the singular', mod.feltHeavyWarning({ heavy: 1, dodge: 0 }), '1 Heavy Hit with no Dodge to stop it: Defense cannot block Heavy Hits.');
  check('enough Dodge for every Heavy Hit gives no warning', mod.feltHeavyWarning({ heavy: 2, dodge: 2 }), '');
  check('several dice add up', mod.feltSplit([{ heavy: 1, light: 2 }, { heavy: 1, light: 0 }], [{ dodge: 1, defense: 1 }, { dodge: 0, defense: 1 }]).attackText, '2 Heavy · 2 Light');
  const c = src('src/combat.ts');
  check('the attack window draws the split and the warning', c.includes('ah-kinds') && c.includes('ah-heavywarn'), true);
}

// ---------- 2.2 Low Profile ----------
{
  const a = src('pad/attack.ts'), c = src('src/combat.ts');
  check('the defence roll\'s list names Low Profile', a.includes("'Low Profile: each {Eye} counts as a {Dodge} against this Firing Attack'"), true);
  check('only when the attacker does not ignore it', /lp && action\.type === 'Firing' && !ignoresLowProfile\(/.test(a), true);
  check('and the defender\'s phone reads it off the shared window', a.includes('function mirroredAttack('), true);
  check('the defence step says it too', c.includes('LOW PROFILE: each Eye counts as a Dodge against this Firing Attack'), true);
}

// ---------- 2.3 Suppression ----------
{
  const p = src('pad/pad.ts'), a = src('pad/attack.ts');
  const fn = p.slice(p.indexOf('function toastRemote('), p.indexOf('\n}\n', p.indexOf('function toastRemote(')));
  check('the defender\'s phone says their Mech is now Defensive', fn.includes("cmd.kind === 'suppress'") && fn.includes('Suppression attack and is now in Defensive Stance.'), true);
  check('and the defence list says why it is Defensive', a.includes('Defensive Stance, switched by Suppression: hollow Defense counts'), true);
}

// ---------- 2.4 projectiles never Maneuver ----------
{
  const card = data.cards.find((c) => c.category === 'projectile' && (c.actions ?? []).some((x) => x.type !== 'Passive'));
  const act = card.actions.find((x) => x.type !== 'Passive');
  const shell = { ...mech(2, 's1', 'Shell', 4), kind: 'projectile', cardId: card.id, stance: undefined, link: 0 };
  const s = {
    v: 3, map: '', tokens: [mech(1, 's1', 'Launcher', 1), shell], nextUid: 3,
    round: { n: 1, phase: 2, firstPlayer: 's1' }, commandTokens: { s1: 0, s2: 0 }, markers: [], smoke: [],
    removedTerrain: [], tactics: { s1: [], s2: [] }, tacticsPlayed: { s1: [], s2: [] }, noBoard: true, setup: null,
  };
  const bare = mod.checkCmd(data, s, { kind: 'maneuver', seat: 's1', uid: 2, to: { col: 0, row: 0 } });
  check('a Projectile\'s bare Maneuver is refused', [bare.ok, /is a Projectile/.test(bare.why ?? '')], [false, true]);
  const flight = mod.checkCmd(data, s, { kind: 'maneuver', seat: 's1', uid: 2, to: { col: 0, row: 0 }, actionId: act.id });
  check('its flight through its own Action is not', /is a Projectile/.test(flight.why ?? ''), false);
  const pushed = mod.checkCmd(data, s, { kind: 'maneuver', seat: 's1', uid: 2, to: { col: 0, row: 0 }, free: true });
  check('nor a free step someone else gives it', /is a Projectile/.test(pushed.why ?? ''), false);
  const g = src('pad/guided.ts');
  check('Guided offers "Moved" to a Drone only', g.includes("const mayMove = t.kind === 'drone'"), true);
}

// ---------- 2.5 a lent Load on the Ticks left ----------
{
  const p = src('pad/pad.ts');
  const loop = p.slice(p.indexOf('for (const loan of loanedParts(d, table.tokens, t, { anywhere: true }))'), p.indexOf('rows.push(...commonRows(t, mine));'));
  check('the lent Use is judged on the Ticks left', loop.includes('fitShort(t, fo, a, key)') && loop.includes('inert(chip, nofit)'), true);
  check('and its capsule shows which Ticks are gone', loop.includes('actionBlock(loan.card, a, short)'), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
