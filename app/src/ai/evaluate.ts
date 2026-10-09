// WHAT THINGS ARE WORTH to the Tactician (AI-OPPONENT-PLAN.md, section 6).
//
// One currency: Victory Points. The Brawler weighs an attack by what it
// destroys and nothing else, in numbers of its own (150, 50, 25), so it can
// win every fight on a board and lose the game on it. Here a zone held, a
// Part destroyed and a Commander lost are the same kind of number, and an
// answer is chosen by adding them up.
//
//   - A Victory Point is 1.
//   - A unit is worth what its cards cost, at a rate (`material`): the points
//     still standing in it. That is not Victory Points by any rule of the
//     game; it is what a squad's guns go on to earn or deny, as an estimate.
//   - The mission is read off the view: what is banked, and what the Main
//     Task will go on paying if the board stays as it stands.
//
// Everything here is arithmetic on a view and on odds the engine worked out.
// No rule is read here and no card is known here: a Part is worth its points
// whatever it is. The numbers are the weights, and they are data (section 7:
// a tuner plays one set of them against another).
import type { Forecast, SeatView, UnitView } from '../seat';

export interface Weights {
  // Victory Points for each point of a unit's cards lost. A 400-point squad
  // destroyed is counted as 12.
  material: number;
  // The share of a Part's worth (a Drone's whole worth) that is gone when it
  // goes from Intact to Damaged: it still works, and is one Penetration
  // nearer to not working. At a half, two attacks that each Damage are worth
  // together what they are worth one after the other (the second finishing
  // what the first began), so the odds of each can simply be added.
  damaged: number;
  // One Link stripped from a Mech.
  link: number;
  // What a Focus must add to an attack (or take off one) before a Link is
  // spent on it: a Link is a reroll not there for the next attack.
  focus: number;
  // VIP: the enemy Commander destroyed pays the Main Task's Victory Points
  // and ends the game, so it counts in full; its own Commander lost counts
  // for more, because nothing can be won back after it.
  vipKill: number;
  vipOwn: number;
  // VIP: the chance a game goes the distance with both Commanders standing,
  // which is when a destroyed Part of one pays.
  vipPart: number;
  // What a Victory Point a round later is worth of one now: a Control dial
  // goes on paying, but the other squad has a round to take the zone back.
  missionFuture: number;
  // The share of a zone's worth that is at risk when it is held by its dial
  // alone, with nobody inside it and an enemy unit near enough to walk in. A
  // unit standing in the zone keeps the dial whoever comes; a unit that has
  // walked off has left it to be taken.
  contest: number;
  // How much of what an enemy could do to a unit counts against standing
  // there: when that enemy's turn is still to come this round, and when it
  // comes only next round (by when the unit may have moved again).
  exposure: number;
  exposureLater: number;
  // A Commander on a VIP mission also counts what an enemy Mech that cannot
  // attack it there THIS round could do NEXT round, having walked up meanwhile:
  // this share of it. And that round is an exchange: this much of the best the
  // Commander could do to one of them, from where it stands, is taken off
  // first (`riposte`: at 0 nothing is, and it hides from any Mech that could
  // walk up; at 1 a Commander that outguns the one Mech coming stays).
  // MEASURED (plan section 12, a1 to h3): at 0 RDL's Commander turns timid (100
  // to 89 of 100 against the Brawler); at 1 UN's stands its ground and is
  // caught (84 to 75); at a half neither happens and UN gains ten in a hundred
  // against the eager policy.
  ahead: number;
  riposte: number;
  // What an attack it could make at its NEXT turn from where an answer leaves
  // it is worth of the same attack made now: for a Mech, a round away; for a
  // Drone moved by a Command, which fires in the same round's Automatic Phase.
  future: number;
  futureSoon: number;
  // A Projectile launched: its blast lands in the Delay Phase, on a target
  // that may have moved.
  launch: number;
  // An Electronic Attack: the chance it is won, as a share of what the target
  // could do with the Firing it would lose; and the share of a unit's worth
  // that stands for that when nothing says what it could do.
  jam: number;
  jamIdle: number;
  // An ENEMY that carries an Electronic Attack is worth what it would take
  // away: this share of what this squad's best gun does in a round, at the
  // chance of the Counter-roll (`jam`), counted as its "firepower" in what it
  // would go on to do (`threat`).
  jammer: number;
  // THE WALK TO A ZONE the Main Task scores that is not its squad's: this
  // share of what the zone would pay from the round the unit could be standing
  // in it (a zone two activations off pays two rounds less), a zone the other
  // squad's dial names counting twice, since taking it also ends what it
  // pays them. The share is less than one because the walk may not end as
  // planned. `zoneStep` is a little for each Grid, to choose between two
  // Grids that are the same number of activations away.
  zonePull: number;
  zoneStep: number;
  // A zone another unit of the squad would be standing in sooner could be left
  // to that unit: what is left of its worth to this one. At 1 (measured: the
  // best) nothing is shared out and every unit walks for the zone worth most
  // to it. And a zone an enemy unit stands in cannot be taken while it stands
  // there: what is left of its worth to walk to meanwhile.
  zoneShare: number;
  zoneHeld: number;
  // An enemy unit destroyed where it stands in a zone holds the zone no longer:
  // this share of what the Main Task would gain on the board without it, for
  // the chance the attack destroys it before the round ends.
  holder: number;
  // The walk to a fight, for each Grid still to go to its own Range of an
  // enemy: a flat amount (`contactStep`) and a share of what destroying that
  // enemy is worth (`approach`). With no share of the prize the enemy walked
  // to is the nearest; with one, it is the enemy worth most for the walk.
  contactStep: number;
  approach: number;
  // THE RANGE A UNIT FIGHTS AT (`blade`; OTTO, 2026-10-05: "melee squads still
  // hang back"): the walk to a fight ends at the reach of the unit's strongest
  // attacks, not its longest. Where its blades weigh `blade` times what its
  // guns do (each attack by its dice, a red die two yellow), it walks to its
  // blades; and a Tactic that hands an Ally a turn (Coordinate) is no reach on
  // an enemy. At 0 the walk ends at its longest reach, as it always did (a
  // Mech with two Slashes and a Burst Fire stood four Grids off and fired).
  // MEASURED (2026-10-05): RDL_Melee1 34 of 100 against the Ace's 37, with
  // `charge` 45 against its 47: stays 0.
  blade: number;
  // A MECH'S BLOW A STEP AWAY, A ROUND ON (`charge`, tactician.ts chargeNext):
  // where nothing could be attacked from the Grid a plan leaves it in, the
  // blow its Maneuver (or on a Movement dial its Sprint) would carry its blade
  // to, `charge` of what it is worth, as a turn a round on is (`future`). At 0
  // a blade counted only beside the enemy, and a melee Mech stood off.
  // ADOPTED at 1 (2026-10-05): RDL_Melee1 against the community squads 47 of
  // 100 against the Ace's 37 and 87 of 200 against 85, TopTierMelee 31 of 100
  // against 28, random squads 90 of 200 against 87 (193 the same game).
  charge: number;
  // THE LAST WALK (`lastWalk`, tactician.ts zoneWalk): a walk to a Task paid
  // as the game ends that would arrive in its last round pulls `lastWalk` of
  // the way from `zonePull` to the whole of what it pays. At 0, `zonePull`.
  // MEASURED (2026-10-05): every Black Box Task, fewer games 0 to 0 (57 to 46
  // of 200) and fewer won (98 against 107): stays 0.
  lastWalk: number;
  // A Remote Access: the chance its Counter-roll against the Terminal is won,
  // as a share of what the Terminal pays. MEASURED at 0.5 on Terminals:
  // Receive Signal (plan section 12, tm1b to tm3b): 345 of 400 against the
  // Brawler, where 0 (the zones alone, held as each round ends) wins 366. The
  // Tick it costs is an attack not made. 0 until it is priced by the roll's
  // own odds and by what the Tick would otherwise have done. ADOPTED at 1 with
  // `ewOdds` 1 (2026-10-04): the roll's odds read (`Option.win`), the access
  // is worth that chance of what a won roll pays, weighed against what else
  // the Tick could do; random squads on Terminals paired by seed 96 of 178
  // won against 77 (24 seeds turned to a win, 5 from one).
  access: number;
  // On a Black Box Task that pays for a Box only in one zone, a Box that is
  // not there yet, as a share of one that is: what a bearer still on its way
  // loses by a Penetration, and what the walk to fetch a Box lying loose is
  // worth of the walk that carries one home. The Task itself is priced as the
  // board stands (missionOf): a Box outside the zone pays nothing there.
  carry: number;
  // A Black Box pays once, as the game ends: what a Victory Point of that is
  // worth of one paid now, for each round still to play. And what a walk for a
  // Box (to fetch it, to carry it home) is worth for each activation it still
  // takes: a long walk is less sure than a short one, and nothing else tells
  // two Grids apart on a Task that pays the same whenever the walk is done.
  boxFuture: number;
  walkTurn: number;
  // A unit carrying a Box with a hand still free: whether the walk to fetch a
  // second one counts the Boxes it has (1: fetched on the way home, both pay)
  // or the new one alone (0). And what a Box lying loose is worth to a unit
  // when another of its squad would have it sooner: 1 is the whole of it to
  // every unit.
  boxMore: number;
  boxShare: number;
  // THE OTHER SQUAD'S BOXES (M11; OTTO, 2026-10-03: "if I saw someone go for
  // the box in an attempt to get an extra point to take the victory I would
  // plan accordingly to try to intercept and stop them or steal it myself").
  // Each loose Box is a race: the round each squad's soonest unit with a hand
  // free could take it (`races`). A walk for a Box the other squad would take
  // first is worth `boxRace` of itself (1: as before), level on the round half
  // way to that; one this unit would take first, which the other squad would
  // take otherwise, is worth `boxSteal` more of itself (0: as before), for the
  // Box it keeps from them. An attack on the enemy unit that would take a Box
  // first is worth `deny` of that Box for each it would stop by destroying the
  // unit (0: as before). ADOPTED at 0.5, 1 and 1 (2026-10-03, night): head to
  // head on Key Facility 112 games won of 200 against 84 lost (the mirror is
  // level; each alone 109/88, 100/95, 105/93), Asset Preservation 100 against
  // 92; random squads on Black Box Tasks paired by seed 145 of 299 against 136
  // (25 seeds turned to a win, 14 from one), the Victory Points margin -101 to
  // -29; and OTTO's table (Key Facility on the Alley, UN against RDL, both
  // racing): UN 15 of 20 against 9, its 4 to 4 losses on the Parts 6 to 0.
  boxRace: number;
  boxSteal: number;
  deny: number;
  // A Link restored with nothing better to do.
  restore: number;
  // Deploying a Commander: what each Grid of the other squad's Deployment
  // Zone that would see it costs. The units are not down yet; the lanes are.
  lane: number;
  // Acting one Timing sooner, on the dial: enough to choose between two plans
  // worth the same, and no more.
  tempo: number;
  // What a plan loses for starting on a Timing its dial only BORROWS (from an
  // ally's aura, on the board as it stands): the lender may not be there when
  // the Opportunity comes. MEASURED at 0.5: as RDL on the alley it gains four
  // games in a hundred against the eager policy and loses nine against the
  // Brawler (the Movement dial it sends a Sprint to acts after every Firing
  // dial). 0 until something better than a flat charge is found.
  borrowed: number;
  // What an enemy would go on to do is part of what destroying it is worth:
  // this share of its best attack on the squad as the board stands, for each
  // of up to `threatRounds` rounds it has left to make one in.
  threat: number;
  threatRounds: number;
  // What a plan must be better by before a unit leaves where it stands.
  better: number;
  // Two things switched for measuring. The dial: every Timing offered is asked
  // what it would open (1), or only those the Mech's own Actions are printed
  // with, and Melee and Movement (0). MEASURED: with every Timing asked, RDL on
  // the alley wins 89 of 100 against the Brawler where it wins 99 without (the
  // extra dials are the ones that open only borrowed Timings). And a zone
  // entered by a Maneuver and the Movement Action after it is planned as one
  // move (1: 92 of 100 against the eager policy, 88 without) or left to the
  // walk (0).
  dialAll: number;
  entry: number;
  // A Tactics Card is used once a game (FAQ P2): what playing one must gain
  // over keeping it, where what it would do is weighed (Hit and Run,
  // Additional Instructions, System Repair, Tactical Disposition; M8.2q).
  // UNMEASURED.
  card: number;
  // WHAT WINS THE GAME (M9.6): Victory Points for the game itself, on top of
  // the Victory Points it is won by, at how sure the margin the Main Task is
  // heading for is to hold (`stakesOf`); and the Victory Points of doubt in
  // that margin in the last round, four times as much for each round before
  // it. At 0 nothing is added. MEASURED and NOT ADOPTED with the doubt growing
  // as the square of the rounds left (plan, M9.6: early in the game it was
  // the Main Task weighed a quarter more, and turned one decision on one
  // board); the fourfold growth leaves it to the last rounds.
  stakes: number;
  stakesSpread: number;
  // A walk for the Main Task (to a zone, for a Box) priced with the game on
  // top of the Victory Points it would bring (`swingOf`), at 1; at 0 by the
  // Victory Points alone. The walk does not go through `missionOf`, so without
  // it `stakes` never reaches a walk that takes more than one activation.
  stakesWalk: number;
  // A FOCUS ON A DEFENCE (OTTO's playtest, 2026-10-03: a Link spent to reroll
  // a hit that could only have Damaged a Part with Structure left): the share
  // of what a Part Damaged costs (`damaged`) that counts when a defence asks
  // whether a reroll is worth a Link, the Part still working after it (1:
  // all of it, as every other question counts it). And what the Link costs
  // over `focus` when spending it leaves the Mech one Link from Shutdown,
  // in multiples of `focus` (0: no more than any other Link). ADOPTED at 0.5
  // and 2 (2026-10-03, night): the games the same (the copied games head to
  // head 99 of 200, the mirror 100; random squads paired 129 of 297 against
  // 130), the reroll OTTO saw gone (of 40 copied games' defence Focuses, those
  // that bought off a Damage alone 7 to 2, those leaving one Link 10 to 6).
  focusDamaged: number;
  focusLow: number;
  // A LOAD LENT (a Carrier, 162; OTTO's playtest, 2026-10-03): what standing in
  // Contact with an Ally Mech is worth to a Drone carrying a Load, as a share
  // of what the Load adds to that Mech's best deed at its next turn (the
  // engine's odds with the Drone beside it, against them without it). At 0 a
  // Load is no reason to stand anywhere. ADOPTED at 2 (2026-10-03, night):
  // against the Ace on the copied games 117 of 200 at 1 and at 2 (the mirror
  // 100), all of it UN on the Alley, 44 of 50 against 27 (20 seeds turned to a
  // win, 3 from one): the Carrier set down behind the Wild Cat lends it its
  // Cooler all game; the VIP board's results the same.
  lend: number;
  // AN ENEMY WITH A BETTER TARGET (OTTO's playtest, 2026-10-03: the Raven
  // backed away from a wall it could jam from): what an enemy could do to a
  // unit counts against standing there only as often as that unit is worth
  // shooting against the best other target of this squad the enemy has in its
  // sights, as (this unit's worth to it / the other's) to this power where the
  // other is worth more. At 0 every enemy in reach shoots this unit. ADOPTED
  // at 1 with `lend` 2 (2026-10-03, night): alone 99 of 200 head to head (the
  // mirror 100) and 138 of 300 random squads paired against 132; with `lend`
  // 118 of 200; with `lend` on random squads 140 of 300 against 132 (14 seeds
  // turned to a win, 6 from one).
  decoy: number;
  // THE HARPY'S TOW (ZHDR-304, M12): a Command Movement that drags an Ally
  // along is worth `tow` of what the Ally gains by where it is set down (its
  // best deed at its next turn, and its walk to the Main Task), less
  // `towToken` for the Command Token it spends; what the other squad could do
  // to the Ally there that it could not where it stands is charged in full.
  // At 0 a tow is never planned.
  tow: number;
  towToken: number;
  // FOCUS FIRE (M13): a blow that leaves an enemy's vital Part Damaged (a
  // Mech's Torso, a Drone's one Part), where a unit of this squad still to
  // come this round could then finish it, is worth `gang` of what that unit
  // would gain on destroying it (its chance of Penetrating the Damaged Part
  // over its chance as the enemy stands), at what destroying it is worth. At 0
  // nothing is asked.
  gang: number;
  // AN ENEMY'S MISSILE STILL TO BE LAUNCHED (M12): what standing somewhere
  // costs counts, for each enemy Mech that may still launch a Projectile this
  // round, what the Projectile could do to the unit from the Landing Point
  // nearest it, at `salvo` x `exposure` x `launch`. A Missile lands first and
  // attacks in the Delay Phase, so an enemy's turn never counted it as an
  // attack (a traced game: a Mech walked among two Razors already landed and
  // two more on their way, and was lost). At 0 nothing is asked.
  salvo: number;
  // HITS THAT ADD UP ON A MECH (M12): the chance a run of enemy attacks
  // destroys a Mech, its Torso followed from Intact to Damaged to Destroyed
  // as a Drone's one Part is, where each attack's own forecast reads the Mech
  // as it stands and so never destroys it alone; what the run destroys that no
  // one attack would is charged at `compound` x what the Mech is worth, and is
  // the plan's risk. At 0 each attack's chance is taken alone, as before.
  compound: number;
  // AN ENEMY WHOSE DIAL THIS ROUND CANNOT TOUCH A UNIT (shown, on a Timing with
  // no attack on it) costs what it could do a round on, as an enemy whose turn
  // is behind it does, at `later` x `exposureLater`. At 0 such an enemy costs
  // nothing.
  later: number;
  // AN ENEMY THAT WALKS UP BESIDE IT (`walkUp`; OTTO, 2026-10-08: "yes go ahead
  // and build and test it"): an enemy whose attack on a unit this round comes by
  // a step that ends beside it (its Maneuver, or its Sprint on a Movement dial)
  // stands there as the next round begins, and may strike first then: its blows
  // then follow this round's on the same unit, and what they would finish is
  // priced at what the unit is worth, at `walkUp` x `exposureLater`. On the
  // Alley the Mire Sprinted into G6, the Wild Cat Sprinted beside it and shot it
  // (94% to Penetrate, none to destroy), and on a Melee dial finished it the
  // round after; the read had priced the one activation. (Counting the blow
  // again at its own value, 2.21, turned not one of 150 games.) At 0 nothing
  // more is counted.
  walkUp: number;
  // THE LAST MECH OF A SQUAD WITH DRONES is worth `keystone` of the Drones'
  // worth besides its own (`keystoneOf`). At 0 it is worth its own.
  keystone: number;
  // THE TIEBREAK: each Part or Drone destroyed is worth `tiebreak` Victory
  // Points x the chance the game ends level on them (`tieWorth`), read with a
  // doubt of `tieSpread` per round left. At 0 a Part is worth its points alone.
  tiebreak: number;
  tieSpread: number;
  tieCount: number;
  // THE LAST ROUND'S POINTS (`horizon`; 2026-10-05, the Black Box games that
  // end 0 to 0): a unit's points stand for what it will go on to do, and in
  // the last round there is no round to go on to. There a unit's points count
  // `1 - horizon` of their worth (`unitWorth`); what a Part does to the
  // tiebreak, what a unit still to act would do this round, a zone it holds
  // and the Boxes it carries are priced besides. In random game 96032 a Mech
  // with a Box two Grids from Echo in the last round set its dial to fire a
  // Full-auto worth 5.15 rather than carry in the 4 Victory Points that won
  // the game, and the game was lost on Parts. At 0, as in any round.
  horizon: number;
  // THE ODDS OF AN ELECTRONIC COUNTER-ROLL (M12): an Electronic Attack and a
  // Remote Access are weighed at the chance their Counter-roll is won
  // (`Option.win`, ai/odds.ts counterChance), `jam` read as what a won roll is
  // worth at even odds and `access` as a share of what a won one pays. At 0
  // each is weighed as before, at a chance it never read (a Remote Access, 0 of
  // 95 offers taken in the night's census). ADOPTED at 1 with `access` 1
  // (2026-10-04): in the factorial alone, on a jam, +2.3 points of win rate
  // (z 1.4); with the access, the Terminals result above.
  ewOdds: number;
  // AN ESCORT (M13): on a VIP mission, a plan that moves a unit within three
  // Grids of its squad's Commander is charged `escort` of what it leaves the
  // Commander more open to, and credited what it spares it by standing in the
  // way (`escortOf`). At 0 a unit's own Grid is all it weighs.
  escort: number;
  // A HIGHLIGHT PUT ON A UNIT OF THIS SQUAD (M12, the census's Target Tag 0 of
  // 59 and Amplify Profile 0 of 16): an enemy's Firing Action that can target
  // it must (6.2.1), so it draws the fire of every enemy that has it in its
  // sights. Planned at `taunt` of what that spares the rest of the squad, less
  // what it costs the unit Highlighted (`tauntOf`). At 0 it is never planned.
  taunt: number;
  // AN ATTACK WHOSE HIT JAMS (M12, the census's Laser Suppression 0 of 54: "[On
  // Hit] the target gains 1 Fire Control Interference Token; no damage"): worth
  // `suppress` x what a jam is worth (`jam`, at even odds, as an Electronic
  // Attack's) x the chance of a Hit. At 0 such an attack is worth its damage,
  // which is none.
  suppress: number;
  // A CARRIER OF THE OTHER SQUAD'S (M11): a unit with an arm and no Box of its
  // own walks to where its arm reaches an enemy carrying Black Boxes, as it
  // walks to a zone, for `hunt` of the Boxes carried (`targetsOf`); and on a
  // VIP mission every unit but the Commander to where its arm reaches the
  // other squad's Commander, for `hunt` of the kill's price (`vipKill`). At 0 a
  // Box is walked for only while it lies loose, and on a VIP mission nothing.
  hunt: number;
  // Such a walk is a chase: each activation it still takes keeps `huntTurn` of
  // its worth (a carrier walks on).
  huntTurn: number;
  // A FOCUS IN AN ELECTRONIC COUNTER-ROLL (a trace, 2026-10-04: never taken,
  // the window's safe answer every time): declared where rerolling the dice
  // that count nothing for this side would turn a lost roll into a won one at
  // least 0.25 / `ewFocus` of the time, paid in Link (never the last but one)
  // or a Whistle's Command Token, and the reroll then made of those dice alone
  // (`counterFocus`). At 0 the window's safe answers stand. ADOPTED at 1
  // (2026-10-04): on Terminals 141 of 300 against 139, the two games it
  // changed both turned to a win: rare, and what a player does.
  ewFocus: number;
  // WHERE A BLACK BOX IS PUT DOWN AT SETUP (5.2.1): above 0, the Box and Grid of
  // its zone furthest from the other squad's Deployment Zone for how near it is
  // to this squad's (`placeBox`). At 0 each Box is left where it stands.
  boxPlace: number;
  // A PROJECTILE THAT STRIKES IN THE DELAY PHASE, AT AN ENEMY STILL TO MOVE this
  // round: worth less by `launchMove` of the chance it walks out of the strike
  // (the reach the strike has to spare against the walk it could make,
  // `launch`). At 0 the target is read where it stands.
  launchMove: number;
  // OUTRANGED (M12's squad read, the narrow form): a unit with nothing to walk
  // to for the Main Task, that an enemy able to reach it where it stands
  // outreaches by more than a Grid, counts its step toward contact
  // (`contactStep`) `closeIn` times over besides (`shapeAt`; a traced VIP game
  // where an outranged squad held its back line five rounds and was shot). At 0
  // the step counts once. (`approach`, a pull toward every enemy by its worth,
  // was measured and rejected in M7: it took RDL off the zones.)
  closeIn: number;
  // A LAUNCH THAT OWES INTERCEPTION: worth the chance the Projectile comes
  // through every attempt (`Option.survive`, each interceptor trying while it
  // has Tokens left), to the power `interceptOdds`. At 0 any Interception
  // owed is the flat `launch` discount, and for a Missile none at all.
  interceptOdds: number;
  // BEHIND AS THE BOARD STANDS (`behindNow`): a squad that would lose the game
  // if it ended now gains nothing by holding back, and each of its units with
  // nothing to walk to for the Main Task counts its step toward contact
  // (`contactStep`) `press` times over besides; at `pressLate` 1 the more so
  // the later the round (a fifth of it in the first of five, all of it in the
  // last), at 0 alike in every round. (A traced VIP game on the Intersection,
  // the Ace on both sides: both squads stood still from the second round, and
  // the one with fewer Mech Parts and Drones lost it 0 to 0 on them.) At 0 the
  // step counts once. ADOPTED at 10 (2026-10-04): random VIP squads 147 of 300
  // against 147, every Main Task 96 of 200 against 94, and on that VIP game UN
  // won 3 of 50 where it won none; `pressLate` 1 measured 145 and stays 0.
  press: number;
  pressLate: number;
  // THE TIEBREAK AS IT IS GOING (`erode`, for `press`): level on Victory
  // Points, each squad's Mech Parts and Drones as they would stand at the end,
  // each unit with an enemy within its arm and its stride taking `erode` of
  // one from the other squad in each round still to play. A squad ahead on the
  // Parts that the other outguns from where both stand is losing them, and is
  // behind. (A traced VIP game, community squads: RDL_Melee1's four melee
  // Mechs, ahead 20 Parts to 15, stood in their zone for three rounds under
  // UN's guns and lost 0 to 0 on the Parts left.) At 0 the standing is read as
  // it is.
  erode: number;
  // A DIAL FOR HOLDING: where the plan worth most on any Timing Dial holds and
  // does nothing, the Timings whose plans hold too are told apart by the
  // weapons each keeps: one of the Mech's own ready guns or blades played on
  // it is kept for an enemy that walks into its Range before the Opportunity
  // comes, `cover` for each enemy that could this round. A plan that does
  // something is never outweighed by it. At 0 such a tie goes to the earliest
  // Timing (`tempo`), and a railgun Mech holding a line set Melee round after
  // round (the standoff on the Intersection).
  cover: number;
  // WHAT A PLAN THAT ACTS NOW COULD STILL DO A TURN LATER: a plan with a deed
  // this activation counts `nextAfter` of what it could do at its next turn from
  // where it ends (`nextTurn`), as a plan with nothing to do now counts all of
  // it. At 0 a plan that acts now counts nothing a turn later, and a Mech with a
  // Rail Gun shot to make Maneuvered instead toward a better one a turn on (a
  // random Asset Preservation game read, seed 48056: the shot now 1.20 against
  // the walk's 1.24 a turn later), as if firing now gave that up. ADOPTED at 1
  // (2026-10-04): random squads on every Main Task 156 of 300 against 146 (23
  // turned to a win, 12 from one; sign test p 0.09), at 0.5 152; head to head
  // on the copied games 100 of 200; about 6% more time a game.
  nextAfter: number;
  // A DIAL SET FOR AN ATTACK ON A MECH THAT MAY ACT FIRST: a Timing Dial is set
  // on the board as it stands, and a target Mech whose own Timing comes sooner
  // may walk out of the attack before this one's Opportunity (a census of 40
  // random games: 13 of 45 dials set for an attack found it gone, and 9 of
  // those Mechs walked instead). The attack is worth less to the dial by
  // `dialDoubt` x the share of the Timings that come before its own. At 0 a
  // dial takes the attack as certain.
  dialDoubt: number;
  // THE UNIT AS A PLAN LEAVES IT (1 on, 0 off): what standing somewhere costs
  // a plan that changes the unit itself (a Mode, a Stance, a Token, a Bit's
  // face) is read with the unit as that plan's table has it, its guns and its
  // Parts with it. At 0 it is read with the unit as it stands: a VIP
  // Commander's White Dwarf priced its Cruise Mode at 0.00 from Assault Mode
  // (what it could do back came from its Assault guns) and at 1.23 once in it,
  // and changed Mode twice in one activation to end where it began (random game
  // 51001).
  reshape: number;
  // A DRONE LAUNCHED TO MEND AN ALLY: the SU1 a Nest Guardian Swarm puts down
  // mends nothing as it lands, and was launched by nobody (a census of 21
  // random games with one aboard: never), since a launch was worth only what
  // the Projectile's own turn would do to an enemy. Its Landing Point is worth
  // `patch` x `future` x the Damaged Part it could mend a round on, given a
  // Command, of the ally worth most to mend within the Action's Range of there
  // (a Command buys the Action or a Movement, not both). At 0 it is worth
  // nothing. ADOPTED at 1 (2026-10-04, night): GoF squads with the pack against
  // the Ace 109 of 199 against 102 (11 turned to a win, 4 from one; p 0.12),
  // the Swarm launched 82 times and its Armor Patch made at all 53 of its
  // chances.
  patch: number;
  // A DRONE LAUNCHED TO CALL IN A SHOT: the KK9 Snake Eyes a Cobra core puts
  // down strikes nothing itself, and was launched by nobody (the community
  // squads' census: 60 offers, never). Given a Command, or handed one at once,
  // its Overwatch Strike has an Ally Mech fire on an enemy within its Range.
  // Its Landing Point is worth `spotter` x `future` x the best Firing Action a
  // Mech of the squad could make from where it stands at an enemy within that
  // Range of there. At 0 it is worth nothing. ADOPTED at 1 (2026-10-04,
  // night): UN squads whose first UN Mech carries the Cobra core against the
  // Ace 100 of 200 against 97 (12 turned to a win, 9 from one; p 0.66): level,
  // and the KK9 is used where it never was (launched 176 times of 643 offers,
  // its Strike called at all 71 of its chances).
  spotter: number;
  // SMOKE FOR THE SQUAD (`smokeSquad`; OTTO, 2026-10-05: "Would a unit smoke out
  // an open area so that they or a friendly unit can move safely through it?",
  // and "more choices based on squad tactics rather than the unit thinking
  // mostly about itself"): each enemy that would no longer see an Ally Unit
  // behind the Screens a Smoke card puts down is worth this. The unit throwing
  // it is priced as ever, on the table the Screens leave (`exposure`).
  smokeAlly: number;
  // A CONTAINER OVER A LOOSE BLACK BOX (`breakIn`, the Tactician's skill): what
  // breaking it open is worth, as a share of what the Box in it pays.
  breakIn: number;
  // A DRONE PUT DOWN THAT JAMS EVERY ROUND (A6, 2026-10-05: the AMDS210
  // Delphinium was deployed 0 times in 11 offers): a Deploying Projectile whose
  // unit's own turn is an Electronic Attack (the Delphinium's Fire Control
  // Interference on the nearest enemy) is worth this x the best jam it is
  // offered from the Landing Point (priced as `jam` prices one), for this round
  // and each round left at `future` of the one before. At 0 worth nothing.
  // ADOPTED at 1 (2026-10-05, late night): both squads with the Carrier, the
  // Ace against itself, 96 of 200 against 89 (19 turned to a win, 8 from one,
  // p .05), trading a little better; deployed 100 times in 236 offers (never
  // before), its jam made every time it was offered.
  sentry: number;
  // A UNIT PUT DOWN TO SERVE THE SQUAD (A6, 2026-10-05: the CP-3 Beacon
  // Backpack's B3 Beacons were deployed 0 times in 19 offers): a Deploying
  // Projectile whose unit's own turn is a Support Action (the B3/1 Link
  // Beacon's Link Support: each Ally Mech within 3 recovers 1 Link) is worth
  // this x what that Support is worth made now (`support`). At 0 worth nothing.
  // ADOPTED at 1 (2026-10-06): both squads with the CP-3, the Ace against
  // itself, 115 of 200 against 113 (2 turned to a win, none from one), trading a
  // little better; a Beacon thrown at 30 of 192 offers, where it never was.
  beacon: number;
  // A MINE PUT DOWN BY AN ACTION (A6, 2026-10-05: the GLP-15's Mine, 006_B, laid
  // 0 times in 21 offers; OTTO: "More focus on using mines, missiles, or
  // beacons"): where the walk would lay one (`lay`: an enemy Ground unit nearer
  // the Grid than any unit of this squad, none of this squad in it), worth this
  // x a Part Damaged on that enemy, over one more than the Grids between them.
  // At 0 worth nothing.
  mineLay: number;
  // A JAMMER IS WORTH ITS JAMS TO COME (2026-10-06; the W5 census: the computer's
  // Drones jammed in sight of two or more enemies three times in four, where a
  // player keeps a jammer behind a wall, a jam needing no sight). A Drone whose
  // own Action is an Electronic Attack on an enemy counts its material worth
  // 1 + `jamKeep` x the rounds left (this one too) over: to the squad that would
  // lose it, so it stands where fewer enemies could reach it, and to the one that
  // could destroy it. At 0 a Drone is worth its points alone.
  jamKeep: number;
  // A BEACON THAT GIVES THE SQUAD LOW PROFILE (A6, 2026-10-05: the Type 55
  // Shield's MES Beacon Launcher, 064_A Decoy, launched 0 times in 17 offers;
  // OTTO: "More focus on using mines, missiles, or beacons"): a Landing Point
  // is worth this x what standing where they stand would cost the units of the
  // squad its Aura covers, less on the table the launch leaves (`veil`, as
  // `taunt` reads a Highlight). At 0 worth nothing. ADOPTED at 1 (2026-10-06):
  // both squads RDL with the Launcher, the Ace against itself, 105 of 200
  // against 104, trading alike; the Beacon launched 140 of 539 offers where it
  // never was; about 8% more thought in those games, none in any other. THEN
  // RETURNED TO 0 the same day: on the melee test bed RDL_Melee1b, the one
  // squad carrying the Launcher, won 11 of 24 with it against 16 without (6
  // turned to a loss, 1 to a win; every other squad the same games).
  veil: number;
  // THE PACK (2026-10-06; OTTO: "Melee is having a hard time under both main AI"): a unit whose blades
  // outweigh its guns, walking into the reach of enemy guns, shares what standing there costs with each other
  // such unit of the squad that could strike one of those enemies this round (beside it already, or with its
  // turn still to come and that enemy within its blade's carry): the cost over 1 + `pack` x their number. Blades
  // that go in alone are shot apart one by one (RDL_Melee1, the community squads); blades that go in together
  // share the fire. At 0 every unit pays alone.
  pack: number;
  // THE PACK ALREADY IN (`packNear`): the same sharing, counting only the other bladed Mechs standing beside
  // one of those enemies already (engaged), whatever their turn: the first blade in pays alone, and those that
  // follow it in share. Read beside `pack` (2026-10-06, game 130102: two blades that COULD have struck spent
  // their turns on the Terminals instead, and the one that went in on the strength of them was lost). At 0
  // nobody counts.
  packNear: number;
  // MELEE LOCK AS A SCREEN (2026-10-06; OTTO: "are melee units thinking about melee lock? It would make sense
  // for melee mechs to get in units face ... so they can stop enemies without melee firing while they do
  // work"): a Ground enemy beside the Grid a unit that locks ends in makes no Firing attack but with a weapon
  // printing Melee Firing (4.3.5), unless it Breaks Away: a Maneuver is no Action, and leaving its Grid costs 1
  // Movement Range more a locker, so it is held only while its Maneuver is short of 1 + the lockers. For each such
  // enemy that this unit's lock is the one to hold (held with it, not without), the best shot it could make at a
  // unit of the squad OTHER than this one (what it would do to this one is the plan's own price), this round while
  // its turn is still to come and the next at `future` (a blade that Sprints in after the gunner has fired holds it
  // for the round after, and a Melee dial strikes before a Firing one), is worth `lockDeny` of itself. At 0 nothing.
  lockDeny: number;
  // A HIGHLIGHT PUT ON AN ENEMY (2026-10-06; the community kit census: the LD-5M Vigilant MG's Target Tag,
  // PRDR-202_A, chosen 0 times in 36 offers). A Firing Action that can target a Highlighted unit must target it
  // (6.2.1; FAQ J18): the squad's Automatic Drones, which take the nearest enemy, take the tagged one instead, and a
  // Highlight cancels a Low Profile given by an effect (J12). For each unit of this squad with a gun and its turn
  // still to come this round, its best Firing attack on the table the Highlight leaves less its best as the board
  // stands (a loss where the tag drags it off a better target), worth `targetTag` of the sum. At 0 nothing.
  targetTag: number;
  // AN OUTRANGED BLADE GOES IN (2026-10-06, the melee plan; game 130207: four Swift Steed blades walked to the
  // Terminal zone, each plan worth the zone's 7.42, and stood there to be shot by Rail Guns seven Grids off; all
  // three counted were destroyed without one Melee attack). `closeIn` and `press` count the step toward contact
  // only for a unit with no zone to walk to, and a blade's only harm is in contact. For a Mech whose blades
  // outweigh its guns (`bladed`), while an enemy that can reach it outranges it (`outranged`), each Grid of the
  // road to the enemy it walks to, beyond its blades' reach, costs `bladeIn`, zone or no zone. At 0 nothing.
  bladeIn: number;
  // A VOLLEY'S LATER PROJECTILES (2026-10-07; OTTO: "look into why the Quad Missile Rack never fires": the ML-34
  // Quad Missile Rack's Missile, 004_A, launched 0 times in 67 offers in the community kit census). A Projectile
  // Action with Volley X launches up to X Projectiles, one question at a time; a launch was priced as its one
  // Projectile, so the Rack's Volley 2 tied with the Dual Launcher beside it on the same Mech (the same MC-3
  // "Razor" Missile, Volley 1), and the first answer listed won every tie. With it, where the whole of what an
  // activation does is worked out (the question asked now, and the few plans that lead), a launch is worth its
  // Projectile and `volleyLaunch` of what the Volley's next launch would be worth on the table it leaves (each
  // later one counted the same way). At 0 nothing. MEASURED (2026-10-07): at 1, level (random squads 95 of 200
  // against 90, the melee bed 87 of 168 against 94: counted whole, every Volley launch outweighs the gun or the step
  // beside it more than it did); ADOPTED AT 0.05, A TIE-BREAK (random squads 91 against 90, 199 of 200 the very same
  // games; the melee bed 94 against 94, 164 of 168 the same; the Rack fired at 28 of 109 offers, against 0 of 67).
  volleyLaunch: number;
  // THE SQUAD'S DIALS CHOSEN TOGETHER (the skill `squadDials`, M18 S3): how much the round projected must gain before
  // a Mech's dial is changed from the one it would set alone. Read only with the skill.
  squadMargin: number;
  // THE LEARNED JUDGE (M17 L3): what a plan is worth for the position its walk leaves, as trees trained on finished
  // games read the squad's chance to win there (learned.ts `judge`), against the position now: `learned` x the change
  // in that chance. At 0, or with no model set, nothing.
  learned: number;
  // HIDDEN, AS AN ASSET (2026-10-08; OTTO: "put in some usage settings for a camo team"): a unit in Optical
  // Camouflage must be Scanned before it can be attacked for as long as it stays hidden, not only this round, which is
  // all that what standing somewhere costs prices. A plan that gives the camouflage up (an Action or a Maneuver
  // without Silence, a Movement ending in Contact) pays `hiddenWorth` for each round after this one; a plan that puts
  // it back on (the Activation) earns as much; a Remote Access at a Terminal pays nothing (the Main Task first). At 0
  // nothing. MEASURED without that last clause (OTTO's camouflage squads, 120 games paired): at 0.5, 52 against 55; at
  // 1.5, 44 against 55 (p 0.03), the squads hidden at 90% of the rounds they began against 76% and trading 1.38 against
  // 1.21, but making 13 Remote Accesses against 33.
  hiddenWorth: number;
}

