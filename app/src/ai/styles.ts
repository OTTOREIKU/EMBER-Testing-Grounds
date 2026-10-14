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

// A Command spent so none goes unspent (`noHold`) as the Ace and the Veteran do: MEASURED ON THE BRAWLER 2026-10-13
// (measure_brn.sh, the Ace its foe): random squads 32 of 100 against 31 (2 turned to a win, 1 from one), community
// squads 28.5 of 50 against 26 (3, 0; VP margin +0.84 a game, p 0.05); the Commands passed 0.6 to 0.2 and 0.8 to 0.0 a
// game. Level and closer to how people play (OTTO's rule): the Brawler, and the Recruit made of it, play it too.
export const BRAWLER_SKILLS: Partial<Skills> = { hunter: true };
// Not the learned judge (`learned`): it was measured on the Ace alone, and the Brawler (and the Recruit made of it)
// was measured without it. Nor a Command-only Drone's Command a round on (`commandNext`, 2026-10-12): level on random
// squads, its margins a little worse, kept off until measured on community squads. Nor an RWS Mech's Commands a round
// on (`rwsNext`, 2026-10-13): measured on the Ace and the Veteran alone. Nor an interceptor standing where it covers its
// squadmates (`coverMates`, 2026-10-14): measured on the Ace alone.
export const BRAWLER_WEIGHTS: Partial<Weights> = { exposure: 0.4, exposureLater: 0.2, hunt: 1, closeIn: 1, learned: 0, commandNext: 0, rwsNext: 0, coverMates: 0, overkill: 0, flightOdds: 0 };
export const brawlerPolicy: Policy = { ...makeTactician(BRAWLER_SKILLS, BRAWLER_WEIGHTS), name: 'brawler' };

// THE MISSILE BARRAGE (M24 and M19, 2026-10-13; OTTO: "Lets bake in a missile strategy, mechs and drones that try to
// fire as many missiles as possible to disrupt the opponents, maybe even build some custom squads that focus on as
// many missiles as possible"): the Ace, with a flat amount more for every Projectile launched at something
// (`launchBias`) and a Volley counted whole (`volleyLaunch`). A practice style, judged first by how many Projectiles
// it launches (M19); best with a squad built for it (the missile squads of M24).
export const MISSILE_SKILLS: Partial<Skills> = {};
export const MISSILE_WEIGHTS: Partial<Weights> = { launchBias: 1, volleyLaunch: 1 };
export const missilePolicy: Policy = { ...makeTactician(MISSILE_SKILLS, MISSILE_WEIGHTS), name: 'missile' };
