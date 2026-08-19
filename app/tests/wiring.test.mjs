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
const FINGERPRINTED = ['charge', 'intercept', 'ammo', 'partStates', 'statuses', 'mech', 'droneBackpack', 'repairedSlots', 'lastDamagedBy', 'expiring'];
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