export const TACTICIAN: Weights = {
  material: 0.03,
  damaged: 0.5,
  link: 0.15,
  focus: 0.3,
  vipKill: 1,
  vipOwn: 1.5,
  vipPart: 0.5,
  missionFuture: 0.85,
  contest: 0,
  exposure: 0.8,
  exposureLater: 0.35,
  ahead: 0.35,
  riposte: 0.5,
  future: 0.45,
  futureSoon: 0.9,
  launch: 0.8,
  jam: 0.5,
  jamIdle: 0.25,
  jammer: 0,
  zonePull: 0.6,
  zoneStep: 0.02,
  zoneShare: 1,
  zoneHeld: 0.5,
  holder: 0.75,
  contactStep: 0.04,
  approach: 0,
  blade: 0,
  charge: 1,
  lastWalk: 0,
  access: 1,
  carry: 0.5,
  boxFuture: 0.85,
  walkTurn: 1,
  boxMore: 0,
  boxShare: 1,
  boxRace: 0.5,
  boxSteal: 1,
  deny: 1,
  restore: 0.1,
  lane: 0.15,
  tempo: 0.01,
  borrowed: 0,
  threat: 0.5,
  threatRounds: 2,
  better: 0.01,
  dialAll: 0,
  entry: 1,
  card: 0.3,
  stakes: 0,
  stakesSpread: 1,
  stakesWalk: 0,
  focusDamaged: 0.5,
  focusLow: 2,
  lend: 2,
  decoy: 1,
  tow: 0,
  towToken: 0.25,
  gang: 0,
  salvo: 0,
  compound: 0,
  later: 0,
  walkUp: 0,
  keystone: 0,
  tiebreak: 0,
  tieSpread: 1,
  tieCount: 3,
  horizon: 0,
  ewOdds: 1,
  escort: 0,
  taunt: 0,
  suppress: 0,
  hunt: 0,
  huntTurn: 0.5,
  ewFocus: 1,
  boxPlace: 0,
  launchMove: 0,
  closeIn: 0,
  interceptOdds: 0,
  press: 10,
  pressLate: 0,
  erode: 0,
  cover: 0,
  nextAfter: 1,
  dialDoubt: 0,
  reshape: 0,
  patch: 1,
  spotter: 1,
  smokeAlly: 0.15,
  breakIn: 0.5,
  sentry: 1,
  beacon: 1,
  mineLay: 0,
  jamKeep: 0,
  veil: 0,
  pack: 0,
  packNear: 0,
  lockDeny: 0,
  targetTag: 0,
  bladeIn: 0,
  volleyLaunch: 0.05,
  squadMargin: 0.5,
  learned: 0,
  hiddenWorth: 0,
};

