// PLAY STYLES (M19, M21). A style is the Tactician with its own skills and weights and nothing else: every behaviour
// is a named skill or weight of the one AI (OTTO, 2026-10-08: "some sort of dashboard where I would customize how the
// computer acts"; 2026-10-09: "I want to make sure we are using all our own AI").
//
// THE BRAWLER (OTTO, 2026-10-05: it "should want to fight the opponents and cause them to have to reposition or have
// to back off of objectives, it just shouldn't throw away units that arent going to give it value or at least take
// another down or damage it"): the Tactician weighing return fire at half the Ace's (`exposure`, `exposureLater`),
// walking at the other squad's Box carriers and Commander (`hunt`), an outranged unit closing in (`closeIn`), and
// taking a Secondary Task that pays for the enemy destroyed (`hunter`). It still prices every attack by what it
// destroys and every step by what it risks: a fighter, not a gift. Until 2026-10-09 the Brawler was a copy of the
// other app's AI rebuilt on this engine; this replaces it.
import type { Weights } from './evaluate';
import type { Policy } from './policy';
import { makeTactician, type Skills } from './tactician';

// A style as it is laid over a level's own skills and weights (levels.ts styledPolicy).
export interface StyleSet { skills: Partial<Skills>; weights: Partial<Weights> }

// A Command spent so none goes unspent (`noHold`) as the Ace and the Veteran do: MEASURED ON THE BRAWLER 2026-10-13
// (measure_brn.sh, the Ace its foe): random squads 32 of 100 against 31 (2 turned to a win, 1 from one), community
// squads 28.5 of 50 against 26 (3, 0; VP margin +0.84 a game, p 0.05); the Commands passed 0.6 to 0.2 and 0.8 to 0.0 a
// game. Level and closer to how people play (OTTO's rule): the Brawler, and the Recruit made of it, play it too.
export const BRAWLER_SKILLS: Partial<Skills> = { hunter: true };
// Not the learned judge (`learned`): it was measured on the Ace alone, and the Brawler (and the Recruit made of it)
// was measured without it. Nor a Command-only Drone's Command a round on (`commandNext`, 2026-10-12): level on random
// squads, its margins a little worse, kept off until measured on community squads. Nor an RWS Mech's Commands a round
// on (`rwsNext`, 2026-10-13): measured on the Ace and the Veteran alone. Nor an interceptor standing where it covers its
// squadmates (`coverMates`, 2026-10-14): measured on the Ace alone. The missile levers of the same day (`overkill`,
// `flightOdds`, `ammoPace`) it plays as the Ace does, measured on it (2026-10-14/15, the legal squads): with the
// missile squads 143.5 against 134 (Victory Point margin +1.60 a game, p 0.003; points +46, p 0.03), the gain
// ammoPace's (overkill + flightOdds alone 134 against 134); with the community squads level (217.5 against 220 over two
// batches of 200, the points -26 and +39).
export const BRAWLER_WEIGHTS: Partial<Weights> = { exposure: 0.4, exposureLater: 0.2, hunt: 1, closeIn: 1, learned: 0, commandNext: 0, rwsNext: 0, coverMates: 0 };
export const brawlerPolicy: Policy = { ...makeTactician(BRAWLER_SKILLS, BRAWLER_WEIGHTS), name: 'brawler' };

// THE MISSILE BARRAGE (M24 and M19, 2026-10-13; OTTO: "Lets bake in a missile strategy, mechs and drones that try to
// fire as many missiles as possible to disrupt the opponents, maybe even build some custom squads that focus on as
// many missiles as possible"): the Ace, with a flat amount more for every Projectile launched at something
// (`launchBias`) and a Volley counted whole (`volleyLaunch`). A practice style, judged first by how many Projectiles
// it launches (M19); best with a squad built for it (the missile squads of M24).
export const MISSILE_SKILLS: Partial<Skills> = {};
export const MISSILE_WEIGHTS: Partial<Weights> = { launchBias: 1, volleyLaunch: 1 };
export const missilePolicy: Policy = { ...makeTactician(MISSILE_SKILLS, MISSILE_WEIGHTS), name: 'missile' };

// THE STYLES A PLAYER MAY PICK (M19; OTTO, 2026-10-13, the canvas "Computer Play Styles", version 7; released
// 2026-10-15: "release the computer custom styles settings so players can get that in their hands"). HOW the computer
// plays, laid over the level the player picked (how well it plays): each the levers measured and kept off for the
// Ace, as M19 and M24 recorded them. Judged by whether it plays as named, not by wins (measure_m19.sh). The page's
// names and lines are soloask.ts STYLES; Default and Custom are not here (Default changes nothing; Custom is
// CUSTOM_SETS below).
export const STYLE_SETS: Record<string, StyleSet> = {
  // Missile Barrage: the barrage above. MEASURED (measure_m19.sh, the missile squads, 40 games paired with the Ace's own
  // play): 23.9 Projectiles launched a game against 20.0, 6.9 in the first round against 4.0; won 32 against 28.
  missile: { skills: MISSILE_SKILLS, weights: MISSILE_WEIGHTS },
  // Stealth: Optical Camouflage kept. MEASURED (the camouflage squads): hidden 86.8% of its camouflaged rounds against
  // 82.3%, five times cloaked against two; won 22 against 19.
  stealth: { skills: {}, weights: { hiddenWorth: 3 } },
  // Melee Rush: walks to its blades' reach and an outranged blade goes in (`blade`, `bladeIn`, both 2), Shock Attacks
  // weighed twice (`charge`), the blades kept together (`pack`) and the enemy's guns Locked (`lockDeny`). MEASURED (the
  // melee squads; measure_m19b.sh): 0.90 Melee strikes a Mech against 0.70, more of its blades destroyed before they
  // strike (40 against 19); won 13 against 18. The first form (`blade`, `bladeIn` 1 and a push to contact, `closeIn`
  // 2, `contactStep` 0.15) struck LESS (0.65) and the push alone off less still (0.59): rejected.
  melee: { skills: {}, weights: { blade: 2, bladeIn: 2, charge: 2, lockDeny: 1, pack: 1 } },
  // Objective Focus: the walk to the Main Task's zones weighed two and a half times (`zonePull`), return fire still
  // weighed (M24's objective rush without `exposure` walked into fire). MEASURED (the community squads): the Main Task
  // paid 8.15 a game against 7.75, the Secondary 2.35 against 2.60; won 19 against 17. At `zonePull` 3 the Main Task
  // paid less (7.47; won 15): kept at 1.5.
  objective: { skills: {}, weights: { zonePull: 1.5 } },
};

