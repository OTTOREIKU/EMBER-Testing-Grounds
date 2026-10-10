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

export const BRAWLER_SKILLS: Partial<Skills> = { hunter: true };
// Not the learned judge (`learned`): it was measured on the Ace alone, and the Brawler (and the Recruit made of it)
// was measured without it.
export const BRAWLER_WEIGHTS: Partial<Weights> = { exposure: 0.4, exposureLater: 0.2, hunt: 1, closeIn: 1, learned: 0 };
export const brawlerPolicy: Policy = { ...makeTactician(BRAWLER_SKILLS, BRAWLER_WEIGHTS), name: 'brawler' };
