// The EAGER policy: a seat that goes looking for a fight. It deploys forward,
// walks at the nearest enemy, turns to face it, and takes any shot it is
// offered. It weighs nothing (no odds, no mission, no fear of return fire), so
// it is not a good player; it is a BUSY one. Two of them meet in the middle
// and use everything their squads carry, which is what the suite's games need
// in order to find the engine change that strands a seat mid-attack
// (AI-OPPONENT-PLAN.md, rule R8), and what the first game on screen needs in
// order to be a game at all.
//
// Like every policy it sees a Decision and a SeatView and nothing else (R4):
// what an option IS it reads off the option's tags and facts.
import type { Decision, Option, SeatView, UnitView } from '../seat';
import { legalPolicy } from './legal';
import type { Policy } from './policy';
import type { Rng } from './rng';

interface Grid { col: number; row: number }

const apart = (a: Grid, b: Grid): number => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);

// Where a Movement or a Landing Point option ends, when it says.
function endOf(o: Option): Grid | null {
  const to = o.facts?.to as { c?: number; r?: number } | undefined;
  return to && typeof to.c === 'number' && typeof to.r === 'number' ? { col: to.c, row: to.r } : null;
}

// The facing that looks from one Grid at another: along whichever axis they
// are further apart on. 0 north, 1 east, 2 south, 3 west.
function facingAt(from: Grid, at: Grid): number {
  const dc = at.col - from.col;
  const dr = at.row - from.row;
  if (Math.abs(dr) >= Math.abs(dc)) return dr >= 0 ? 2 : 0;
  return dc >= 0 ? 1 : 3;
}

const tagged = (d: Decision, tag: string): Option[] => d.options.filter((o) => o.tags.includes(tag));

// The enemy units on the board that can be fought.
const foesOf = (view: SeatView): UnitView[] =>
  view.units.filter((u) => u.side !== view.seat && u.deployed && u.alive && u.kind !== 'projectile');

function nearestFoe(foes: UnitView[], g: Grid): { foe: UnitView; dist: number } | null {
  let best: { foe: UnitView; dist: number } | null = null;
  for (const foe of foes) {
    const dist = apart(g, foe.grid);
    if (!best || dist < best.dist) best = { foe, dist };
  }
  return best;
}

// Of the options that end somewhere, the ones that end nearest an enemy; and
// of those, the ones that end facing it.
function closest(options: Option[], foes: UnitView[], rng: Rng): { option: Option; dist: number } | null {
  let dist = Infinity;
  let best: Option[] = [];
  for (const o of options) {
    const g = endOf(o);
    const near = g ? nearestFoe(foes, g) : null;
    if (!near) continue;
    if (near.dist < dist) { dist = near.dist; best = [o]; } else if (near.dist === dist) best.push(o);
  }
  if (!best.length) return null;
  const facing = best.filter((o) => {
    const g = endOf(o)!;
    const near = nearestFoe(foes, g)!;
    return o.facts?.facing === undefined || o.facts.facing === facingAt(g, near.foe.grid);
  });
  return { option: rng.pick(facing.length ? facing : best), dist };
}

// The Movement that takes the unit furthest along its road to the enemy it
// can reach soonest on foot (the seam's `roads`: the walk around a wall, not
// the line through it). Null when it already stands beside an enemy, when no
// road is known, or when nothing on offer ends on the road.
function alongRoad(d: Decision, moves: Option[], foes: UnitView[], rng: Rng): Option | null {
  const roads = d.facts.roads as Record<string, { c: number; r: number }[]> | undefined;
  if (!roads) return null;
  let best: { uid: string; road: { c: number; r: number }[] } | null = null;
  for (const [uid, road] of Object.entries(roads)) {
    if (!best || road.length < best.road.length) best = { uid, road };
  }
  if (!best || !best.road.length) return null;
  const foe = foes.find((u) => String(u.uid) === best!.uid);
  for (let i = best.road.length - 1; i >= 0; i--) {
    const g = { col: best.road[i].c, row: best.road[i].r };
    const here = moves.filter((o) => { const e = endOf(o); return !!e && e.col === g.col && e.row === g.row; });
    if (!here.length) continue;
    // Ended looking along the road: at its next Grid, or at the enemy from its last.
    const next = best.road[i + 1] ? { col: best.road[i + 1].c, row: best.road[i + 1].r } : foe?.grid;
    const facing = next ? here.filter((o) => o.facts?.facing === undefined || o.facts.facing === facingAt(g, next)) : [];
    return rng.pick(facing.length ? facing : here);
  }
  return null;
}