// A level's own skills and weights, whole, for a Custom row to read (`own`).
export interface OwnSet { skills: Skills; weights: Weights }

// THE CUSTOM STYLE (the canvas's "Customize"): each row of soloask.ts CUSTOM_ROWS, and what each of its choices sets
// over the level's own. A choice that is the level's own sets nothing (`ownChoice`), so a Custom style left as it
// opens is the level itself ("Normal matches Default").
export const CUSTOM_SETS: Record<string, Record<string, (own: OwnSet) => StyleSet>> = {
  hunter: {
    On: (o) => ({ skills: { hunter: true }, weights: { hunt: Math.max(o.weights.hunt, 1) } }),
    Off: () => ({ skills: { hunter: false }, weights: { hunt: 0 } }),
  },
  lines: { On: () => ({ skills: { clearLines: true }, weights: {} }), Off: () => ({ skills: { clearLines: false }, weights: {} }) },
  contact: {
    Less: () => ({ skills: {}, weights: { contactStep: 0 } }),
    More: (o) => ({ skills: {}, weights: { contactStep: Math.max(o.weights.contactStep, 0.15), closeIn: Math.max(o.weights.closeIn, 1) } }),
  },
  cover: {
    Less: (o) => ({ skills: {}, weights: { exposure: o.weights.exposure / 2, exposureLater: o.weights.exposureLater / 2 } }),
    More: (o) => ({ skills: { exposure: true }, weights: { exposure: o.weights.exposure * 2, exposureLater: o.weights.exposureLater * 2 } }),
  },
  camo: { On: () => ({ skills: {}, weights: { hiddenWorth: 3 } }), Off: () => ({ skills: {}, weights: { hiddenWorth: 0 } }) },
  launch: {
    Less: (o) => ({ skills: {}, weights: { launch: o.weights.launch / 2 } }),
    More: () => ({ skills: {}, weights: { launchBias: 1 } }),
  },
  volley: {
    On: (o) => ({ skills: {}, weights: { volleyLaunch: Math.max(o.weights.volleyLaunch, 0.05) } }),
    Off: () => ({ skills: {}, weights: { volleyLaunch: 0 } }),
  },
  // As Melee Rush seeks it (its blades and Shock Attacks), without its pack and Locks, which are rows of their own.
  blade: {
    On: (o) => ({ skills: {}, weights: { blade: 2, bladeIn: 2, charge: Math.max(o.weights.charge, 2) } }),
    Off: () => ({ skills: {}, weights: { blade: 0, bladeIn: 0 } }),
  },
  lock: { On: () => ({ skills: {}, weights: { lockDeny: 1 } }), Off: () => ({ skills: {}, weights: { lockDeny: 0 } }) },
  task: {
    Less: (o) => ({ skills: {}, weights: { zonePull: o.weights.zonePull / 2 } }),
    More: (o) => ({ skills: {}, weights: { zonePull: o.weights.zonePull * 2.5 } }),
  },
  wolf: { On: () => ({ skills: { lanes: true }, weights: {} }), Off: () => ({ skills: { lanes: false }, weights: {} }) },
  dials: { On: () => ({ skills: { squadDials: true }, weights: {} }), Off: () => ({ skills: { squadDials: false }, weights: {} }) },
  leash: { On: () => ({ skills: { leash: true }, weights: {} }), Off: () => ({ skills: { leash: false }, weights: {} }) },
};

// The choice a row shows for a level, read off the level itself (the page's own copy, soloask.ts ownChoice, is held
// to this by the suite): Normal for a row of three, else whether the level plays the behaviour at all.
export function ownChoice(row: string, o: OwnSet): string {
  const on = (b: boolean): string => (b ? 'On' : 'Off');
  switch (row) {
    case 'hunter': return on(o.skills.hunter);
    case 'lines': return on(o.skills.clearLines);
    case 'camo': return on(o.weights.hiddenWorth > 0);
    case 'volley': return on(o.weights.volleyLaunch > 0);
    case 'blade': return on(o.weights.blade > 0 || o.weights.bladeIn > 0);
    case 'lock': return on(o.weights.lockDeny > 0);
    case 'wolf': return on(o.skills.lanes);
    case 'dials': return on(o.skills.squadDials);
    case 'leash': return on(o.skills.leash);
    default: return 'Normal';
  }
}

// The Custom style's set over a level: each row picked away from the level's own, in the rows' order.
export function customSet(picks: Readonly<Record<string, string>>, own: OwnSet): StyleSet {
  const out: StyleSet = { skills: {}, weights: {} };
  for (const [row, choices] of Object.entries(CUSTOM_SETS)) {
    const pick = picks[row];
    const set = pick && pick !== ownChoice(row, own) ? choices[pick] : undefined;
    if (!set) continue;
    const s = set(own);
    Object.assign(out.skills, s.skills);
    Object.assign(out.weights, s.weights);
  }
  return out;
}
