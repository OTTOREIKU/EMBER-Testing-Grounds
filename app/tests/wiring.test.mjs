// Static guards for the two ways multiplayer wiring breaks. Both classes have
// now bitten repeatedly, both are invisible to every behavioural test, and both
// are cheap to catch by reading the source — which is exactly what this does.
//
// CLASS 1 — a local mutation of shared state. If a client changes something
// the fingerprint hashes or check() reads, and never sends a command for it,
// the two boards silently disagree. Caught five times: Black Boxes, Task
// designations, the Tactics hand, Charge Tokens, Interception Tokens.
//
// CLASS 2 — a tool that opens without paying. `routeAction` returning true
// means "the Ticks wait in pendingAction until this tool succeeds", so every
// branch that returns true owes a commitAction somewhere. Caught twice:
// Prototype Blink and the Pholcus Unfold.
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const main = read('main.ts');
const hud = read('matchhud.ts');
const guide = read('playguide.ts');
// squads.ts is not a page, but both pages mount it, so a shared field written
// there desyncs a match exactly as it would from a page. It went uncovered for
// months and the token popout walked straight into the gap.
const squads = read('squads.ts');
const secrecy = read('secrecy.ts');

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Multiplayer wiring guards\n');

// ---------- Class 1: shared fields must not be assigned by a page ----------
//
// Every token field the fingerprint hashes is a shared fact. A page assigning
// one directly is the bug; the command layer is the only place allowed to.
// `stance` joined the list with LPA-22 Yoyu's 挑衅 Provoke, which is the first
// rule that lets one squad turn the OTHER squad's dial: both boards now offer
// that switch, and a page that turned it in place rather than sending the
// command would desync two clients over which Stance a Mech is defending in.
const FINGERPRINTED = ['charge', 'intercept', 'ammo', 'partStates', 'statuses', 'mech', 'droneBackpack', 'repairedSlots', 'lastDamagedBy', 'expiring', 'stance'];
for (const field of FINGERPRINTED) {
  // Confirm the field really is hashed, so this list cannot rot into fiction.
  check(`${field} is in the board fingerprint`, secrecy.includes(field), true);
}
// Two assignments are allowed, and only these two: the freeplay mech editor,
// which squads.ts disables the moment a game exists ("Swapping Parts mid-game
// would rewrite a unit the other player has already been shooting at, so the
// editor is a free play tool only"). Counted rather than pattern-matched, so a
// THIRD one anywhere fails even if it looks like these.
const ALLOWED = { 'main.ts': { mech: 1, partStates: 1 } };
for (const [name, src] of [['main.ts', main], ['matchhud.ts', hud], ['playguide.ts', guide], ['squads.ts', squads]]) {
  for (const field of FINGERPRINTED) {
    // `t.charge = ...` and friends. Reads are fine; assignment is not. The
    // lookahead spares `el.dataset.mech`, which is markup rather than state.
    const writes = [...src.matchAll(new RegExp(`\\b(?!dataset\\.)\\w+\\.${field}\\s*=[^=]`, 'g'))].map((m) => m[0].trim());
    check(`${name} assigns .${field} only where allowed`, writes.length, ALLOWED[name]?.[field] ?? 0);
  }
}

// state.tasks is the same story one level up: designations and Terminal access
// decide scoring, and both used to be written in place on the freeplay page.
// The survivors are all `state.tasks = null` — Clear everything and Clear zones,
// board wipes with no game running, so there is no opponent to tell. Setting up
// Tasks travels as `configureTable`; the rule is that nothing here may assign a
// task state, only drop one, so this checks the VALUE rather than the count.
const taskWrites = [...main.matchAll(/state\.tasks = (\w+)/g)].map((m) => m[1]);
check('state.tasks is only ever wiped, never assigned', [...new Set(taskWrites)], ['null']);

