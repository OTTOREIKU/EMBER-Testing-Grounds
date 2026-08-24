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

const unitsSrc = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
const start = unitsSrc.indexOf('// ---------- STEALTH X and Manifestation Movement');
const end = unitsSrc.indexOf('export function interceptCapacity');
if (start < 0 || end < 0 || end <= start) throw new Error('could not slice the Stealth readers out of units.ts');
const tmp = new URL('./_stealth.slice.ts', import.meta.url);
writeFileSync(tmp, `type GameData = any;
type Token = any;
type CardAction = any;
type PartSlot = any;
type TerrainPiece = any;
const CAMO_ACTIVATES = /开启光学迷彩|Activate Optical Camouflage/i;
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
  const rev = cmds.slice(cmds.indexOf("case 'reveal': {"), cmds.indexOf("case 'reveal': {") + 1600);
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
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