// The share of a Part still standing: a Damaged Part works, and is half way
// to gone.
const standingShare = (state: string, w: Weights): number => (state === 'destroyed' ? 0 : state === 'damaged' ? 1 - w.damaged : 1);

// WHAT A UNIT'S LOSS COSTS ITS SQUAD, in Victory Points: the points still
// standing in it, and on a VIP mission the Commander's own price.
export function unitWorth(u: UnitView, view: SeatView, w: Weights): number {
  if (!u.alive) return 0;
  const listed = u.parts.reduce((n, p) => n + p.points, 0);
  const standing = u.parts.reduce((n, p) => n + p.points * standingShare(p.state, w), 0);
  // What its Parts do not account for (a pilot) stands while it does.
  const material = w.material * lastPoints(view, w) * (standing + Math.max(0, u.points - listed));
  const task = view.task;
  const lead = task?.family === 'vip' && u.commander ? task.vp * (u.side === view.seat ? w.vipOwn : w.vipKill) : 0;
  // A jammer counts the jams it has still to make (`jamKeep`).
  const keep = w.jamKeep > 0 && jammer(u) ? 1 + w.jamKeep * Math.max(1, view.roundLimit - view.round + 1) : 1;
  return material * keep + lead + keystoneOf(u, view, w);
}

