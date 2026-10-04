// THE LEVELS A PLAYER MAY PICK (M9.1; OTTO, 2026-10-03: "Yes difficulty
// levels"). Each is one policy, and each was measured against the others
// (AI-OPPONENT-PLAN.md section 12, "M9.1"):
//   RECRUIT: the Brawler (it attacks what it can reach and walks at what it
//     cannot), and now and then the answer to a turn drawn by lot from the
//     legal ones (`blundering`): a player learning the game can win.
//   VETERAN: the Tactician without its look ahead (`VETERAN_SKILLS`,
//     `VETERAN_WEIGHTS`): it plays for the mission a turn at a time.
//   ACE: the Tactician whole.
import { brawlerPolicy } from './brawler';
import { legalPolicy } from './legal';
import type { Choice, Policy } from './policy';
import type { Rng } from './rng';
import { makeTactician, type Skills } from './tactician';
import type { Weights } from './evaluate';
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
    choose: (d, view, rng) => (slips(d, rng) ? slip(d, view, rng) : policy.choose(d, view, rng)),
    ...(policy.ponder
      ? { ponder: (d: Decision, view: Parameters<Policy['choose']>[1], rng: Rng, breathe: () => Promise<void>) => (slips(d, rng) ? Promise.resolve(slip(d, view, rng)) : policy.ponder!(d, view, rng, breathe)) }
      : {}),
  };
}

// How often the Recruit's turn goes wrong. MEASURED (section 12, M9.1): at
// 0.25 the Brawler beats it 143 games of 200 (the Recruit wins 50).
export const RECRUIT_RATE = 0.25;
export const recruitPolicy: Policy = blundering(brawlerPolicy, RECRUIT_RATE, 'recruit');

// The Veteran: the Tactician that does not look ahead to the other squad's
// reply (`exposure` off): it plays the best turn it sees and does not ask what
// standing there will cost it. MEASURED (section 12, M9.1): it beats the
// Brawler 152 games of 200 and the Ace beats it 179 of 200. Two milder
// handicaps were measured and set aside, too close to the Ace to be a level of
// their own: no worth on its next turn (the Ace 114 of 200), and the reply
// weighed at about half with that (the Ace 112 of 200).
export const VETERAN_SKILLS: Partial<Skills> = { exposure: false };
export const VETERAN_WEIGHTS: Partial<Weights> = {};
export const veteranPolicy: Policy = { ...makeTactician(VETERAN_SKILLS, VETERAN_WEIGHTS), name: 'veteran' };
