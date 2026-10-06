// MELEE LOCK AS A SCREEN (the Tactician's weight `lockDeny`; OTTO, 2026-10-06:
// "are melee units thinking about melee lock? It would make sense for melee
// mechs to get in units face and maybe position themselves to have their melee
// locked opponent between them and at least one ally so they can stop enemies
// without melee firing while they do work").
//
// A Ground unit with an enemy beside it that could strike it in Melee is Melee
// Locked, and makes no Firing attack but with a weapon printing Melee Firing
// (4.3.5). The Ace counted that only for itself: a blade beside a Rifle was
// safer from that Rifle, and nothing was said of the Ally across the board the
// Rifle would no longer shoot. With `lockDeny`, a Grid beside an enemy whose turn
// is still to come, locked by no other unit of the squad, is worth that enemy's
// best shot at the rest of the squad. Staged on the real engine: a Swift Steed
// blade and an Ally in the open against a Rifle, the Blade's Melee Opportunity
// open, the Rifle's Firing still to come.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('Melee Lock as a screen\n');

const { M, data } = await loadEngine('seatlockdeny', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';"]);
const AI = M.AI;
const blade = { torso: '012', chasis: '022', leftHand: '062', rightHand: '036', pilot: 'FPA-11' };
data.solo.squads['t-lockers'] = {
  name: 'Lockers', faction: 'RDL', points: 0,
  mechs: [
    { name: 'Blade', loadout: blade },
    { name: 'Ally', loadout: { torso: '012', chasis: '249', rightHand: '536', pilot: 'FPA-11' } },
  ],
  drones: [],
};
data.solo.squads['t-rifle'] = {
  name: 'Rifle', faction: 'UN', points: 0,
  mechs: [{ name: 'Rifle', loadout: { torso: '539', chasis: '099', rightHand: '541', pilot: 'LPA-23-2' } }],
  drones: [],
};
// A gunner on a Swift Steed: a Maneuver of 2, enough to Break Away from one unit locking it (1 + 1) and walk out to
// fire, not from two (1 + 2).
data.solo.squads['t-runner'] = {
  name: 'Runner', faction: 'RDL', points: 0,
  mechs: [{ name: 'Runner', loadout: { torso: '012', chasis: '022', rightHand: '536', pilot: 'FPA-11' } }],
  drones: [],
};
const scenarioOf = (foe) => ({ ...data.solo.scenarios[0], id: `t-lockdeny-${foe}`, map: 'none', seats: { s1: 't-lockers', s2: foe === 'Rifle' ? 't-rifle' : 't-runner' } });

// Round 1's Action Phase, the Blade's Melee Opportunity open, the enemy's Firing to come; the Ally at `ally`.
async function staged(ally, foe = 'Rifle') {
  const t = botTable(M, data, scenarioOf(foe), { seed: 5, policies: AI.eagerPolicy });
  await t.run({ until: (st) => M.SU.normaliseSetup(st.setup)?.stage === 'done' && st.round.phase === 2 });
  const s = t.state;
  const U = Object.fromEntries(s.tokens.map((x) => [x.label, x]));
  const at = (x, c, r, f) => { x.col = c * 3; x.row = r * 3; if (f !== undefined) x.facing = f; };
  at(U.Blade, 4, 4, 2); at(U.Ally, ally[0], ally[1], 2); at(U[foe], 4, 7, 0);
  for (const x of s.tokens) { x.stance = 'offensive'; x.timing = 'firing'; }
  U.Blade.timing = 'melee';
  s.script.revealed = ['s1', 's2'];
  s.script.acted = [U.Ally.uid];
  s.script.opp = null;
  M.G.opportunity(data, s);
  return { t, U, d: t.drivers.s1.pending(), view: M.SEAT.viewOf(data, s, 's1') };
}
// Each Grid's plan as each weight would read it: the best `shape` of the plans ending there.
function shapes(d, view, lockDeny) {
  const out = new Map();
  for (const p of AI.weighed(d, view, {}, { lockDeny })) {
    const k = `${p.at.col},${p.at.row}`;
    out.set(k, Math.max(out.get(k) ?? -Infinity, p.shape));
  }
  return out;
}
const beside = (k, c, r) => { const [x, y] = k.split(',').map(Number); return Math.abs(x - c) <= 1 && Math.abs(y - r) <= 1; };

{
  const { t, d, view } = await staged([8, 3]);
  const off = shapes(d, view, 0), on = shapes(d, view, 1);
  const lock = [...on.keys()].filter((k) => beside(k, 4, 7) && off.has(k));
  const far = [...on.keys()].filter((k) => !beside(k, 4, 7) && off.has(k));
  const gain = lock.map((k) => on.get(k) - off.get(k));
  check('THE BLADE CAN END BESIDE THE RIFLE, and every such Grid is worth more with `lockDeny`: the Rifle\'s shot at the Ally across the board is taken away',
    [lock.length > 0, gain.every((g) => g > 0.05)], [true, true]);
  check('and a Grid that locks nothing is worth the same either way', far.every((k) => Math.abs(on.get(k) - off.get(k)) < 1e-9), true);
  t.close();
}
{
  // The Ally stands beside the Rifle already: the Rifle is locked whoever comes, and the Blade takes nothing more.
  const { t, d, view } = await staged([5, 8]);
  const off = shapes(d, view, 0), on = shapes(d, view, 1);
  const lock = [...on.keys()].filter((k) => beside(k, 4, 7) && off.has(k));
  check('WITH THE RIFLE LOCKED ALREADY by the Ally, a Grid beside it is worth nothing more', lock.every((k) => Math.abs(on.get(k) - off.get(k)) < 1e-9), true);
  t.close();
}
{
  // A Maneuver is no Action: the Runner walks out of one lock (1 + 1 Movement Range) and fires all the same.
  const { t, U, d, view } = await staged([6, 3], 'Runner');
  const aims = d.here?.().turnOf(U.Runner.uid, ['attack'], 'firing')?.options ?? [];
  const off = shapes(d, view, 0), on = shapes(d, view, 1);
  const lock = [...on.keys()].filter((k) => beside(k, 4, 7) && off.has(k));
  check('A GUNNER THAT CAN BREAK AWAY (a Swift Steed\'s Maneuver of 2 against one locker) is not held: the Grids beside it are worth nothing more, though it has the Ally in its sights',
    [aims.some((o) => o.facts?.targetUid === U.Ally.uid), lock.length > 0, lock.every((k) => Math.abs(on.get(k) - off.get(k)) < 1e-9)], [true, true, true]);
  t.close();
}
check('the weight ships at 0 until it is measured', AI.TACTICIAN.lockDeny, 0);
{
  const { readFileSync } = await import('node:fs');
  const seat = readFileSync(new URL('../src/seat.ts', import.meta.url), 'utf8');
  check('the seat marks a Firing Action printing Melee Firing, which a Melee Lock does not bar',
    /a\.type === 'Firing' && isMeleeFiring\(a\) \? \{ meleeFiring: true \}/.test(seat), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