// A Drone whose own Action is an Electronic Attack on an enemy (`jamKeep`): a
// Tactic made at a Range, not one that serves its own squad or hands an Ally a
// turn.
const jammer = (u: UnitView): boolean => u.kind === 'drone'
  && u.weapons.some((x) => x.usable && x.type === 'Tactic' && x.range > 0 && !x.own && !x.grants);

// THE SQUAD'S LAST MECH (`keystone`, M12). A Drone acts on a Command, and a
// Command comes from a Mech of its squad (4.15): with the last Mech gone the
// Drones stand idle but for what they do of themselves. So the last Mech of a
// squad that still has Drones is worth `keystone` of their worth besides its
// own, to its squad and to whoever destroys it. (Two games read by eye: a
// squad of one Mech and four Drones walked its Mech into a zone among Missiles
// at a cost a Mech of a two-Mech squad might pay.)
function keystoneOf(u: UnitView, view: SeatView, w: Weights): number {
  if (w.keystone <= 0 || u.kind !== 'mech') return 0;
  const squad = view.units.filter((x) => x.side === u.side && x.uid !== u.uid && x.alive && x.deployed);
  if (squad.some((x) => x.kind === 'mech')) return 0;
  return w.keystone * w.material * lastPoints(view, w) * squad.filter((x) => x.kind === 'drone' && !x.lowValue).reduce((n, x) => n + x.points, 0);
}

