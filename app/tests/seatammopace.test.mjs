// MISSILE FIRE KEPT STEADY THROUGH THE GAME (`ammoPace`, M24, 2026-10-14). OTTO: "Missile saturation should be steady
// through all rounds, I simply wanted to avoid all drones and mechs using their ammo by round 2. Shots on drones are
// important as well". A unit makes one launch a round, and the Ammo Token goes with the Action (4.13): against the
// rounds still to come, this one counted, a launch counts `ammoPace` x (Tokens / rounds left - 1) of its own worth
// more, at most that much either way. The target stays the Ace's own reading.
//
// Staged on the real engine, on an empty board, in round 1's Action Phase (five rounds): RDL's Hail (an ML-32 Dual
// Launcher, MC-3 "Razor" Missiles) on a Projectile dial, three Grids from UN's Raven EC Type; UN's Rifle far off.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('Missile fire kept steady through the game\n');

const { M, data } = await loadEngine('seatammopace', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
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
const scenario = { ...data.solo.scenarios[0], id: 't-ammopace', map: 'none', mission: 'none', seats: { s1: 't-hail', s2: 't-raven' } };
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
check('THE STAGE: Hail\'s Opportunity is open with a launch on offer; one launcher, Tokens counted; round 1 of five',
  [d?.kind, d?.unit === U.Hail.uid, d?.options.some((o) => o.tags[0] === 'launch'), launchers.length, launchers.every((w) => typeof w.ammo === 'number'), s.round.n, M.SEAT.viewOf(data, s, 's1').roundLimit],
  ['opp.act', true, true, 1, true, 1, 5]);

const launching = (r) => String(r.does).startsWith('a Projectile');
const bestLaunch = (tune) => AI.weighed(t.drivers.s1.pending(), M.SEAT.viewOf(data, s, 's1'), {}, tune).filter(launching).reduce((a, b) => (!a || b.now > a.now ? b : a), null);
const near = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
const read = (n, tune) => { tokens(n); return { off: bestLaunch({ ammoPace: 0 }), on: bestLaunch({ ammoPace: 1, ...tune }) }; };
{
  const { off, on } = read(1);
  check('WITHOUT `ammoPace` (0) Hail\'s Missile goes at the Raven', [!!off, off ? off.now > 0 : null, off ? /Raven/.test(off.does) : null], [true, true, true]);
  check('WITH `ammoPace` 1, ONE TOKEN AND FIVE ROUNDS TO GO: still at the Raven (a Drone as much as a Mech), at a fifth of its worth',
    [!!on, on ? /Raven/.test(on.does) : null, on && off ? near(on.now, off.now * 0.2) : null], [true, true, true]);
}
{
  const { off, on } = read(5);
  check('FIVE TOKENS, FIVE ROUNDS: one a round to the end, the launch counts as it would without', on && off ? near(on.now, off.now) : null, true);
}
{
  // (Its own worth doubles at most; the share of the Volley's next launch the Ace adds, `volleyLaunch`, is not paced:
  // that launch's Token went with this one.)
  const { off, on } = read(10);
  check('TEN TOKENS, FIVE ROUNDS: some would go unspent, so the launch counts more, at most double',
    on && off ? [on.now > off.now, on.now <= 2 * off.now + 1e-9, /Raven/.test(on.does)] : null, [true, true, true]);
}
{
  s.round.n = 5;
  const { off, on } = read(2);
  check('IN THE LAST ROUND every Token left is one to use: two Tokens, the launch counts more',
    on && off ? [on.now > off.now, on.now <= 2 * off.now + 1e-9] : null, [true, true]);
  s.round.n = 1;
}
{
  // The Rifle brought within the Razor's strike beside the Raven: whichever the Ace reads as the better target, it is
  // the same one with the pace as without (every launch of the unit moves alike).
  at(U.Rifle, 6, 5, 0);
  for (const n of [1, 10]) {
    const { off, on } = read(n);
    const target = (r) => (r ? (/Rifle/.test(r.does) ? 'Rifle' : /Raven/.test(r.does) ? 'Raven' : '?') : null);
    check(`THE TARGET IS THE ACE'S OWN (${n} Token${n > 1 ? 's' : ''}): the same enemy with the pace as without`, [!!off, target(on) === target(off)], [true, true]);
  }
  at(U.Rifle, 5, 13, 0);
}
check('AS IT SHIPS (2026-10-14): 1 for the Ace and the Veteran, 0 for the Brawler and the Recruit made of it',
  [AI.TACTICIAN.ammoPace, AI.VETERAN_WEIGHTS.ammoPace ?? AI.TACTICIAN.ammoPace, AI.BRAWLER_WEIGHTS.ammoPace], [1, 1, 0]);
{
  // And as it ships, one Token in round 1 makes the launch count a fifth, as `ammoPace` 1 does above.
  const { on } = read(1);
  const shipped = bestLaunch({});
  check('and as it ships, the launch reads as with `ammoPace` 1', on && shipped ? near(shipped.now, on.now) : null, true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
