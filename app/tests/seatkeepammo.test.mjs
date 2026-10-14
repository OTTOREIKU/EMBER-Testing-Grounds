// KEEPING A MISSILE FOR A BIGGER TARGET (`keepAmmo`, M24, 2026-10-14). OTTO, watching the GOF missile squad empty its
// launchers at two Drones: "I would maybe fire off 4 to see how they do and save my ammo for the mechs that are in the
// back". An Ammo Token spent now is one the launcher cannot spend later: where it has fewer than the rounds still to
// come, a launch costs what the same Missile would be worth on the enemy's best target, at `keepAmmo` the chance it gets
// that shot.
//
// Staged on the real engine, on an empty board, in round 1's Action Phase: RDL's Hail (an ML-32 Dual Launcher, MC-3
// "Razor" Missiles) on a Projectile dial, three Grids from UN's Raven EC Type; UN's Rifle far out of reach.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('Keeping a Missile for a bigger target\n');

const { M, data } = await loadEngine('seatkeepammo', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
data.solo.squads['t-hail'] = {
  name: 'Hail', faction: 'RDL', points: 0,
  mechs: [{ name: 'Hail', loadout: { torso: '014', chasis: '020', leftHand: '029', rightHand: '033', pilot: 'FPA-14' } }],
  drones: [],
};
data.solo.squads['t-raven'] = {
  name: 'Raven', faction: 'UN', points: 0,
  mechs: [{ name: 'Rifle', loadout: { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' } }],
  drones: [{ cardId: '165' }],
};
const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
const scenario = { ...data.solo.scenarios[0], id: 't-keepammo', map: 'none', mission: 'none', seats: { s1: 't-hail', s2: 't-raven' } };
const t = botTable(M, data, scenario, { seed: 5, policies: { s1: AI.eagerPolicy, s2: AI.eagerPolicy } });
await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
const s = t.state;
const U = Object.fromEntries(s.tokens.map((x) => [x.kind === 'drone' ? 'Raven' : x.label, x]));
at(U.Hail, 5, 2, 2); at(U.Raven, 5, 5, 0); at(U.Rifle, 5, 13, 0);
for (const x of s.tokens) { x.stance = 'offensive'; x.timing = 'firing'; }
U.Hail.timing = 'projectile';
s.script.revealed = ['s1', 's2'];
s.script.acted = [U.Rifle.uid, U.Raven.uid];
s.script.opp = null;
M.G.opportunity(data, s);
const launchers = M.SEAT.viewOf(data, s, 's1').units.find((u) => u.uid === U.Hail.uid).weapons.filter((w) => w.type === 'Projectile');
const tokens = (n) => { for (const w of launchers) U.Hail.ammo[w.actionId] = n; };
const d = t.drivers.s1.pending();
check('THE STAGE: Hail\'s Opportunity is open with a launch on offer; one launcher, Tokens counted; five rounds',
  [d?.kind, d?.unit === U.Hail.uid, d?.options.some((o) => o.tags[0] === 'launch'), launchers.length, launchers.every((w) => typeof w.ammo === 'number'), M.SEAT.viewOf(data, s, 's1').roundLimit],
  ['opp.act', true, true, 1, true, 5]);

const launching = (r) => String(r.does).startsWith('a Projectile');
const bestLaunch = (tune) => {
  const dd = t.drivers.s1.pending();
  return AI.weighed(dd, M.SEAT.viewOf(data, s, 's1'), {}, tune).filter(launching).reduce((a, b) => (!a || b.now > a.now ? b : a), null);
};
tokens(1);
const off = bestLaunch({});
const on = bestLaunch({ keepAmmo: 0.5 });
check('AS IT SHIPS (`keepAmmo` 0) Hail\'s last Missile goes at the Raven', [!!off, off ? off.now > 0 : null, off ? /Raven/.test(off.does) : null], [true, true, true]);
check('WITH `keepAmmo` 0.5 and one Token left, four rounds to come: no launch at the Raven while the Rifle stands', on, null);
{
  tokens(5);
  const plenty = bestLaunch({ keepAmmo: 0.5 });
  const plentyOff = bestLaunch({});
  check('A Token for every round to come: the launch costs nothing', plenty && plentyOff ? Math.abs(plenty.now - plentyOff.now) < 1e-9 : null, true);
  tokens(1);
}
{
  const round = s.round.n;
  s.round.n = 5;
  const last = bestLaunch({ keepAmmo: 0.5 });
  const lastOff = bestLaunch({});
  check('IN THE LAST ROUND nothing is kept: the Missile goes at the Raven as it would without', last && lastOff ? Math.abs(last.now - lastOff.now) < 1e-9 : null, true);
  s.round.n = round;
}
{
  // The best target in reach: the Rifle brought within the Razor's strike and the Raven taken out of it. The launch
  // at it costs only its share of itself, so it still goes.
  at(U.Rifle, 5, 5, 0); at(U.Raven, 13, 13, 0);
  const rifleOff = bestLaunch({});
  const rifle = bestLaunch({ keepAmmo: 0.5 });
  check('AT THE BEST TARGET the launch still goes, at half its worth (keepAmmo 0.5, one Token)',
    [!!rifle, rifle ? /Rifle/.test(rifle.does) : null, rifle && rifleOff ? Math.abs(rifle.now - rifleOff.now / 2) < 1e-6 * rifleOff.now + 1e-9 : null], [true, true, true]);
  at(U.Rifle, 5, 13, 0); at(U.Raven, 5, 5, 0);
}
check('THE WEIGHT SHIPS AT 0', AI.TACTICIAN.keepAmmo, 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
