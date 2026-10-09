// SECONDARY TASKS FOR A COMPUTER SEAT (M20; AI-OPPONENT-PLAN.md section 4). The answers to the questions a Secondary
// Task puts at setup: which card to take (`setup.secondary`), and what a card names (`setup.designate.target`, a
// Mech; `setup.designate.zone`, a Tactical Zone). What a card names is one reading for every policy; which card to take
// is a style's (M19): OTTO, 2026-10-09, the Brawler "would probably be more inclined to take secondary tasks that are
// related to killing enemy mechs rather than objectives since it's built to be more aggressive". What a card pays
// in play is the Ace's weight `secondary` (evaluate.ts).
import type { Decision, Option, SeatView, UnitView } from '../seat';
import type { Choice } from './policy';

type Grid = { col: number; row: number };

// How hard a Mech is to destroy: the Armor and Structure of its Parts still standing.
export const toughness = (u: UnitView): number => u.parts.filter((p) => p.state !== 'destroyed').reduce((n, p) => n + p.armor + p.structure, 0);
// What it strikes with itself: its Firing and Melee dice (a Projectile's kill is the Projectile's, FAQ P4).
export const armDice = (u: UnitView): number => u.weapons.filter((x) => x.usable && (x.type === 'Firing' || x.type === 'Melee')).reduce((n, x) => n + x.yellow + 1.5 * x.red, 0);

// WHAT A CARD NAMES, for the card of the squad the question names (`for`): the Head the other squad's Behead will
// hunt, our own Mech hardest to destroy; a Bounty, the enemy Mech easiest to destroy; an Escort, our own hardest; a
// Test Unit, our own with the most Firing and Melee dice; a Planned Obsolescence (it pays when it falls), our own
// likeliest to fall; an Excavation Site, the zone nearest our deployment and farthest from theirs, one the Main Task
// scores counting two Grids further off (the other squad is drawn there too). The Ace's `secName`, the Brawler's
// `hunter`.
export function secondaryName(d: Decision, view: SeatView): Choice | null {
  const holder = d.facts.for as SeatView['seat'] | undefined;
  const card = holder ? view.secondary?.[holder] ?? null : null;
  if (!card) return null;
  if (d.kind === 'setup.designate.zone') {
    const cell = (ref: string): Grid => { const [col, row] = ref.split(',').map(Number); return { col, row }; };
    const ours = ((d.facts.zone as string[] | undefined) ?? []).map(cell);
    const theirs = ((d.facts.foeZone as string[] | undefined) ?? []).map(cell);
    const gap = (from: Grid[], to: Grid[]): number => (from.length && to.length
      ? Math.min(...from.flatMap((a) => to.map((b) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row)))) : 0);
    let best: { o: Option; score: number } | null = null;
    for (const o of d.options) {
      const z = view.zones.find((x) => o.id === `zone:${x.id}`);
      if (!z) continue;
      const cells = z.cells.map(cell);
      const score = gap(theirs, cells) - gap(ours, cells) - (z.scoring ? 2 : 0);
      if (!best || score > best.score) best = { o, score };
    }
    return best ? { option: best.o.id, reason: 'secondary_zone', why: `${card.name}: the zone nearest our deployment` } : null;
  }
  const mechs = d.options
    .map((o) => ({ o, u: o.id.startsWith('mech:') ? view.units.find((x) => x.uid === Number(o.id.slice(5))) : undefined }))
    .filter((x): x is { o: Option; u: UnitView } => !!x.u);
  if (!mechs.length) return null;
  const most = (score: (u: UnitView) => number, reason: string, why: string): Choice => {
    const best = mechs.reduce((a, b) => (score(b.u) > score(a.u) ? b : a));
    return { option: best.o.id, reason, why: `${card.name}: ${why}` };
  };
  const ownMechs = mechs[0].u.side === view.seat;
  switch (card.kind) {
    case 'destroy-designated':
      // Behead is the other squad's card, naming a Mech of ours; Bounty Hunt names theirs; Planned Obsolescence ours.
      if (holder !== view.seat) return most(toughness, 'secondary_head', 'the Mech hardest to destroy');
      return ownMechs ? most((u) => -toughness(u), 'secondary_obsolete', 'the Mech likeliest to fall')
        : most((u) => -toughness(u), 'secondary_bounty', 'the enemy Mech easiest to destroy');
    case 'survive-designated':
      return most(toughness, 'secondary_escort', 'the Mech hardest to destroy');
    case 'per-kill-by-unit':
      return most(armDice, 'secondary_test', 'the Mech with the most Firing and Melee dice');
    default:
      return null;
  }
}

// A HUNTER'S CARD (the Brawler's `hunter`): one that pays for destroying the enemy, not for holding ground. Against a
// squad of one Mech, Behead: its Head can only be that Mech, the kill a fighter is after anyway, at 5. Otherwise
// Annihilation, which pays for every enemy Mech and Drone destroyed; then Bounty Hunt, Behead, Weapons Test.
export function huntersCard(d: Decision, view: SeatView): Choice | null {
  const offered = (id: string): Option | undefined => d.options.find((o) => o.id === `secondary:${id}`);
  const enemyMechs = view.units.filter((u) => u.side === view.other && u.kind === 'mech').length;
  const pick = (enemyMechs === 1 ? offered('decapitation') : undefined)
    ?? offered('annihilation') ?? offered('bounty-hunt') ?? offered('decapitation') ?? offered('weapons-test');
  return pick ? { option: pick.id, reason: 'secondary_hunter', why: `${pick.label}: it pays for the enemy destroyed` } : null;
}
