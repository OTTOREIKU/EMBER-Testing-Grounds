// WHAT A COMPUTER SEAT IS WIRED TO DO (AI-OPPONENT-PLAN.md, rule R7).
//
// Every command the engine has, and every question a seat can be put, is
// listed here with how a computer seat stands to it. tests/aiseam.test.mjs
// holds this list to the source: a command added to commands.ts, or a
// decision kind added to the seam, fails the suite until it has a line here.
// So "teach the computer this feature" always has a to-do list, and it is
// this file: the lines classed `later`.
//
//   node tests/aicover.mjs            prints the list as a document
//   node tests/aicover.mjs <file>     writes it there (AI-COVERAGE.md)
//
// The classes:
//   seat    an option of owed() carries it: a computer seat chooses it today
//   window  the attack or Counter-roll window sends it as a seat answers there
//   driver  a driver routine sends it, with dice or a secret in hand
//   table   set-up, housekeeping or a referee's correction: no seat chooses it in play
//   later   a player's choice the seam does not offer yet (the plan's M8, unless said)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const COMMANDS = {
  // ---------- setup ----------
  lockMap: ['seat', 'the host locks the battlefield'],
  rollSetup: ['driver', 'the roll for First Player, with the table\'s dice'],
  acceptRoll: ['seat', 'the winner takes the game on'],
  pickEdge: ['seat', 'the First Player\'s table edge'],
  pickSecondary: ['seat', 'offered when the table plays Secondary Tasks (the copied setup plays none)'],
  designateTask: ['seat', 'the Commander, a Tactical Zone, whatever a Task names'],
  placeTaskItem: ['seat', 'a Black Box, kept where it stands or put down in another Large Grid of its zone'],
  finishTasks: ['seat', 'the First Player closes the Tasks step'],
  deployUnit: ['seat', 'one option per unit, open Grid and Stance; in Optical Camouflage for a unit with a Part that Activates it'],
  finishDeployment: ['seat', 'with the second ready'],
  setReady: ['seat', 'ready for the phase to turn'],
  // ---------- the round ----------
  commitTimings: ['driver', 'the hash of the dials, which stay in the seat\'s own memory'],
  revealTimings: ['driver', 'the dials and their salt, once both squads have committed'],
  advancePhase: ['seat', 'sent with the ready that completes the pair'],
  designate: ['seat', 'a Drone to Command, a unit to activate, a Projectile to resolve'],
  passTurn: ['seat', 'pass for the phase'],
  chooseTied: ['seat', 'which of its tied Mechs goes'],
  endOpportunity: ['seat', 'end the Opportunity or the activation'],
  markEndStep: ['seat', 'an End Phase step, the First Player\'s by default'],
  award: ['seat', 'the Victory Points the Tasks step pays, as the engine previews them'],
  dissipateSmoke: ['seat', 'the End Phase\'s Smoke step'],
  // ---------- an activation ----------
  setStance: ['seat', 'a Stance, until the first move or Action fixes it'],
  reboot: ['seat', 'a Shutdown Mech\'s Reboot'],
  maneuver: ['seat', 'the Maneuver, a Movement Action\'s move, a turn on the spot, a Shock Attack\'s walk before its attack'],
  performAction: ['seat', 'the payment of every Action a seat performs; a Charge is this command alone'],
  setCharge: ['seat', 'a Charge spent on an attack; the window sends it for KC Armor'],
  stabilise: ['seat', 'one Token off, or the Link alone'],
  launch: ['seat', 'one Projectile on one Landing Point, through its Volley'],
  queueIntercepts: ['seat', 'the Interception a launch, a Missile\'s flight or an Aerial unit\'s Movement owes, sent with it'],
  spendIntercept: ['seat', 'an Interception attempt: its Token'],
  resolveIntercept: ['seat', 'an owed attempt settled as it is made'],
  clearIntercepts: ['seat', 'making no Interception, on a table that lets the debt be dropped'],
  resolveReaction: ['seat', 'a reaction owed, taken or declined'],
  defenseReaction: ['seat', 'the Defense Reaction: to Defensive Stance on a Penetration'],
  riposte: ['seat', 'a Riposte taken: the attacker\'s Action Opportunity ends, and the Melee Action it buys is a granted attack on the attacker'],
  placeSmoke: ['seat', 'the Screens of a Smoke Grenade as it lands (a Connected shape from the Landing Point) and of an Emergency Smoke taken'],
  removeSmoke: ['seat', 'the Screen a Connected group gives up as a round ends, at a table whose glue keeps that queue (the page\'s)'],
  takeBlackBox: ['seat', 'a Black Box picked up as a Movement passes it, or as the activation ends in its Grid'],
  startCounterRoll: ['seat', 'an Electronic Attack or a Scan on one enemy, a Remote Access on a Terminal, Target Tracing as a reaction, and the one free Scan an attack makes as it designates a unit in Optical Camouflage'],
  grantExtra: ['seat', 'Coordinate: an Extra Action Opportunity handed to an Ally Mech, which acts at once in an Opportunity nested inside the granter\'s'],
  overwatch: ['seat', 'the KK9\'s Overwatch Strike called on an enemy in Range for an Ally Mech, whose Firing Action it owes is then a reaction of its seat\'s'],
  reveal: ['seat', 'a Reveal owed by a unit in Optical Camouflage (an Action or a Maneuver without Silence, Contact, a Scan won against it): where it stands, or in a Grid within its Stealth value'],
  flyToTarget: ['seat', 'a Missile flies at the unit it detonates on; an Unfolded Pholcus jumps at it'],
  unfold: ['seat', 'a folded Pholcus Unfolds in the Delay Phase, where it must'],
  despawn: ['seat', 'a Projectile with no target is destroyed, and a blast on every unit in Range ends with it; the window removes one its blast spent'],
  destroyTerrain: ['seat', 'Destructible Terrain crushed by a Movement that ends in its Grid, the Containers a blast on every unit in Range takes with it, and a Container a Firing or Melee Action targets (the `container` answer; the Tactician\'s `breakIn` values one over a loose Black Box)'],
  transformPart: ['seat', 'a Mode change chosen as an Action (the White Dwarf); the window sends the Tether Mode face'],
  stanceFeedback: ['seat', 'Stance feedback: an Ally Mech in Range to another Stance'],
  restoreAmmo: ['seat', 'a Resupply (a launch taken back is later)'],
  recoverLink: ['seat', 'Link support: Strengthen Link on one Mech or on every Mech in Range, a Link Beacon\'s Delayed Action'],
  repairPart: ['seat', 'the Repair Action: a Repaired Token, a Damaged Part mended, its own or an Ally\'s'],
  coordinateCommand: ['seat', 'Command Coordination: a Command handed to a Drone after an Action or a Maneuver that carries one, by the Tactic that is one, or for nothing where Swarm Tactics goes on; the Drone then acts'],
  // ---------- inside an attack ----------
  setCombatView: ['window', 'the attack as the other seat\'s screen draws it'],
  callDefense: ['window', 'the defender is asked for its dice'],
  answerDefense: ['window', 'the defender\'s dice'],
  clearDefense: ['window', 'the call is closed by the attacker'],
  focus: ['window', 'the Link a Focus costs'],
  focusAnswer: ['window', 'the defender\'s Focus, declared or passed'],
  focusReroll: ['window', 'the dice a Focus rerolls'],
  designateHit: ['window', 'the defender names the Part hit (a Shield)'],
  meleeEvade: ['window', 'Melee Evasion'],
  dodgeEnhance: ['window', 'Dodge Enhancement'],
  kcArmor: ['window', 'KC Armor'],
  spendCommand: ['window', 'the Command Token a declare costs; by a seat, the one a Harpy\'s tow spends (M12)'],
  applyPenetration: ['window', 'the Penetration, on the Part it lands on'],
  applyStatus: ['window', 'a Token an attack or a won Counter-roll grants; the seam sends the one an effect Detonation hands out (a Stun Grenade) and the one an Action puts on (Ambush, Amplify Profile, Target Tag, Optical Camouflage)'],
  removeStatus: ['window', 'a won Scan strips Low Profile; the seam sends a Token cleaned off an Ally (System Cleanup)'],
  drainLink: ['window', 'Link an attack or Target Tracing takes'],
  restoreLink: ['window', 'Link an attack gives back'],
  recordKill: ['window', 'a unit or a Part destroyed, for the Tasks'],
  queueReactions: ['window', 'the defender\'s reaction to being shot at, owed'],
  breakRepaired: ['window', 'a Repaired Part hit again'],
  forceShutdown: ['window', 'a Lightning rider\'s Shutdown, when the attacker takes it'],
  suppress: ['window', 'Suppression, as a Surplus effect'],
  disarm: ['window', 'Disarm, as an attack\'s rider'],
  tether: ['window', 'Tether X on a Hit'],
  forceMove: ['window', 'Drag, inside the window; by a seat, a unit pushed aside by a Crush (M8.2p) and a Knockback or a Push its attack made (M8.2t), and the Ally a Harpy tows (M12)'],
  dropBlackBox: ['window', 'a Penetrated bearer\'s Black Box, put down by the attacker as its attack ends: in Contact with the bearer, on the side nearest itself'],
  // ---------- inside a Counter-roll ----------
  rollCounter: ['window', 'a seat\'s own unit\'s dice, and its Focus reroll'],
  rollTerminal: ['window', 'a Terminal\'s dice, thrown by the Initiator\'s opponent'],
  declareCounterFocus: ['window', 'the Focus, declared or passed'],
  provoke: ['window', 'Yoyu\'s Provoke, taken or left'],
  accessTerminal: ['window', 'a won Remote Access'],
  clearCounterRoll: ['window', 'the exchange closed, by the Initiator\'s seat'],
  // ---------- not offered yet ----------
  crushSwap: ['seat', 'a Crush of a Unit with nowhere to go: the exchange, in one command (4.3.6)'],
  placeInGrid: ['later', 'a unit\'s spot inside its own Grid'],
  blink: ['seat', 'Prototype Blink: places exchanged with a Mech of the same size, both facings set'],
  switchForm: ['seat', 'the Bit\'s Stance Change: a face, where it stands or with the one Movement it owes, made by that face'],
  layMine: ['seat', 'Auto Mine Laying: a Mine laid in a Grid of the route walked, paid with the Range left'],
  recoverBit: ['seat', 'an empty Bit Port recovers a Bit of its own in Range'],
  attackMode: ['seat', 'the extra Action Tick that fixes the Stance (the plan\'s M7.6)'],
  overload: ['seat', 'Overload: Ticks bought with Link (M7.6)'],
  linkTick: ['seat', 'a pilot\'s Link for an Action Tick (FPA-04-2; M7.6)'],
  endSwarm: ['later', 'Swarm Tactics stopped by name: a seat lets the Token lapse by passing, or by ending the Opportunity, which the engine takes for the same'],
  claimItem: ['later', 'a Task item claimed (missions beyond the two copied)'],
  claimZone: ['later', 'a zone claimed on a table with no board'],
  concede: ['later', 'conceding: a computer that knows when it has lost (M9)'],
  rollbackRequest: ['later', 'asking for an Undo (M9.4)'],
  rollbackAnswer: ['seat', 'answering an Undo the other seat asks for: the computer agrees (M9.4)'],
  firewatch: ['seat', 'Firewatch (ZPA-38): a Link for a Command Token as the Opportunity opens, weighed by the Coordination it buys (M8.2r)'],
  asterRestore: ['seat', 'Aster (ZPA-36): a Command Token for 1 Link on an Ally Mech, beside the Command Phase\'s designations (M8.2r)'],
  controlledMove: ['seat', 'The Red Shoes: one of an enemy unit\'s own Maneuvers or Move Actions, steered by this seat where its squad could do most to it (M8.2s)'],
  playTactic: ['seat', 'a Tactics Card at the moment its text names: Additional Instructions beside the Command Phase\'s designations and at its Continue, System Repair and Tactical Disposition in a Mech\'s Opportunity, Hit and Run as one ends, Battlefield Recovery and Remote Restart in the End Phase (M8.2q)'],
  // ---------- the table ----------
  configureTable: ['table', 'the host: map, mission, rounds'],
  importSquad: ['table', 'the host: a squad'],
  startMatch: ['table', 'the host'],
  endMatch: ['table', 'the host'],
  setMode: ['table', 'the guide\'s mode'],
  setStrict: ['table', 'strictness'],
  handOver: ['table', 'pass-and-play'],
  leaveGuided: ['table', 'out of the guided game'],
  setPhase: ['table', 'a referee\'s correction'],
  resetRounds: ['table', 'a referee\'s correction'],
  adjustCommandTokens: ['table', 'a referee\'s correction'],
  adjustVp: ['table', 'a referee\'s correction'],
  setPartState: ['table', 'damage set by hand'],
  setFreeTicks: ['table', 'freeform Ticks'],
  setLoad: ['table', 'a loadout edited'],
  renameUnit: ['table', 'a unit renamed'],
  setInventory: ['table', 'the squad\'s inventory'],
  setTactics: ['table', 'a hand of Tactics Cards dealt'],
  setEnvironment: ['table', 'an Environment Card on a Grid'],
  setAuraReach: ['table', 'a board-less table\'s aura record'],
  ageStatus: ['table', 'a Token aged by hand on a board-less table'],
  spendAmmo: ['table', 'an Ammo Token spent by hand: in play the Action\'s payment spends it'],
  setTiming: ['table', 'a dial set on a table with no second seat: a computer commits a hash instead'],
  lockDials: ['table', 'the same table\'s dial lock'],
  noteRoll: ['table', 'the host\'s dice source marks a roll, which seals the Undo'],
  onBehalf: ['table', 'a board-less table records for the other squad'],
  setRollbackCatalog: ['table', 'the Undo\'s catalogue'],
  restoreIntercept: ['table', 'an Interception Token taken back: a free table\'s correction, which a strict table refuses (4.9, M27; the Undo takes back a mistaken spend)'],
  cutTether: ['table', 'a Tether recorded as ended on a table with no board; on a board the engine cuts it itself after every command (units.ts settleTethers)'],
};