function activation(d: Decision, view: SeatView, rng: Rng): { option: string; why: string } | null {
  const foes = foesOf(view);
  const me = view.units.find((u) => u.uid === d.unit);
  // A shot on offer is taken, and a Charge that is up is spent on it.
  const shots = [...tagged(d, 'attack'), ...tagged(d, 'electronic')];
  if (shots.length) {
    const charged = shots.filter((o) => o.tags.includes('spend-charge'));
    const pick = rng.pick(charged.length ? charged : shots);
    return { option: pick.id, why: 'a shot is on offer' };
  }
  // A Projectile with nothing to take still resolves its Delayed Action: it
  // is destroyed, or stays where its card keeps it (4.7.5).
  const spent = tagged(d, 'detonate');
  if (spent.length) return { option: spent[0].id, why: 'a Projectile resolves its Delayed Action' };
  if (!foes.length || !me) return null;
  const here = nearestFoe(foes, me.grid);
  // A Projectile goes where the enemy is. Not a Smoke card: a Screen on the
  // enemy is the enemy's cover.
  const land = closest(tagged(d, 'launch').filter((o) => !o.tags.includes('smoke')), foes, rng);
  if (land) return { option: land.option.id, why: 'a Projectile, as near the enemy as it will go' };
  // Then it closes: the Movement that ends nearest an enemy, or failing that
  // the turn that faces one. Never onto a Mine: it weighs nothing, and that
  // much it can see.
  const moves = tagged(d, 'move').filter((o) => !o.tags.includes('mined'));
  const walks = moves.filter((o) => !o.tags.includes('pivot'));
  const road = alongRoad(d, walks, foes, rng);
  if (road) return { option: road.id, why: 'walking the road to the nearest enemy' };
  // With no road to read (an enemy nothing leads to), the crow's line will do.
  const step = d.facts.roads ? null : closest(walks, foes, rng);
  if (step && here && step.dist < here.dist) return { option: step.option.id, why: 'closing on the nearest enemy' };
  if (here && me.facing !== facingAt(me.grid, here.foe.grid)) {
    const turn = moves.find((o) => o.tags.includes('pivot') && o.facts?.facing === facingAt(me.grid, here.foe.grid));
    if (turn) return { option: turn.id, why: 'turning to face the nearest enemy' };
  }
  // With nothing to shoot and nowhere nearer to stand, it readies what it has.
  const charge = tagged(d, 'charge');
  if (charge.length) return { option: rng.pick(charge).id, why: 'charging for the next shot' };
  if (me.link !== undefined && me.linkMax !== undefined && me.link < me.linkMax) {
    const link = d.options.find((o) => o.tags.includes('restore-link'));
    if (link) return { option: link.id, why: 'restoring Link' };
  }
  const end = d.options.find((o) => o.tags.includes('end'));
  return end ? { option: end.id, why: 'nothing more to do with this activation' } : null;
}

export const eagerPolicy: Policy = {
  name: 'eager',
  choose(d: Decision, view: SeatView, rng: Rng) {
    const foes = foesOf(view);
    // An activation, its own or a Drone's.
    if (d.kind === 'opp.act' || d.kind === 'activation.act') {
      const a = activation(d, view, rng);
      if (a) return a;
    }
    // Whoever may be activated is, before the phase is passed.
    if (d.kind.startsWith('loop.designate.')) {
      const units = tagged(d, 'designate');
      if (units.length) return { option: rng.pick(units).id, why: 'a unit still to activate' };
    }
    // Deployed as far forward as its zone goes: nearest the enemy once there
    // is one on the board, nearest the middle of it until then.
    if (d.kind === 'setup.deploy') {
      const aim: UnitView[] = foes.length ? foes : [{ grid: { col: 5.5, row: 5.5 } } as UnitView];
      const spot = closest(d.options, aim, rng);
      if (spot) return { option: spot.option.id, why: 'deployed forward' };
    }
    // A dial for what it can do when its turn comes: move, while the enemy is
    // out of every weapon's reach, and otherwise its longest reach.
    if (d.kind === 'planning.dial') {
      const me = view.units.find((u) => u.uid === d.unit);
      const near = me ? nearestFoe(foes, me.grid) : null;
      if (me && near) {
        const guns = me.weapons.filter((w) => w.usable && w.timing && (w.type === 'Firing' || w.type === 'Melee' || w.type === 'Projectile'))
          .sort((a, b) => b.range - a.range);
        const reach = guns.find((w) => Math.max(1, w.range) >= near.dist);
        const want = reach ? `timing:${reach.timing}` : 'timing:movement';
        const o = d.options.find((x) => x.tags.includes(want));
        if (o) return { option: o.id, why: reach ? `in reach of its ${reach.name}` : 'out of reach, so it moves first' };
      }
    }
    // A Focus is declared while there is Link to spare for it.
    if (d.kind.endsWith('.focus') || d.kind === 'attack.partfocus') {
      const me = view.units.find((u) => u.uid === d.unit);
      const use = d.options.find((o) => o.tags.includes('focus') && o.tags.includes('spend-link'));
      if (use && me && (me.link ?? 0) >= 3 && rng.next() < 0.5) return { option: use.id, why: 'Link to spare for a Focus' };
      return { option: d.fallback, why: 'no Focus' };
    }
    if (d.kind.endsWith('.reroll')) {
      const some = d.options.find((o) => o.id === 'reroll.idle') ?? d.options.find((o) => o.tags.includes('reroll'));
      if (some) return { option: some.id, why: 'the Focus is paid for, so it is used' };
    }
    // A Multi-Target's whole pool goes at the target it chose.
    if (d.kind === 'attack.split') return { option: d.fallback, why: 'the whole pool at the target it chose' };
    // An Undo the other seat asks for is agreed to (M9.4).
    if (d.kind === 'rollback.answer') return { option: d.fallback, why: 'an Undo asked is agreed to' };
    return legalPolicy.choose(d, view, rng);
  },
};
