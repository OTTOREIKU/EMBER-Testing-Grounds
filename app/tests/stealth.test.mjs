// STEALTH X and Manifestation Movement (4.12.2, book p.72), and the door into
// the Optical Camouflage State that never existed.
//
// The State itself was thoroughly wired -- Scan-or-fail, EV 0/dash cannot
// target, non-Silent Actions Reveal, Contact Reveals, Maneuver breaks it -- but
// the ONLY way in was deploying already camouflaged. A Mech whose whole point
// is to vanish mid-game could not: the player had to add the Token by hand from
// the status picker. Three cards print the Action (096 and 247 at Stealth 2,
// ZYBP-201 at Stealth 0).
//
// And Stealth X itself was prose: both boards told the player to "make
// Manifestation Movement, up to this unit's Stealth value" without ever saying
// what that value was or enforcing it.
import { readFileSync, writeFileSync } from 'node:fs';

// From activatesCamo (the door into the State) through the SCANNING block, so
// this test drives the real readers for both halves of the rule. Both offsets
// asserted rather than assumed: an end marker that precedes its start slices
// nothing, and every assertion below would then pass against an empty module.
const unitsSrc = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
const start = unitsSrc.indexOf('export function activatesCamo(');
const end = unitsSrc.indexOf('export function interceptCapacity');
if (start < 0 || end < 0 || end <= start) throw new Error('could not slice the Stealth readers out of units.ts');
const tmp = new URL('./_stealth.slice.ts', import.meta.url);
writeFileSync(tmp, `type GameData = any;
type Token = any;
type CardAction = any;
type PartSlot = any;
type TerrainPiece = any;
const CAMO_ACTIVATES = /开启光学迷彩|Activate Optical Camouflage/i;
const statusCount = (list, id) => (list ?? []).filter((s) => s === id).length;
// The board extent Manifestation is bounded by. Stubbed at the printed board
// because these fixtures are printed-board fixtures; largeboard.test.mjs is
// where the size-dependent behaviour is proved.
const boardGrids = () => 12;
const largeGridOf = (t) => ({ c: Math.floor(t.col / 3), r: Math.floor(t.row / 3) });
// Every Grid has room unless a token already sits in it: enough to prove the
// range arithmetic and the fit filter, without importing the real geometry.
const standingSpot = (c, r, size, aerial, terrain, tokens, ignoreUid) =>
  tokens.some((o) => o.uid !== ignoreUid && Math.floor(o.col / 3) === c && Math.floor(o.row / 3) === r)
    ? null : { col: c * 3, row: r * 3 };
const tokenCards = (data, t) => Object.entries(t.mech ?? {})
  .map(([slot, id]) => ({ slot, card: data.byId.get(id) })).filter((x) => x.card);
` + unitsSrc.slice(start, end));
const U = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Stealth X: the way in, and Manifestation Movement\n');

// ---------- reading the value off the printed Action ----------
const act = (en, zh) => ({ description: { en, zh } });
const OCTOPUS = act('· Activate Optical Camouflage, Stealth 2.', '· 开启光学迷彩，隐秘2。');
const CLOAK = act('· Activate Optical Camouflage, Stealth 0.', '· 开启光学迷彩，隐秘0。');

check('the Octopus activates camouflage', U.activatesCamo(OCTOPUS), true);
check('and carries Stealth 2', U.stealthValue(OCTOPUS), 2);
check('the Cloak carries Stealth 0, which is a value and not an absence', U.stealthValue(CLOAK), 0);
check('the Chinese alone is enough', U.stealthValue(act('', '· 开启光学迷彩，隐秘2。')), 2);
// The guard that matters: Stealth is read off the ACTIVATING Action only. LPA-21
// is a pilot trait called Stealth in English and nothing to do with this rule.
check('an Action that merely says Stealth activates nothing',
  U.activatesCamo(act('· This pilot has Stealth 3 training.')), false);
check('and yields no value', U.stealthValue(act('· This pilot has Stealth 3 training.')), undefined);
check('an ordinary Action is not an activator', U.activatesCamo(act('· Laser Weapon')), false);