// Every question a seat can be put, the answer that is always safe, and which
// policies have a rule of their own for it (the legal policy draws by lot over
// whatever it is offered, so it answers them all).
export const DECISIONS = {
  'setup.lock': ['lock', []],
  'setup.roll': ['roll', []],
  'setup.accept': ['accept', []],
  'setup.edge': ['the Black edge', []],
  'setup.secondary': ['the first card', []],
  'setup.designate.*': ['the first unit or zone', ['brawler', 'tactician']],
  'setup.box': ['leave it where it stands', []],
  'setup.tasks': ['continue', []],
  'setup.deploy': ['the first Grid', ['eager', 'brawler', 'tactician']],
  'setup.ready': ['ready', []],
  'setup.begin': ['begin', []],
  'planning.dial': ['the Timing of the first Action the Mech could perform', ['eager', 'brawler', 'tactician']],
  'planning.commit': ['commit', []],
  'planning.reveal': ['reveal', []],
  'phase.ready': ['ready', ['tactician']],
  'loop.designate.*': ['pass', ['eager', 'brawler', 'tactician']],
  'opp.reboot': ['Reboot to Defensive', ['brawler']],
  'opp.act': ['end the Opportunity', ['eager', 'brawler', 'tactician']],
  'activation.act': ['end the activation', ['eager', 'brawler', 'tactician']],
  'intercept.attempt': ['the first attempt owed', []],
  'smoke.thin': ['the first Screen of the group that owes one', ['tactician']],
  'reaction.answer': ['decline it; or take the Stance a Defense Reaction gives, or a Riposte, which cost nothing, or the attack behind a won Scan, which is paid for, or the first shot an Overwatch Strike owes', ['tactician']],
  'reveal.make': ['Reveal where it stands', ['tactician']],
  'mine.lay': ['lay none', ['tactician']],
  'shove.make': ['make the Forced Movement, the facing left as it was (a Push along the attack direction); blocked, or a shove after a Movement (which may be let go by), leave it be (M8.2t, M8.2u)', ['tactician']],
  'rollback.answer': ['accept: the computer agrees to an Undo the other seat asks for (M9.4)', ['eager']],
  'tactic.after': ['let Hit and Run go by (M8.2q)', ['tactician']],
  'tactic.end': ['no Tactics Card this End Phase (M8.2q)', ['tactician']],
  'blast.resolve': ['the first Explosion still to make, or the end of it; for Smoke, the one Screen where it landed', ['tactician']],
  'end.step': ['the step itself', []],
  'attack.split': ['begin with the whole pool on the target clicked', ['eager', 'tactician']],
  'attack.partfocus': ['keep the Part the die found', ['eager', 'brawler']],
  'attack.part': ['roll the Part Die', ['brawler', 'tactician']],
  'attack.roll': ['roll', []],
  'attack.next': ['go on', []],
  'attack.focus': ['pass', ['eager', 'brawler', 'tactician']],
  'attack.reroll': ['keep the roll', ['eager', 'brawler', 'tactician']],
  'attack.resolve': ['resolve', []],
  'attack.apply': ['apply', []],
  'attack.surplus': ['the first effect', ['brawler', 'tactician']],
  'attack.finish': ['decline', ['brawler']],
  'defence.declare': ['declare nothing', ['brawler', 'tactician']],
  'defence.designate': ['keep the Part', []],
  'defence.roll': ['roll', []],
  'defence.focus': ['pass', ['eager', 'brawler', 'tactician']],
  'defence.reroll': ['keep the roll', ['eager', 'brawler', 'tactician']],
  'contest.roll': ['roll', []],
  'contest.focus': ['pass', ['eager']],
  'contest.reroll': ['keep the roll', ['eager']],
  'contest.provoke': ['leave its Stance alone', []],
  'contest.apply': ['apply', []],
  'contest.close': ['close', []],
};

