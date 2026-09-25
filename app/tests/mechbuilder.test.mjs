// THE SHARED MECH BUILDER (src/mechbuilder.ts). The tabletop's Add > Mech tab
// and the pad's Build a Mech panel draw the same rows and apply the same rules
// since 2026-09-24, when OTTO asked for the pad's builder on the tabletop. These
// pins keep them on the one module: a second copy would drift the first time
// either changed.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const mb = read('../src/mechbuilder.ts');
const roster = read('../src/roster.ts');
const pad = read('../pad/pad.ts');

console.log('The shared Mech builder\n');

// ---------- both tools draw it ----------
for (const [name, src] of [['roster.ts', roster], ['pad.ts', pad]]) {
  check(`${name} draws the builder's rows`, src.includes('mechBuilderHtml('), true);
  check(`${name} opens a slot through the shared picker`, src.includes('openMechSlot('), true);
  check(`${name} checks a build with the shared rules`, src.includes('confirmLegalBuild('), true);
  check(`${name} takes its slot list from slotPool`, src.includes('slotPool('), true);
  // The pad's sheet has a SLOTS of its own for the Part rows it draws; that
  // one is not a builder list, so only BUILD_SLOTS is held against it.
  check(`${name} keeps no builder slot list of its own`, (name === 'pad.ts' ? /const BUILD_SLOTS\b/ : /const (BUILD_)?SLOTS\b/).test(src), false);
}
check('the tabletop no longer draws a <select> per slot', roster.includes("document.createElement('select')") && roster.includes('const selects'), false);

// ---------- the rules it carries ----------
// Pilots are faction-locked like Parts (ratified; the rulebook reads the other
// way). The pad used to leave the pilot out of both the faction set and the
// picker's lock; the shared builder must not.
check('the slot list includes the pilot', /key: 'pilot'/.test(mb), true);
check('buildFactions walks every slot, pilot included',
  /export function buildFactions[\s\S]*?for \(const s of BUILD_SLOTS\)/.test(mb) && !/export function buildFactions[\s\S]*?s\.key === 'pilot'\) continue/.test(mb), true);
check('the picker locks every slot to the build\'s faction, pilot included',
  mb.includes('lockedFaction: buildLockedFaction(o.data, o.loadout)') && !mb.includes("slot.key === 'pilot' ? null"), true);
check('no Discard Card in a slot list', /!isDiscardCard\(c\) \|\| c\.id === chosen/.test(mb), true);
check('no zero-cost Mode face in a slot list', /!isModeFace\(c\) \|\| c\.id === chosen/.test(mb), true);
check('a missing Torso, Chassis or Arm is refused', mb.includes("m.torso ? '' : 'a Torso'") && mb.includes("m.chasis ? '' : 'a Chassis'"), true);

// ---------- the acts the markup emits, handled on both sides ----------
for (const act of ['build-slot', 'build-clear', 'build-rename', 'card']) {
  check(`the builder emits ${act}`, mb.includes(`data-act="${act}"`), true);
  check(`...and the tabletop handles it`, roster.includes(`case '${act}'`), true);
  check(`...and the pad handles it`, pad.includes(`case '${act}'`), true);
}

// ---------- its stylesheet reaches both ----------
check('partpicker.css imports the builder\'s styles', read('../src/partpicker.css').includes("@import './mechbuilder.css';"), true);
check('the board loads partpicker.css', read('../src/styles.css').includes("@import './partpicker.css';"), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