// ---------- the range, off the unit's live Parts ----------
const data = {
  byId: new Map([
    ['OCTO', { id: 'OCTO', actions: [OCTOPUS] }],
    ['CLOAK', { id: 'CLOAK', actions: [CLOAK] }],
    ['PLAIN', { id: 'PLAIN', actions: [act('· Laser Weapon')] }],
  ]),
};
const mech = (parts, partStates = {}, over = {}) => ({
  uid: 1, kind: 'mech', side: 's1', size: 1, col: 15, row: 15, aerial: false,
  mech: parts, partStates, statuses: [], ...over,
});

check('a plain Mech manifests nowhere', U.manifestationRange(data, mech({ torso: 'PLAIN' })), 0);
check('an Octopus torso gives 2', U.manifestationRange(data, mech({ torso: 'OCTO' })), 2);
check('a Cloak backpack gives 0', U.manifestationRange(data, mech({ backpack: 'CLOAK' })), 0);
// A wrecked Part grants nothing - which is also the fifth Reveal trigger seen
// from the other side: lose the Part that hid you and you appear in place.
check('a destroyed Octopus torso grants nothing',
  U.manifestationRange(data, mech({ torso: 'OCTO' }, { torso: 'destroyed' })), 0);
check('a damaged one still does', U.manifestationRange(data, mech({ torso: 'OCTO' }, { torso: 'damaged' })), 2);

// ---------- the destinations ----------
{
  const t = mech({ torso: 'OCTO' });                      // Large Grid (5,5)
  const spots = U.manifestTargets(data, [t], [], t);
  check('a Stealth 2 unit reaches the 5x5 block minus its own Grid', spots.length, 24);
  const far = spots.map((s) => Math.max(Math.abs(s.c - 5), Math.abs(s.r - 5)));
  check('nothing further than 2 Grids', Math.max(...far), 2);
  check('and its own Grid is not on the list', spots.some((s) => s.c === 5 && s.r === 5), false);
  // Occupied Grids drop out: teleportation ignores what is BETWEEN, never what
  // is standing in the destination.
  const blocker = { uid: 2, col: 18, row: 15 };
  check('a Grid with someone in it is not offered',
    U.manifestTargets(data, [t, blocker], [], t).some((s) => s.c === 6 && s.r === 5), false);
  check('a Stealth 0 unit is offered nothing at all',
    U.manifestTargets(data, [mech({ backpack: 'CLOAK' })], [], mech({ backpack: 'CLOAK' })).length, 0);
}
// The board edge clips the block rather than wrapping round it.
{
  const corner = mech({ torso: 'OCTO' }, {}, { col: 0, row: 0 });
  check('a unit in the corner Grid gets the quarter-block', U.manifestTargets(data, [corner], [], corner).length, 8);
}

// ---------- SCANNING (4.12.4) ----------
//
// The Scan was a Common Action every Mech has, printed with its whole rule, and
// COMPLETELY INERT: `COMMON_SCAN` appeared nowhere in app/src. Performing it
// spent an End Phase and a Tick and did nothing at all.
{
  check('the Common Action is recognised by id', U.isScanAction({ id: 'COMMON_SCAN' }), true);
  check('and a printed card Scan by its text',
    U.isScanAction(act('· Scan all Enemy Targets in the Optical Camouflage State within range.')), true);
  check('an ordinary Action is not a Scan', U.isScanAction(act('· Laser Weapon')), false);
  // The guard that matters: a Scan is NOT an Electronic Attack. 4.12.4 borrows
  // 4.11.2's Counter-roll, but a card that modifies "Electronic Attacks" must
  // not reach it - so the two readers stay separate and this pins that they do.
  check('and a Scan does not read as an Electronic Attack',
    /electronic attack|电子攻击/i.test('Scan an enemy in the Optical Camouflage State'), false);

  const hidden = { statuses: ['camouflage'] };
  const marked = { statuses: ['lowProfile', 'lowProfile'] };
  const plain = { statuses: [] };
  check('a camouflaged enemy is scannable', U.scannable(hidden), true);
  check('one bearing a Low Profile Token is too', U.scannable(marked), true);
  check('a unit with neither is not', U.scannable(plain), false);
  check('the strip counts every Token', U.scanStrips(marked), 2);
  check('and nothing on a clean unit', U.scanStrips(plain), 0);
  // Only TOKEN-borne Low Profile can be Scanned away (4.12.4's own note): an
  // aura granting it is untouchable, which our data models by never putting a
  // Token on for one - so counting Tokens IS the rule.
  check('a camouflaged unit with no Token strips nothing', U.scanStrips(hidden), 0);
}