// What an activation does not offer yet, in the seam's own words: each is a
// `continue` or an early return in owed.ts with this reason beside it.
export const NOT_OFFERED = [
  'a Container as a target, a Neutral target; a Charge spent on an attack that designates a unit in Optical Camouflage',
  'a Multi-Target attack\'s further target in Optical Camouflage (its free Scan)',
  'a 1x3 line',
  'an effect Detonation whose Token no rule names',
  'the Reveal Action (a Reveal made by choice), and card text no reader names',
  'debts: of an Emergency Smoke\'s two Screens, the pairs that leave the unit\'s own Grid bare',
];

export function document() {
  const by = (cls) => Object.entries(COMMANDS).filter(([, v]) => v[0] === cls);
  const table = (rows) => ['| Command | What it is |', '|---|---|', ...rows.map(([k, v]) => `| \`${k}\` | ${v[1]} |`)].join('\n');
  const counts = ['seat', 'window', 'driver', 'table', 'later'].map((c) => `${by(c).length} ${c}`).join(', ');
  return `# What the computer seat is wired to do

**GENERATED** from \`app/tests/aicover.mjs\` (run \`node tests/aicover.mjs <this file>\` from \`app\`). Do not
edit it by hand: change the register, and \`tests/aiseam.test.mjs\` holds the register to the source.

${Object.keys(COMMANDS).length} commands: ${counts}. ${Object.keys(DECISIONS).length} kinds of question.

## The to-do list: a player's choices the seam does not offer yet

${table(by('later'))}

In an activation, in the seam's own words:

${NOT_OFFERED.map((x) => `- ${x}`).join('\n')}

## Chosen by a seat today

${table(by('seat'))}

## Sent by a driver routine (dice, or a secret)

${table(by('driver'))}

## Sent by the attack or Counter-roll window as a seat answers there

${table(by('window'))}

## The table's, never a seat's

${table(by('table'))}

## The questions a seat is put

| Kind | The answer that is always safe | Policies with a rule of their own |
|---|---|---|
${Object.entries(DECISIONS).map(([k, v]) => `| \`${k}\` | ${v[0]} | ${v[1].join(', ') || 'none (drawn by lot, or the safe answer)'} |`).join('\n')}
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = process.argv[2];
  if (out) { writeFileSync(out, document()); console.log(`written to ${out}`); } else console.log(document());
}