// The share of its worth a unit's points count for in this round (`horizon`).
const lastPoints = (view: SeatView, w: Weights): number => (w.horizon > 0 && view.round >= view.roundLimit ? 1 - w.horizon : 1);

// What one more Part of a Mech destroyed costs its squad. A Mech left with
// two Parts leaves the board (Integrity Loss), so a Part is not a fifth of the
// Mech: it is one of the few it can lose before it is lost whole, and is
// priced as that share of it. On a VIP mission a Commander's Part also pays at
// the round limit.
function partWorth(u: UnitView, view: SeatView, w: Weights, more: number): number {
  const live = u.parts.filter((p) => p.state !== 'destroyed').length;
  if (!live) return 0;
  const task = view.task;
  return (unitWorth(u, view, w) + more) / Math.max(1, live - 2) + (task?.family === 'vip' && u.commander ? task.perPart * w.vipPart : 0);
}

// WHAT AN ATTACK IS WORTH TO WHOEVER MAKES IT, by its odds: the target
// destroyed, a Part of it destroyed short of that, a Part Damaged, Link
// stripped. Whose attack it is does not matter: an enemy's attack on one of
// this squad's units is worth to the enemy what it costs this squad, which is
// how standing somewhere is priced. `more` is what the target is worth to
// whoever destroys it beyond what it costs its squad to lose: what it would
// have gone on to do.
export function gainOf(f: Forecast, target: UnitView, view: SeatView, w: Weights, more = 0): number {
  const whole = unitWorth(target, view, w) + more;
  // What each Part or Drone is worth in the tiebreak (`tiebreak`).
  const tie = w.tiebreak > 0 && !target.lowValue && target.kind !== 'projectile' ? tieWorth(view, w) : 0;
  if (target.kind !== 'mech') return f.kill * (whole + tie) + f.damage * w.damaged * whole;
  const part = partWorth(target, view, w, more);
  // A destroyed Torso is a kill and a destroyed Part both: counted once.
  const short = Math.max(0, f.destroy - f.kill);
  // A Mech destroyed takes every Part it still stands on out of the count.
  const live = tie ? target.parts.filter((x) => x.state !== 'destroyed').length : 0;
  return f.kill * (whole + tie * live) + short * (part + tie) + f.damage * w.damaged * part + f.link * w.link;
}

