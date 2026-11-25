// The UN list's 1.04 V2 changes, applied 2026-11-03 (OTTO: "the company released
// a revised parts list 1.04 for UN"; see Project-Documents/PUBLISHER-1.04-CHANGES.md,
// "UN 1.04 V2"). Against the first 1.04 list: the TM39D "Cobra" Tactical Core
// costs 69 (was 63), has Electronic 5 (was 3) and Ammo 6 on Launch Snake Eyes
// (was none); two new parts, the IGX750 Ion Rifle (with its discard face) and
// the JP3S Stealth Jetpack. Each new rule is checked against a real card that
// prints the same words, so a reader keyed on the wrong id fails here.
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { installDom } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('UN 1.04 V2: the Cobra and two new parts\n');

installDom();
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const entry = new URL('./_update104v2.entry.ts', import.meta.url);
const out = new URL('./_update104v2.bundle.mjs', import.meta.url);
writeFileSync(entry, "export { loadData } from '../src/data';\n"
  + "export { twoHandedAdjusted, chargeAdjusted, consumesCharge, isAirborneAction } from '../src/units';\n"
  + "export * as R from '../src/refcards';\n");
await build({
  entryPoints: [fileURLToPath(entry)], outfile: fileURLToPath(out),
  bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': '"/"' },
});
const U = await import(`${out.href}?t=${Date.now()}`);
rmSync(entry); rmSync(out);
const data = await U.loadData();
U.R.useCardData?.(data);
const card = (id) => data.byId.get(id);
const act = (id) => (card(id.replace(/_[A-Z]$/, ''))?.actions ?? []).find((a) => a.id === id);

// ---------- the Cobra ----------
const cobra = card('TM39D');
check('the Cobra costs 69 with Electronic 5', [cobra.score, cobra.electronic], [69, 5]);
check('its other stats are as before', [cobra.armor, cobra.structure, cobra.dodge], [3, 3, 1]);
check('Launch Snake Eyes carries 6 Ammo; Ambush has none', [act('TM39D_B').storage, act('TM39D_A').storage], [6, 0]);

// ---------- the IGX750 Ion Rifle ----------
const rifle = card('IGX750'), face = card('IGX750-T');
check('the IGX750 is a UN right arm at the list\'s numbers',
  rifle && [rifle.category, rifle.type, data.factionOf(rifle), rifle.score, rifle.armor, rifle.dodge, rifle.throwIndex],
  ['mech_part', 'rightHand', 'UN', 54, 3, 0, 'IGX750-T']);
const shot = act('IGX750_A');
check('Single Shot: Medium Firing, 3 yellow 2 red, Range 8',
  shot && [shot.type, shot.size, shot.yellowDice, shot.redDice, shot.range], ['Firing', 'm', 3, 2, 8]);
check('[Two-Handed] adds 2 Range, as on the R6 SMG (109), and only when designated',
  [U.twoHandedAdjusted(shot, true).range, U.twoHandedAdjusted(shot, false).range,
    U.twoHandedAdjusted(act('109_A'), true).range - act('109_A').range], [10, 8, 2]);
check('[Charged] spends a Charge for Mutilation, as on the IGX920 (122)',
  [U.consumesCharge(shot), U.consumesCharge(act('122_A')),
    (U.chargeAdjusted(shot, true).keywords ?? []).some((k) => /毁伤|Mutilation/.test(k.key ?? k.inline ?? k.en ?? ''))],
  [true, true, true]);
check('the discard face is Freehand with no Actions and no points',
  face && [face.type, data.factionOf(face), face.score, face.armor, (face.actions ?? []).length, face.keywords.map((k) => k.en)],
  ['rightHand', 'UN', 0, 3, 0, ['Freehand']]);

// ---------- the JP3S Stealth Jetpack ----------
const pack = card('JP3S'), jump = act('JP3S_A');
check('the JP3S is a UN Backpack at the list\'s numbers',
  pack && [pack.category, pack.type, data.factionOf(pack), pack.score, pack.armor, pack.dodge], ['mech_part', 'backpack', 'UN', 54, 2, 2]);
check('Short Jump: a Short Move of 3, Airborne like the JP1\'s Long Jump',
  jump && [jump.type, jump.size, jump.range, U.isAirborneAction(jump), U.isAirborneAction(act('088_A'))], ['Moving', 's', 3, true, true]);
check('and it prints Silence', /Silence/.test(jump.description.en) && jump.keywords.some((k) => k.inline === '静默'), true);

// ---------- the changelog ----------
const log = data.changelog;
// OTTO 2026-11-03: V2 is filed under 1.04, not its own revision; each line says V2 in its note.
check('V2 is not a revision of its own', log.versions.map((v) => v.id), ['1.02', '1.021', '1.04']);
check('the Cobra\'s lines: points, Electronic, Ammo',
  log.cards.TM39D.filter((e) => e.note === 'UN 1.04 V2 list (2026-11-03)').map((e) => `${e.v} ${e.field} ${e.from}>${e.to}`), ['1.04 score 63>69', '1.04 electronic 3>5', '1.04 ammo null>6']);
check('both new parts say they are new on the UN list',
  ['IGX750', 'JP3S'].map((id) => log.cards[id].map((e) => `${e.v} ${e.kind} ${e.list}`)), [['1.04 added UN'], ['1.04 added UN']]);
const block = U.R.changelogBlock(cobra);
check('the Cobra\'s Changelog reads Changed in 1.04, notes V2 and shows the Ammo row',
  [/Changed in 1\.04</.test(block) && /UN 1\.04 V2 list \(2026-11-03\)/.test(block), /<span class="log-tag">Ammo<\/span><span class="log-pair"><s><span class="log-none">none<\/span><\/s> → <b>6<\/b>/.test(block),
    /UN parts list 1\.04</.test(block)], [true, true, true]);
check('a new part reads New in 1.04', /New in 1\.04</.test(U.R.changelogBlock(rifle)), true);
const unRows = U.R.changelogGroups('1.04').filter((g) => g.title === 'Cards' && g.fac === 'UN').flatMap((g) => g.items.map((i) => i.name));
check('the Rules tab\'s 1.04 changelog lists the three cards under UN',
  ['IGX750 Ion Rifle', 'JP3S Stealth Jetpack', 'TM39D "Cobra" Tactical Core'].map((n) => unRows.includes(n)), [true, true, true]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