// ---------- Class 2: every routeAction branch that returns true pays ----------
//
// The branches are read out of the source rather than listed here, so a new
// tool is covered the day it is written.
const route = hud.slice(hud.indexOf('function routeAction'), hud.indexOf('\nfunction launchPickPanel'));
check('routeAction was located', route.length > 200, true);
// Each `return true` means a tool took over. Either it commits inline, or it
// hands off to a named plan/pick whose resolver commits.
// Each tool routeAction can hand off to, named either inline or through its
// opener. A branch that opens something not on this list is a tool nobody has
// checked pays its Ticks.
const tools = ['chargePlan', 'resupplyPick', 'repairPick', 'openAttackPick', 'blinkPlan', 'startMovePlan', 'startLaunchPlan', 'terminalPick'];
for (const plan of tools) {
  check(`${plan} is opened by routeAction`, route.includes(plan), true);
}
// The inline ones: branches that both act and return true in place, so they
// have nothing later to pay for them.
check('the Unfold branch pays before it returns',
  /commitAction\(ctx\);\s*\n\s*ctx\.send\(\{ kind: 'unfold'/.test(route), true);
check('the Mode-change branch pays before it returns',
  /commitAction\(ctx\);\s*\n\s*ctx\.send\(\{ kind: 'transformPart'/.test(route), true);
// The count of commitAction call sites, so deleting one is loud. Eleven tools
// plus the no-tool path: move (x2 — the plan and the route), launch, blink,
// attack, EW, charge, resupply, repair, unfold, transformPart (287/288's Mode
// change, inline like the Unfold), Remote Access (one site for both verdicts —
// the attempt pays whether the roll succeeded or not), and doact's own.
check('every tool has a commitAction', [...hud.matchAll(/commitAction\(ctx\)/g)].length, 13);

// ---------- The ATTRIBUTED seat stamp ----------
//
// A table command is re-stamped with the sender's seat when networked. Any
// whose apply() READS cmd.seat must therefore carry an override, or a choice
// one player drives on another's behalf is recorded as the wrong squad's.
const commands = read('commands.ts');
for (const kind of ['placeSmoke', 'designateTask']) {
  const decl = commands.slice(commands.indexOf(`kind: '${kind}'`));
  check(`${kind} carries a 'for' override past the seat stamp`,
    decl.slice(0, decl.indexOf('\n')).includes('for?: Side'), true);
}
// And the reverse: the set of ATTRIBUTED commands whose apply reads cmd.seat
// must stay exactly those two, so a new one is caught the day it is added.
const attributed = commands.slice(commands.indexOf('const ATTRIBUTED = new Set'), commands.indexOf('function tableLevel'));
// JS regex has no inline (?s), so the dot-all is spelled [\s\S] instead — the
// first version threw "Invalid group" and took the whole file down with it.
const seatSensitive = [...attributed.matchAll(/'(\w+)'/g)].map((m) => m[1]).filter((k) => {
  const open = commands.indexOf(`if (cmd.kind === '${k}')`);
  if (open < 0) return false;
  const end = commands.indexOf('\n  }', open);
  return end > open && /cmd\.seat/.test(commands.slice(open, end));
});
// rollbackRequest is the third, and it is safe for a different reason than the
// other two. They carry an explicit `for` override because one seat can make a
// choice on the other's behalf. rollbackRequest cannot: nobody ever asks for a
// rollback in someone else's name, and the seat it records as `by` IS the
// sender — stamped on the way out, preserved as sent on the way in — so the two
// clients agree on who asked without an override.
check('only these three read their seat when applied',
  seatSensitive.sort(), ['designateTask', 'placeSmoke', 'rollbackRequest']);

// ---------- Class 4: one job, one path ----------
//
// Choosing a Main Task changes the mission, its Task Items and the zone set at
// once. Two places offer it — the toolbar's Zones list and the Missions dialog
// — and for a while each sent the configureTable command itself. The dialog's
// copy forgot save() and onChanged(), so a pick landed in state and NOTHING on
// the page moved: no zones drawn, no Task Item markers, the toolbar list still
// naming the old set, the guide still asking for a Main Task, and a reload lost
// it. Reopening the dialog showed the mission as already in use, because the
// state had been written the whole time. The dialog now calls setZoneSet, and
// this pins that it is the only writer.
const missionSends = [...main.matchAll(/kind: 'configureTable'[^}]*mission:/g)].length;
check('only one place configures the mission', missionSends, 1);
check('the Missions dialog goes through setZoneSet', /if \(!setZoneSet\(`mission:\$\{m\.id\}`\)\) \{/.test(main), true);
// And a refused pick must SAY so. The silent version of this return was
// reported as a broken button, twice, because from the outside it was one.
check('a refused pick is shown, not swallowed', /note\.textContent = zoneSetRefusal;/.test(main), true);
// setZoneSet is the shared path, so it owes BOTH the save and the re-render —
// renderZoneOverlay alone only toggles the overlay, it does not draw the zones,
// place the Task Items or tell the guide anything.
const setZone = main.slice(main.indexOf('function setZoneSet('), main.indexOf('zoneSelect.addEventListener'));
check('setZoneSet was located', setZone.includes('configureTable'), true);
check('setZoneSet saves', /\bsave\(\);/.test(setZone), true);
check('setZoneSet re-renders everything', /\bonChanged\(\);/.test(setZone), true);

// ---------- Class 5: a spectator changes nothing ----------
//
// A watcher holds no seat. The danger is not that they break the other players'
// game — the relay refuses a seatless sender — it is that their OWN board
// drifts: perform() would apply the command locally and relay.publish() drops
// it for want of a seat, so the watcher ends up looking at a game that never
// happened, with no error anywhere. Read from the source because there is no
// runtime signal for it, exactly like the host-ring rule.
const matchSrc = read('match.ts');
const sendFn = matchSrc.slice(matchSrc.indexOf('function send(cmd: Command)'), matchSrc.indexOf('\n}', matchSrc.indexOf('function send(cmd: Command)')));
check('send() was located', sendFn.includes('perform('), true);
check('send() refuses a seatless client', /if \(relay\.state\.room && !relay\.state\.seat\)[\s\S]*?return \{ ok: false/.test(sendFn), true);
// And it must come BEFORE the command is performed, or the refusal is a report
// of something that already happened to this board. Comments stripped first:
// the guard EXPLAINS itself by naming perform(), so a naive search finds the
// prose rather than the call.
const sendCode = sendFn.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
check('the refusal precedes perform()',
  sendCode.indexOf('!relay.state.seat') < sendCode.indexOf('perform('), true);
// Dragging is the one board gesture that reaches the engine without passing
// through the turn panel, so hiding the panel does not close it.
const onMoveFn = hud.slice(hud.indexOf('    onMove(uid, col, row) {'), hud.indexOf('    onCellHover(col, row) {'));
check('the drag handler was located', onMoveFn.length > 100, true);
check('a spectator cannot drag a unit', /ctx\.networked && !ctx\.seat/.test(onMoveFn), true);
// The turn panel is a question put to someone holding a seat. Every branch of
// it assumes one, and `mine()` answers true for a seatless client, so the watch
// branch has to come before all of them rather than beside them.
const panelFn = hud.slice(hud.indexOf('function panelHtml(ctx: HudCtx)'), hud.indexOf('function rollbackOffer'));
check('panelHtml was located', panelFn.includes('boxDropPanel'), true);
check('watching is the first branch of the turn panel',
  panelFn.indexOf('watchPanel(ctx)') < panelFn.indexOf('boxDropPanel(ctx)'), true);
// A rollback is a bargain between the two players, and a watcher is not a party
// to it. The branch above already means they never reach the panels that draw
// the offer — this is the second layer, so reordering the dispatcher some day
// cannot quietly start asking them.
const offerFn = hud.slice(hud.indexOf('function rollbackOffer(ctx: HudCtx)'), hud.indexOf('function rollbackPanel'));
check('rollbackOffer was located', offerFn.includes('rollbackCatalog'), true);
check('a watcher is never offered a rollback', /if \(!ctx\.networked \|\| !ctx\.seat/.test(offerFn), true);

// ---------- Class 3: a rule that exists on one board only ----------
//
// This project's signature defect, and the reason the sweep that found BUG-3
// was worth running: freeplay and the Match Centre each grew their own copy of
// the Electronic Counter-roll, and only freeplay's applied the EW Suppression
// aura (ZHDR-202_B / PDTR-202_B). The pool is arithmetic, not a command, so no
// fingerprint and no behavioural test of either page could see the difference.
//
// The rule now lives once, in units.ts electronicStrength. What is guarded here
// is that neither board goes back to reading electronicValue() for a pool.
const units = read('units.ts');
check('electronicStrength is the one home for the rolled pool',
  units.includes('export function electronicStrength'), true);
check('and it is the only place the EW Suppression aura is read',
  [main, hud, guide, read('combat.ts'), read('commands.ts'), units]
    .reduce((n, src) => n + (src.match(/electronic_contest_strength_penalty/g) ?? []).length, 0), 1);
// The Match Centre's seams MOVED: Electronic Warfare is resolved in the combat
// window now, so the pool is sized by the one renderer (showContest, both
// hands) and the page only rolls what it is asked for (contestAct).
const combat = read('combat.ts');
const contestFn = hud.slice(hud.indexOf('function contestAct(ctx: HudCtx'), hud.indexOf('function syncContest('));
check('contestAct was located', contestFn.includes('rollCounter'), true);
check('and sizes the roll with electronicStrength',
  (contestFn.match(/electronicStrength\(/g) ?? []).length, 1);
check('and never rolls the printed value', contestFn.includes('electronicValue('), false);
// THE FOCUS REROLL IS NOT A POOL. 4.10 is 'reroll any Dice in that roll',
// player's choice, and the retired panel rerolled the whole hand instead --
// a different and more generous rule than the one printed. Only the chosen
// indexes are thrown, and they are spliced back into the hand that was kept.
check('the Focus reroll throws only the dice that were picked',
  /rollHits\(idx\.length/.test(contestFn), true);
check('and splices them back into the hand',
  /const faces = had\.slice\(\);/.test(contestFn), true);
// Both hands, sized by the renderer that draws them.
const showFn = combat.slice(combat.indexOf('  showContest('), combat.indexOf('  closeContest()'));
check('showContest sizes both pools with electronicStrength',
  (showFn.match(/electronicStrength\(this\.data/g) ?? []).length, 2);
check('and reads no printed value for a pool', showFn.includes('electronicValue('), false);
// Freeplay's own entry reads the same function, so the two boards cannot drift.
check('freeplay ElectronicHelper reads the same helper',
  (combat.match(/electronicStrength\(this\.data/g) ?? []).length, 4);
// The printed value still gates who may INITIATE (4.11.2: EV 0 cannot start
// one, but may respond), which is a different question from the pool size.
check('the printed value is still what gates initiating',
  (hud.match(/electronicValue\(ctx\.data/g) ?? []).length, 2);
// Same class, the Ammo edition (BUG-4). A Volley is capped by the magazine, and
// a launcher lent by a Carrier Tarantula keeps its magazine on the DRONE (FAQ
// O3/O16). Both launch UIs sized that cap off their own `t.ammo`, found nothing
// there, and offered shots commands.ts now refuses. playguide.ts has no launch
// flow, so these two are the whole set.
for (const [name, src] of [['main.ts', main], ['matchhud.ts', hud]]) {
  check(`${name} imports ammoHolder from the command layer`,
    /import \{[^}]*\bammoHolder\b[^}]*\} from '\.\/commands'/.test(src), true);
}
const startLaunch = main.slice(main.indexOf('function startLaunch(t: Token'), main.indexOf('function endTargeting'));
check('freeplay startLaunch was located', startLaunch.includes('volleyOf'), true);
check('and sizes the volley off the magazine that pays',
  startLaunch.includes('ammoHolder(data, state, t, action.id).ammo[action.id]'), true);
const startPlan = hud.slice(hud.indexOf('export function startLaunchPlan'), hud.indexOf('// A Landing Point is a Grid'));
check('the Match Centre launch plan was located', startPlan.includes('volleyOf'), true);
check('and sizes its volley off the same one',
  startPlan.includes('ammoHolder(ctx.data, ctx.state, t, actionId)'), true);

// ---------- Class 4: a Movement has two endings, and both owe the same riders ----------
//
// BUG-1. A Match Centre Movement leaves through the plain settle OR, when it
// ends in an occupied Grid, through finishCrush — and everything the settle
// does has to be done again there. ZHDR-304's tow was written into the settle
// alone, so a Harpy that dragged an Ally and then Crushed paid the -2 Movement
// and left the Ally behind. Freeplay is immune: main.ts routes its crush back
// into the same settle closure, so there is only one ending to maintain.
check('the tow has exactly one home', (hud.match(/function towDraggedAlly\(/g) ?? []).length, 1);
check('and nothing else re-implements the spendCommand/forceMove pair',
  (hud.match(/drags \$\{ally\.label\} along/g) ?? []).length, 1);
const settleFn = hud.slice(hud.indexOf('function commitMove(ctx: HudCtx)'), hud.indexOf('// A snapped footprint counts only'));
check('commitMove was located', settleFn.includes('crushTargets'), true);
check('the plain settle tows', /if \(drag\) towDraggedAlly\(/.test(settleFn), true);
// The plan is the only thing that survives between the two endings, so the tow
// has to be ON it — a field, and a value written into it.
const crushType = hud.slice(hud.indexOf('let crushPlan: {'), hud.indexOf('function crushEscapes'));
check('the crushPlan type was located', crushType.includes('pendingSpot'), true);
check('and it carries the drag across the Crush', /drag\?: \{ allyUid: number; funderUid: number \}/.test(crushType), true);
const planBuild = settleFn.slice(settleFn.indexOf('crushPlan = {'), settleFn.indexOf('advanceCrush(ctx);'));
check('the crushPlan literal was located', planBuild.includes('queue:'), true);
check('and the plan is built with the drag on it', /^\s*drag,\s*$/m.test(planBuild), true);
// BUG-2, the same card one page over. The Harpy's drag costs -2 Movement, and
// freeplay painted the reachable overlay with the UN-reduced allowance while
// the plan and the route cap both used the reduced one. Cosmetic, but it showed
// the player Grids the unit could not enter, which reads as an engine bug.
// A single `range` is the fix: one number, used by the plan and the paint.
const startMoveFn = main.slice(main.indexOf('async function startMove(uid: number'), main.indexOf('function commitMove(): void'));
check('freeplay startMove was located', startMoveFn.includes('offerHarpyDrag'), true);
check('the reduced allowance is taken once', /const range = drag \? steps - 2 : steps;/.test(startMoveFn), true);
check('the plan carries it', /steps: range,/.test(startMoveFn), true);
check('and the overlay is solved with the same number',
  startMoveFn.includes('showReachable(reachableGrids(t, range,'), true);
check('and labelled with it too', /showReachable\([^;]*, range\);/.test(startMoveFn), true);
check('nothing in startMove still paints the un-reduced steps',
  /showReachable\([^;]*\bsteps\b/.test(startMoveFn), false);

const finishFn = hud.slice(hud.indexOf('function finishCrush(ctx: HudCtx)'), hud.indexOf('function placeCrushed'));
check('finishCrush was located', finishFn.includes('offerBoxesOn'), true);
check('and the crush ending tows too', /if \(m\.drag\) towDraggedAlly\(/.test(finishFn), true);
// Order matters: the Grid the Harpy vacated is only free once the maneuver that
// left it has been sent, so the tow follows it in both endings.
check('the tow follows the maneuver that vacated the Grid',
  finishFn.indexOf("kind: 'maneuver'") < finishFn.indexOf('towDraggedAlly('), true);

// ---------- Class 5: the Crush exchange, one rule read the same by both pages ----------
//
// 4.3.6 puts the Crush at the moment a Unit is "about to enter a Grid occupied
// by another Unit", so the crushed Unit takes the Grid the crusher STEPS OUT OF
// — the second-to-last Grid of the route, one boundary away. Neither page may
// let rules.ts derive that Grid from the crusher's token: nothing has moved the
// token yet (animateMove is SVG only, and settle/the commands are the only
// writers), so it would answer with the Grid the whole Movement BEGAN in. A
// crusher routed (1,0)->(1,1)->(1,2) sent its victim two Grids off; a freeplay
// drag sent one sixteen. The geometry itself is pinned in commands.test.mjs;
// what is pinned HERE is that each page hands the Grid over.
check('the Match Centre reads the step-out Grid off the route',
  /const from = m\.path\.length >= 2 \? m\.path\[m\.path\.length - 2\] : null;/.test(finishFn), true);
check('and hands it to the exchange',
  /crushExchange\(t, swapped, m\.goal, from,/.test(finishFn), true);

const resolveFn = main.slice(main.indexOf('function resolveCrush(t: Token'), main.indexOf('async function askCrushFacing'));
check('freeplay resolveCrush was located', resolveFn.includes('settleExchanges'), true);
check('it is told the step-out Grid rather than deriving one',
  /function resolveCrush\(t: Token, goal: LargeGrid, victims: CrushVictims, from: LargeGrid \| null,/.test(resolveFn), true);
check('and hands the same Grid to the exchange',
  /crushExchange\(t, exchanges\.map\(\(x\) => x\.v\), goal, from,/.test(resolveFn), true);
const commitFn = main.slice(main.indexOf('function commitMove(): void'), main.indexOf('// Resupply (4.13)'));
check('freeplay commitMove was located', commitFn.includes('crushTargets'), true);
// Deliberately NOT pinning the binding's NAME. The first version of this hard-coded
// `const from = ...`, and it then failed when that binding was renamed to break a
// shadow — punishing the fix instead of the bug. Capture whatever it is called and
// assert THAT SAME binding reaches resolveCrush, which is the wiring this is for.
const stepOutDecl = /const (\w+) = path\.length >= 2 \? path\[path\.length - 2\] : null;/.exec(commitFn);
check('the guided route reads the step-out Grid off the path', !!stepOutDecl, true);
check('and hands that same binding to resolveCrush',
  stepOutDecl ? new RegExp(`resolveCrush\\(t, goal, victims, ${stepOutDecl[1]},`).test(commitFn) : false, true);
// The drag has no route, so it rules on its own terms: a drop from the next
// Grid IS the single step 4.3.6 describes, and a drop from further off cannot
// produce an exchange at all. Nothing is invented either way.
const dropFn = main.slice(main.indexOf('    onMove(uid, col, row, forced) {'), main.indexOf('    onInspect(info) {'));
check('freeplay drag-drop was located', dropFn.includes('resolveCrush'), true);
check('and only exchanges when the drop came from the next Grid',
  /const from = Math\.abs\(at\.c - goal\.c\) \+ Math\.abs\(at\.r - goal\.r\) === 1 \? at : null;/.test(dropFn), true);

// D2. script.strict defaults to false and perform() only BLOCKS a refusal when
// strict or networked, so in ordinary freeplay a refused crushSwap is applied
// anyway — and settleExchanges then narrated a swap the board had made while
// saying it had not. The refusal is handled here, at the call site, or not at
// all. One regex on purpose: check, the early return, and only then perform.
check('freeplay checks the exchange and returns on a refusal BEFORE performing it',
  /const verdict = check\(data, state, cmd\);[\s\S]*?if \(!verdict\.ok\) \{[\s\S]*?done\(false\);[\s\S]*?\}\s*\n\s*perform\(data, state, cmd\);/.test(resolveFn), true);

// D3. The same Movement must end in the same Grid on both pages. When the
// crusher cannot fit after all, the Match Centre walks it back to the last Grid
// of the route that had room; freeplay read the token instead, which recorded
// the START of the Movement while the animation had walked it forward.
check('the Match Centre ends a Crush that will not fit at the last Grid with room',
  /const held = walk\[walk\.length - 1\] \?\? \{ col: t\.col, row: t\.row \};/.test(finishFn), true);
check('and freeplay now ends it in the same Grid',
  /const held = walk\[walk\.length - 1\] \?\? \{ col: t\.col, row: t\.row \};[\s\S]*?settle\(held\.col, held\.row\);/.test(commitFn), true);
// The one settle that may still read the token is the exchange's, and only
// because the crushSwap has already moved it there.
check('the crusher\'s own position is settled from the token only after it was placed',
  /if \(placed\) \{\s*\n\s*settle\(t\.col, t\.row\);/.test(commitFn), true);

// ---------- Electronic Value "-" cannot be a Responder (4.11.2) ----------
// Found re-reading 4.11 against the engine. The rule distinguishes two things
// the code was treating as one: an Electronic Value of 0 CANNOT INITIATE but
// may be targeted and simply rolls nothing, while a DASH cannot be the
// Responder at all. The dash is carried in the data as -1, and electronicValue
// summed it as a plain number -- so instead of being untargetable, the two
// cards that have it merely rolled one die fewer.
{
  const u = read('units.ts');
  check('the dash has a reader of its own',
    /export function electronicDash\(/.test(u), true);
  check('and it asks for a NEGATIVE printed value, not a zero',
    /\(card\.electronic \?\? 0\) < 0/.test(u), true);
  // The sum must not drag on it either, or a dash reads as -1 Electronic Value.
  check('a dash contributes nothing to the pool',
    /Math\.max\(0, card\.electronic \?\? 0\)/.test(u), true);
  // The gate lives at the COMMAND, so a relayed one obeys it too, and the
  // picker merely declines to offer what the command would refuse.
  const cmds = read('commands.ts');
  const start = cmds.slice(cmds.indexOf("case 'startCounterRoll': {"), cmds.indexOf("case 'rollCounter'"));
  check('startCounterRoll refuses a dash as the Responder',
    /electronicDash\(data, target\)/.test(start), true);
  check('and the Match Centre does not offer one',
    /alive\(t\) && !electronicDash\(ctx\.data, t\)/.test(read('matchhud.ts')), true);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