// THE TIEBREAK (`tiebreak`, M12). Level on Victory Points, the game goes to
// the side with more Mech Parts not destroyed and Drones on the board (5.2.4,
// `standingFor`), and so do half the Black Box games and half the VIP games the
// computer plays (1,144 of 3,988 random games read: Black Box 48%, VIP 54%,
// Occupation and Terminals 8%). There each Part and each Drone counts one,
// whatever its points: a Drone of 30 points is worth a Mech's Arm. So while
// the margin the Main Task is heading for is near level, each one destroyed
// is worth `tiebreak` x the chance the game ends level, read off that margin
// with a doubt of `tieSpread` Victory Points for the last round and as much
// again for each round before it; and x how close the count itself is, read
// off the Parts and Drones each side has standing with a doubt of `tieCount`
// for the last round and as much again for each round before it (a side five
// ahead on the count gains little by a sixth). Worked out once a table.
// (Kept by the view and the two doubts it is read with: one table may be read
// with two weight lists, as a test or a tuner does.)
const LEVEL = new WeakMap<SeatView, Map<string, number>>();
export function tieWorth(view: SeatView, w: Weights): number {
  let byDoubt = LEVEL.get(view);
  if (!byDoubt) { byDoubt = new Map(); LEVEL.set(view, byDoubt); }
  const doubt = `${w.tieSpread}|${w.tieCount}`;
  let level = byDoubt.get(doubt);
  if (level === undefined) {
    const left = 1 + Math.max(0, view.roundLimit - view.round);
    const margin = marginOf(view, w);
    const spread = w.tieSpread * left;
    const count = standingFor(view, view.seat) - standingFor(view, view.other);
    const close = w.tieCount * left;
    level = Math.exp(-(margin * margin) / (2 * spread * spread)) * Math.exp(-(count * count) / (2 * close * close));
    byDoubt.set(doubt, level);
  }
  return w.tiebreak * level;
}

