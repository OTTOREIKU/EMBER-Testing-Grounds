// BEHIND AS THE BOARD STANDS (AI-OPPONENT-PLAN.md: `press`, the Tactician's
// weight; 0 leaves every game as it was). A traced VIP game on the
// Intersection, the Ace on both sides: both squads stood still from the second
// round, and UN, with fewer Mech Parts and Drones left (5.2.4), lost it 0 to 0
// on them. A squad that would lose the game if it ended now gains nothing by
// holding back: each of its units with nothing to walk to for the Main Task
// counts its step toward contact `press` times over besides (at `pressLate` 1
// the more so the later the round). The squad ahead plays as it did.
import { botTable, loadEngine } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('Behind as the board stands\n');

const { M, data } = await loadEngine('seatpress', ["export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';", "export * as HUD from '../src/matchhud';"]);
const AI = M.AI;
const W = AI.TACTICIAN;
const vip = { ...data.solo.scenarios.find((s) => s.id === 'intersection-vip-assassination') };
// ADOPTED at 10 (2026-10-04): the Ace without it, pinned at 0, is what it is held against.
const ace = AI.makeTactician({}, { press: 0 });
const pressed = AI.makeTactician({}, { press: 10 });
// How far a Grid is from the nearest enemy, in Grids walked straight (a road round the walls is no shorter).
const near = (at, view) => Math.min(...view.units.filter((u) => u.side === view.other && u.alive && u.deployed).map((u) => Math.abs(u.grid.col - at.c) + Math.abs(u.grid.row - at.r)));

// The game played by the Ace on both sides; each question asked of a seat is
// read where it is asked (an answer's look ahead belongs to its own table).
const seen = {};
const watch = (seat) => ({
  name: 'watch',
  choose(d, view, rng) {
    const pick = ace.choose(d, view, rng);
    const wildcat = d.options.some((o) => String(o.label).includes('Wild Cat'));
    // (Each deployment question offers every unit still to deploy: the one
    // that puts the Wild Cat down is the one the Ace answers with it.)
    if (seat === 's2' && d.kind === 'setup.deploy' && String(d.options.find((o) => o.id === pick.option)?.label).includes('Wild Cat') && !seen.deploy) {
      const p = pressed.choose(d, view, new AI.Rng('press'));
      const at = (id) => d.options.find((o) => o.id === id)?.facts?.to;
      seen.deploy = { behind: AI.behindNow(view, { ...W, press: 10 }), ace: near(at(pick.option), view), pressed: near(at(p.option), view) };
    }
    if (seat === 's2' && d.kind === 'opp.act' && view.round === 3 && wildcat && !seen.s2) {
      const rows = (w) => Object.fromEntries(AI.weighed(d, view, {}, w).map((r) => [r.label, r.shape]));
      const off = rows({ press: 0 }), on = rows({ press: 10 }), late = rows({ press: 10, pressLate: 1 });
      const label = Object.keys(off).find((l) => l !== 'stay' && Math.abs(off[l]) > 1e-6);
      seen.s2 = { behind: AI.behindNow(view, { ...W, press: 10 }), standing: [AI.standingFor(view, 's2'), AI.standingFor(view, 's1')], on: on[label] / off[label], late: late[label] / off[label] };
    }
    if (seat === 's1' && d.kind === 'opp.act' && view.round === 3 && d.options.length > 1 && !seen.s1) {
      const rows = (w) => AI.weighed(d, view, {}, w).map((r) => [r.label, r.worth]);
      seen.s1 = { behind: AI.behindNow(view, { ...W, press: 10 }), same: JSON.stringify(rows({ press: 0 })) === JSON.stringify(rows({ press: 10, pressLate: 1 })), pick: pressed.choose(d, view, new AI.Rng('press')).option === pick.option };
    }
    if (seat === 's2' && view.round === 3 && !seen.views) {
      // Victory Points against the Mech Parts and Drones left, read off this view.
      const at = (vp) => ({ ...view, vp });
      const s1View = { ...view, seat: 's1', other: 's2' };
      const level = { ...view, units: view.units.filter((u) => u.side === 's1' || u.alive) };
      seen.views = {
        aheadOnPoints: AI.behindNow(at({ s1: 0, s2: 1 }), W),
        behindOnPoints: AI.behindNow({ ...s1View, vp: { s1: 0, s2: 1 } }, W),
        aheadOnParts: AI.behindNow(s1View, W),
        // Level on both (UN's count raised to RDL's by a stand-in Drone each): a draw is no loss.
        level: AI.behindNow({ ...level, units: [...level.units, ...Array.from({ length: AI.standingFor(view, 's1') - AI.standingFor(view, 's2') }, (_, i) => ({ ...level.units.find((u) => u.side === 's2' && u.kind === 'drone' && u.alive && !u.lowValue), uid: 9000 + i }))] }, W),
      };
    }
    return pick;
  },
});
const t = botTable(M, data, vip, { seed: 5, policies: { s1: watch('s1'), s2: watch('s2') }, glue: M.HUD.glueAfter });
await t.run({ maxSteps: 12000, until: () => seen.s1 && seen.s2 && seen.views });
t.close();

check('BEHIND AS THE BOARD STANDS: level on Victory Points and behind on the Mech Parts and Drones left (UN, 7 to 10); ahead on them (RDL)',
  [seen.s2?.behind, seen.s2?.standing, seen.s1?.behind], [true, [7, 10], false]);
check('Victory Points come first: one up is ahead whatever is left, one down is behind; level on both is a draw, no loss',
  [seen.views?.aheadOnPoints, seen.views?.behindOnPoints, seen.views?.aheadOnParts, seen.views?.level], [false, true, false, false]);
check('THE STEP TOWARD CONTACT OF A UNIT OF THE SQUAD BEHIND COUNTS `press` TIMES OVER BESIDES (11 times at 10); at `pressLate` 1 by the share of the game played (round 3 of 5: 7 times)',
  [Math.round((seen.s2?.on ?? 0) * 1e6) / 1e6, Math.round((seen.s2?.late ?? 0) * 1e6) / 1e6], [11, 7]);
check('THE SQUAD AHEAD PLAYS AS IT DID: every plan worth the same, the same answer',
  [seen.s1?.same, seen.s1?.pick], [true, true]);
check('AND IT BITES: UN, behind from its first deployment, puts the Wild Cat down nearer the enemy',
  [seen.deploy?.behind, seen.deploy && seen.deploy.pressed < seen.deploy.ace], [true, true]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