// ---------- where the rule LIVES ----------
{
  const cmds = readFileSync(new URL('../src/commands.ts', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const hud = readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8');
  const guide = readFileSync(new URL('../src/playguide.ts', import.meta.url), 'utf8');

  // ONE command carries both halves. 4.12.2 makes the Reveal and the
  // Manifestation a single event, so a mirror replaying it sees one hop rather
  // than a unit standing revealed on its marker for a frame.
  check('the reveal command can carry a destination', /kind: 'reveal';[^\n]*to\?: \{ col: number; row: number \}/.test(cmds), true);
  const rev = cmds.slice(cmds.indexOf("case 'reveal': {"), cmds.indexOf("case 'reveal': {") + 2400);
  check('and the command judges the distance itself', /manifestationRange\(data, t\)/.test(rev), true);
  check('refusing anything beyond the Stealth value', /if \(away > range\)/.test(rev), true);
  check('and anywhere the unit does not fit', /does not fit there/.test(rev), true);

  // Both boards can now ENTER the state, which is the half that did not exist.
  check('freeplay routes the activating Action', /if \(activatesCamo\(action\)\) \{[\s\S]{0,120}?performCamo/.test(main), true);
  check('and the Match Centre routes it too', /if \(activatesCamo\(a\)\) \{/.test(hud), true);
  check('freeplay applies the camouflage status', /performCamo[\s\S]{0,900}?statusId: 'camouflage'/.test(main), true);
  check('and the Match Centre sends the same one', /activatesCamo\(a\)[\s\S]{0,700}?statusId: 'camouflage'/.test(hud), true);

  // And both offer the hop on the way out.
  check('freeplay offers Manifestation on Reveal', /offerManifestation/.test(main), true);
  check('the Match Centre opens its own picker', /openManifest\(ctx, t/.test(hud), true);
  check('whose buttons send the destination with the reveal',
    /data-manifest[\s\S]{0,600}?kind: 'reveal'[^\n]*to: \{ col, row \}/.test(hud), true);

  // The prose both boards used to print is gone from all three readers -- BOTH
  // wordings, because the first version of this pin matched only "this unit's"
  // and the guide's "up to its Stealth value" sailed straight past it.
  for (const [name, src] of [['freeplay', main], ['the Match Centre', hud], ['the play guide', guide]]) {
    check(`${name} no longer tells the player to look up their own Stealth value`,
      /up to (?:this unit's|its) Stealth value/.test(src), false);
    check(`${name} never says to move it by hand`, /move it by hand/.test(src), false);
  }
  check('and the play guide names the number instead', /Stealth \$\{range\}/.test(guide), true);

  // ---------- the three bugs the fresh-eyes pass found ----------
  // 1. routeAction's camo branch is IMMEDIATE, so it must pay the Action
  //    itself: every other branch opens a tool that commits later, and
  //    returning true without commitAction left the Tick unspent and the
  //    latched pendingAction riding along to the next tool.
  check('the Match Centre camo branch pays for the Action',
    /activatesCamo\(a\)\) \{[\s\S]{0,700}?commitAction\(ctx\)[\s\S]{0,400}?statusId: 'camouflage'/.test(hud), true);
  check('and an already-hidden misclick drops the pending Action instead',
    /already in the Optical Camouflage State\.`\);\s+dropAction\(\);/.test(hud), true);
  // 2. The activation is exempt from the reveal sweep, or the sweep prompted a
  //    Reveal the instant the camouflage went on -- the activating Action
  //    prints no Silence and lands in opp.performed like any other.
  check('the reveal sweep exempts the activating Action',
    /if \(!a \|\| activatesCamo\(a\) \|\| isSilentAction/.test(hud), true);
  // 3. The automation path Reveals through the same picker: the owed-reveal
  //    button (non-Silent action, Contact, Maneuver) routes through
  //    openManifest rather than sending a bare reveal.
  check('the owed-reveal button offers Manifestation',
    /data-revealgo[\s\S]{0,500}?openManifest\(ctx, t/.test(hud), true);
  check('and no bare reveal send is left on that button',
    /revealDismissed\.add\(el\.dataset\.revealkey[\s\S]{0,300}?kind: 'reveal'/.test(hud), false);

  // ---------- the Scan's two halves ----------
  const cbt = readFileSync(new URL('../src/combat.ts', import.meta.url), 'utf8');
  // Both land in applyEffects, the ONE seam a successful Counter-roll passes
  // through - the same shape as the on-hit rider seam in finish().
  const eff = cbt.slice(cbt.indexOf('private applyEffects()'), cbt.indexOf('private relayNote('));
  check('the effect seam handles a Scan', /isScanAction\(c\.action\)/.test(eff), true);
  check('stripping every Low Profile Token', /statusId: 'lowProfile'/.test(eff), true);
  // The camouflage half is a REACTION, not something the scanner applies: the
  // Manifestation belongs to the target's own player, so the scanner's client
  // queues the debt and the owner's client answers it.
  check('and queueing the Reveal as the target player\'s own decision',
    /kind: 'manifest'[\s\S]{0,80}?fromUid: c\.initiator\.uid/.test(eff), true);
  check('the scanner never reveals the target itself', /kind: 'reveal'/.test(eff), false);

  // The debt is answerable: a panel for it, and an answer that opens the picker.
  check('the Match Centre draws a panel for the Scan debt', /r\.kind === 'manifest'/.test(hud), true);
  check('whose answer opens the same Manifestation picker',
    /r\.kind === 'manifest'\) \{\s*\n\s*openManifest\(ctx, t, 'Scanned:'\)/.test(hud), true);

  // Targeting is a rule, so the COMMAND refuses a pointless Scan rather than
  // the button merely not being drawn.
  const scanGate = cmds.slice(cmds.indexOf("case 'startCounterRoll': {"), cmds.indexOf("case 'startCounterRoll': {") + 3000);
  check('the counter-roll command refuses a Scan with nothing to do',
    /isScanAction\(a\) && !scannable\(target\)/.test(scanGate), true);

  // Both boards can reach the window without Scan being an Electronic Attack.
  check('freeplay opens the Counter-roll for a Scan',
    /isElectronicAttack\(action\) \|\| isScanAction\(action\)/.test(main), true);
  check('and the Match Centre does too',
    /isElectronicAttack\(a\) \|\| isScanAction\(a\)/.test(hud), true);

  // ---------- the three holes the second fresh-eyes pass found ----------
  // 1. ON A SHARED TABLE applyEffects NEVER RUNS: the verdict is derived, no
  //    one presses Resolve, and the effects go through contestAct('apply') in
  //    matchhud - whose fallback grants FCI. Without its own branch there, a
  //    successful online Scan handed the target Fire Control Interference.
  check('the Match Centre apply branch handles a Scan before the FCI fallback',
    /act === 'apply'\) \{[\s\S]{0,1400}?isScanAction\(a\)[\s\S]{0,1600}?targetTracingOn/.test(hud), true);
  check('stripping the Tokens there too', /isScanAction\(a\)[\s\S]{0,600}?statusId: 'lowProfile'/.test(hud), true);
  check('and queueing the manifest debt for the target player',
    /isScanAction\(a\)[\s\S]{0,900}?kind: 'manifest', fromUid: init\.uid/.test(hud), true);
  // 2. Freeplay consumes reactions per-kind and had no manifest branch, so a
  //    Scan debt fell through toward the Emergency Smoke default.
  check('freeplay answers a manifest debt with the picker',
    /r\.kind === 'manifest'\) \{[\s\S]{0,400}?offerManifestation\(defender, 'Scanned:'\)/.test(main), true);
  check('clearing the debt before the picker so it cannot re-fire',
    /r\.kind === 'manifest'\) \{\s*\n\s*perform\(data, state, \{ kind: 'resolveReaction'/.test(main), true);
  // 3. Freeplay opens the helper directly, never sending startCounterRoll, so
  //    the command-layer target gate cannot fire there - the click asks it.
  check('the freeplay click refuses a pointless Scan',
    /isScanAction\(action\) && !scannable\(defender\)/.test(main), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