// WHAT THE MAIN TASK IS WORTH AS THE BOARD STANDS, to the seat whose view it
// is: the Victory Points banked, its own less the other squad's, and what the
// Task will go on to pay if nothing moved. For an Occupation that is each
// zone whose Control dial would name a squad when the round ended (whoever
// holds it now, or failing anyone the squad the dial already names), paid
// this round if this round pays and every round after, each round further off
// counting for less. And what the game is worth on top (`stakesOf`).
export function missionOf(view: SeatView, w: Weights): number {
  const margin = marginOf(view, w);
  return margin + stakesOf(view, w, margin);
}

// WHETHER THE GAME WOULD BE LOST IF IT ENDED NOW (`press`): on the margin the
// Main Task is heading for, or level on it (within half a Victory Point) on the
// Mech Parts and Drones each squad has left (5.2.4, as tasks.ts gameResult
// decides it). Level on both is a draw, not a loss.
export function behindNow(view: SeatView, w: Weights, drift = 0): boolean {
  const margin = marginOf(view, w);
  if (Math.abs(margin) >= 0.5) return margin < 0;
  // (`drift`: how the Parts would go between now and the end, `erode`.)
  return standingFor(view, view.seat) + drift < standingFor(view, view.other);
}

// What a side has standing for the tiebreak (5.2.4): its Mech Parts not
// destroyed and its Drones, on the board, Low Value units left out (as
// tasks.ts gameResult counts them).
export function standingFor(view: SeatView, side: SeatView['seat']): number {
  let n = 0;
  for (const u of view.units) {
    if (u.side !== side || !u.alive || !u.deployed || u.lowValue) continue;
    n += u.kind === 'mech' ? u.parts.filter((p) => p.state !== 'destroyed').length : u.kind === 'drone' ? 1 : 0;
  }
  return n;
}

