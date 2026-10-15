// THE LEVELS A PLAYER MAY PICK (M9.1; OTTO, 2026-10-03: "Yes difficulty
// levels"). Each is one policy, and each was measured against the others
// (AI-OPPONENT-PLAN.md section 12, "M9.1"):
//   RECRUIT: the Brawler (our own aggressive style of the Tactician,
//     styles.ts), and now and then the answer to a turn drawn by lot from the
//     legal ones (`blundering`): a player learning the game can win.
//   VETERAN: the Tactician without its look ahead (`VETERAN_SKILLS`,
//     `VETERAN_WEIGHTS`): it plays for the mission a turn at a time.
//   ACE: the Tactician whole.
import { legalPolicy } from './legal';
import { BRAWLER_SKILLS, BRAWLER_WEIGHTS, brawlerPolicy, customSet, STYLE_SETS, type StyleSet } from './styles';
import type { Choice, Policy } from './policy';
import type { Rng } from './rng';
import { makeTactician, SKILLS, type Skills } from './tactician';
import { TACTICIAN, type Weights } from './evaluate';
import type { Decision } from '../seat';

// The questions a mistake is made in: a unit's turn, its Timing Dial, a
// Command given. The rest (the dice, a defence, the setup) are answered as the
// policy answers them: a mistake there reads as a broken page, not a player.
const TURNS = new Set(['opp.act', 'activation.act', 'planning.dial', 'loop.designate.command']);

// A POLICY THAT MAKES MISTAKES: of the questions above, one in `1 / rate` is
// answered by lot among the legal answers (the legal policy's draw), the rest
// as `policy` answers them. The draw is the driver's own generator, so a
// seeded game makes the same mistakes twice.
export function blundering(policy: Policy, rate: number, name = `${policy.name}:blunders`): Policy {
  const slips = (d: Decision, rng: Rng): boolean => TURNS.has(d.kind) && d.options.length > 1 && rng.next() < rate;
  const slip = (d: Decision, view: Parameters<Policy['choose']>[1], rng: Rng): Choice => {
    const c = legalPolicy.choose(d, view, rng);
    return { option: c.option, reason: 'blunder', why: `a mistake: ${c.why ?? 'drawn by lot'}` };
  };
  return {
    name,
    // What the driver reads of the policy as a game begins (policy.ts) goes with it.
    ...(policy.trueRange ? { trueRange: true } : {}),
    ...(policy.judge ? { judge: true } : {}),
    choose: (d, view, rng) => (slips(d, rng) ? slip(d, view, rng) : policy.choose(d, view, rng)),
    ...(policy.ponder
      ? { ponder: (d: Decision, view: Parameters<Policy['choose']>[1], rng: Rng, breathe: () => Promise<void>) => (slips(d, rng) ? Promise.resolve(slip(d, view, rng)) : policy.ponder!(d, view, rng, breathe)) }
      : {}),
  };
}

// How often the Recruit's turn goes wrong. MEASURED (2026-10-09, M21: the
// Recruit is made of our own Brawler, far stronger than the copy it replaced)
// by the two yardsticks the copy's Recruit was set by at 0.25: against a player
// who attacks whatever is in reach (eager, the copied games, 200 a rate) ours
// won 128 at 0.40, 104 at 0.55, 56 at 0.70 (the copy's 89); against the
// Veteran (random squads, 200 a rate) ours won 66 at 0.25, 42 at 0.40, 26 at
// 0.55 (the copy's about 11 in 100). At 0.60, played by both: eager 99 to its
// 96, the Veteran 180 of 200: where the copy's Recruit stood on both.
export const RECRUIT_RATE = 0.6;
export const recruitPolicy: Policy = blundering(brawlerPolicy, RECRUIT_RATE, 'recruit');

// The Veteran: the Tactician that does not look ahead to the other squad's
// reply (`exposure` off): it plays the best turn it sees and does not ask what
// standing there will cost it. MEASURED (section 12, M9.1): the Ace beats it
// 179 of 200. Two milder
// handicaps were measured and set aside, too close to the Ace to be a level of
// their own: no worth on its next turn (the Ace 114 of 200), and the reply
// weighed at about half with that (the Ace 112 of 200).
// The learned judge is the Ace's alone (`learned`, M17), and so is its own choice of Secondary Task (`cardPick`): each
// was measured on the Ace, and the ladder was measured without them.
export const VETERAN_SKILLS: Partial<Skills> = { exposure: false, cardPick: false };
export const VETERAN_WEIGHTS: Partial<Weights> = { learned: 0 };
export const veteranPolicy: Policy = { ...makeTactician(VETERAN_SKILLS, VETERAN_WEIGHTS), name: 'veteran' };

// EACH LEVEL'S OWN SKILLS AND WEIGHTS, as the policies above are made of them, for a style to be laid over (M19). The
// Recruit is the Brawler's, with its mistakes made after.
export const LEVEL_SETS: Record<string, StyleSet & { blunders?: number }> = {
  tactician: { skills: {}, weights: {} },
  veteran: { skills: VETERAN_SKILLS, weights: VETERAN_WEIGHTS },
  brawler: { skills: BRAWLER_SKILLS, weights: BRAWLER_WEIGHTS },
  recruit: { skills: BRAWLER_SKILLS, weights: BRAWLER_WEIGHTS, blunders: RECRUIT_RATE },
};

// A level's own skills and weights, whole (what a Custom row reads as the level's own).
export function ownSet(level: string): { skills: Skills; weights: Weights } | null {
  const base = LEVEL_SETS[level];
  return base ? { skills: { ...SKILLS, ...base.skills }, weights: { ...TACTICIAN, ...base.weights } } : null;
}

// A LEVEL PLAYING A STYLE (M19): the level's own skills and weights with the style's laid over them, and the
// Recruit's mistakes made after. Null where the style changes nothing (Default, an unknown style, a Custom style left
// at the level's own, a level that is no Tactician): the level's own policy then plays, the very one measured.
export function styledPolicy(level: string, style: string, custom: Readonly<Record<string, string>> = {}): Policy | null {
  const base = LEVEL_SETS[level];
  const own = ownSet(level);
  if (!base || !own) return null;
  const set = style === 'custom' ? customSet(custom, own) : STYLE_SETS[style];
  if (!set || (!Object.keys(set.skills).length && !Object.keys(set.weights).length)) return null;
  const made = makeTactician({ ...base.skills, ...set.skills }, { ...base.weights, ...set.weights });
  const named: Policy = { ...made, name: `${level}+${style}` };
  return base.blunders ? blundering(named, base.blunders, `recruit+${style}`) : named;
}