// WHAT WINS THE GAME (M9.6; plan section 0, open item 9). Victory Points decide
// it, and level on them the Mech Parts and Drones left on the board (5.2.4).
// The rest of this price list is in Victory Points, so to it a Box is four
// whether the game is level or lost by twenty; but to a squad that would lose
// a level game on its Parts, the Box that ends it 4 to 0 is the game. So the
// game itself is worth `stakes` Victory Points (and losing it as much against),
// at how sure the margin the Main Task is heading for is to hold: the tanh of
// that margin, put half a Victory Point toward whoever would win a level game,
// over the doubt there is in it (`stakesSpread` for the last round, and four
// times as much for each round to play before it).
export function stakesOf(view: SeatView, w: Weights, margin: number): number {
  if (!w.stakes) return 0;
  const tie = Math.sign(standingFor(view, view.seat) - standingFor(view, view.other));
  const doubt = w.stakesSpread * 4 ** Math.max(0, view.roundLimit - view.round);
  return w.stakes * Math.tanh((margin + tie / 2) / doubt);
}

// What a gain of `gain` Victory Points on the margin the Main Task is heading
// for is worth with the game on top of it: the gain, and what it does to the
// game's stakes. Exactly the gain while `stakes` is 0.
export function swingOf(view: SeatView, w: Weights, margin: number, gain: number): number {
  return w.stakes ? gain + stakesOf(view, w, margin + gain) - stakesOf(view, w, margin) : gain;
}

// The Main Task's worth in Victory Points alone (`missionOf` before the game's).
export function marginOf(view: SeatView, w: Weights): number {
  const banked = view.vp[view.seat] - view.vp[view.other];
  const task = view.task;
  if (task?.family === 'terminal') return banked + task.vp * terminalLead(view, w, task.fromRound);
  if (task?.family === 'blackbox') {
    let lead = 0;
    for (const u of view.units) lead += (u.side === view.seat ? 1 : -1) * boxesOf(u, view);
    return banked + task.vp * lead * endsIn(view, w);
  }
  if (!task || task.family !== 'control') return banked;
  if (task.cadence !== 'per-round') {
    return banked + task.vp * zoneLead(view, w) * (view.round >= view.roundLimit ? 1 : w.missionFuture ** (view.roundLimit - view.round));
  }
  let rounds = 0;
  for (let r = Math.max(view.round, task.fromRound); r <= view.roundLimit; r++) rounds += w.missionFuture ** (r - view.round);
  return banked + task.vp * zoneLead(view, w) * rounds;
}

// A Main Task that is scored by standing in the zones it names: an Occupation,
// and Terminals (whoever holds a Terminal's zone as the round ends accesses it).
export const zoned = (view: SeatView): boolean => view.task?.family === 'control' || view.task?.family === 'terminal';

// TERMINALS, to the seat whose view it is, in rounds of pay. A Terminal pays
// whoever has accessed it as the round ends: by Remote Access already, or
// failing that whoever holds its zone then. Nothing is kept from one round to
// the next (there is no dial): every Terminal opens again, and next round it
// is whoever holds the zone again, each round further off counting for less.
function terminalLead(view: SeatView, w: Weights, fromRound: number): number {
  let now = 0;
  let held = 0;
  for (const z of view.zones) {
    if (!z.scoring) continue;
    const lead = z.holder ? (z.holder === view.seat ? 1 : -1) : 0;
    held += lead;
    now += z.accessed ? (z.accessed === view.seat ? 1 : -1) : lead;
  }
  let later = 0;
  for (let r = Math.max(view.round + 1, fromRound); r <= view.roundLimit; r++) later += w.missionFuture ** (r - view.round);
  return (view.round >= fromRound ? now : 0) + held * later;
}

// What a Victory Point paid as the game ends is worth of one paid now.
const endsIn = (view: SeatView, w: Weights): number => w.boxFuture ** Math.max(0, view.roundLimit - view.round);

// The Black Boxes a unit carries, and how many of them the Task would pay for
// as the unit stands: every one, or where the card names a zone, every one
// while the unit stands in that zone and none while it does not. Nothing for
// a unit that is not standing.
function boxesHeld(u: UnitView, view: SeatView): number {
  return u.alive && view.task?.family === 'blackbox' ? view.boxes.filter((b) => b.bearer === u.uid).length : 0;
}

function boxesOf(u: UnitView, view: SeatView): number {
  const held = boxesHeld(u, view);
  const name = view.task?.scoringZone;
  if (!held || !name) return held;
  const zone = view.zones.find((z) => z.name === name || z.id === name);
  return zone?.cells.includes(`${u.grid.col},${u.grid.row}`) ? held : 0;
}

// WHAT THE BOXES A UNIT CARRIES ARE WORTH TO ITS SQUAD, in Victory Points:
// what a Penetration costs it, since a bearer that is Penetrated drops them.
// A Box that would pay where its bearer stands counts whole; one that has
// still to be carried to the zone the card names counts for the share `carry`,
// and nothing on a bearer whose last turn of the game is behind it (`spent`).
export function carried(u: UnitView, view: SeatView, w: Weights, spent = false): number {
  const task = view.task;
  const held = boxesHeld(u, view);
  if (!task || !held) return 0;
  const paying = boxesOf(u, view);
  return task.vp * (paying + (spent ? 0 : (held - paying) * w.carry)) * endsIn(view, w);
}

// A unit that can take a zone, or keep the other squad from taking it: on the
// board, not Low Value, and for a Mech not in Shutdown (5.3.2).
export const holds = (u: UnitView): boolean =>
  u.alive && u.deployed && !u.lowValue && u.kind !== 'projectile' && !(u.kind === 'mech' && u.stance === 'shutdown');

// WHAT A ZONE PAYS FROM A ROUND ON, to the squad whose dial names it from that
// round's End Phase to the last: a round's pay for each round the Main Task
// scores, each round further off than this one counting for less. A Task that
// pays once, at the end, pays that once if the zone is held by then.
export function payFrom(arrives: number, view: SeatView, w: Weights): number {
  const task = view.task;
  if (!task || arrives > view.roundLimit) return 0;
  if (task.cadence !== 'per-round') return (task.family === 'blackbox' ? w.boxFuture : w.missionFuture) ** Math.max(0, view.roundLimit - view.round);
  let rounds = 0;
  for (let r = Math.max(arrives, task.fromRound, view.round); r <= view.roundLimit; r++) rounds += w.missionFuture ** (r - view.round);
  return rounds;
}

// How far a unit could go toward a zone in one activation: its own Movement,
// and for a Mech the Movement Action it carries on top (a Sprint).
export function stride(u: UnitView): number {
  const action = u.kind === 'mech' ? Math.max(0, ...u.weapons.filter((x) => x.usable && x.type === 'Moving').map((x) => x.range)) : 0;
  return u.move + action;
}

// The zones the Main Task scores that would be this squad's when the round
// ended, less the other squad's. A zone somebody holds now is that squad's. A
// zone nobody holds stays with the squad its dial names: in full while one of
// that squad's units stands in it (nobody can take it then), and for less
// while it stands empty with one of the other squad's near enough to walk in.
function zoneLead(view: SeatView, w: Weights): number {
  let lead = 0;
  for (const z of view.zones) {
    if (!z.scoring) continue;
    if (z.holder) { lead += z.holder === view.seat ? 1 : -1; continue; }
    if (!z.control) continue;
    const cells = z.cells.map((cell) => cell.split(',').map(Number));
    const near = (u: UnitView): number => Math.min(...cells.map(([col, row]) => Math.abs(u.grid.col - col) + Math.abs(u.grid.row - row)));
    const kept = view.units.some((u) => u.side === z.control && holds(u) && near(u) === 0);
    const taken = !kept && view.units.some((u) => u.side !== z.control && holds(u) && near(u) <= stride(u));
    lead += (z.control === view.seat ? 1 : -1) * (taken ? 1 - w.contest : 1);
  }
  return lead;
}
