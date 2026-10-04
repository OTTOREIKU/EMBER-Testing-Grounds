// The UN list's 1.04 changes, applied 2026-09-30 (Phase 4 of
// Project-Documents/PUBLISHER-1.04-CHANGES.md): its prices, Direct Fire on the
// two Deploying Backpacks, and the two pilots the list adds, with their traits
// wired. The PD and RDL prices are pinned by changelog.test.mjs.
//
// Each pilot rule is asserted in BOTH directions, with a real pilot as the
// control: a reader keyed on the wrong id passes a one-sided test.
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { installDom } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('UN 1.04: prices, Direct Fire, and the two new pilots\n');

installDom();
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const entry = new URL('./_update104.entry.ts', import.meta.url);
const out = new URL('./_update104.bundle.mjs', import.meta.url);
writeFileSync(entry, "export { loadData } from '../src/data';\n"
  + "export { volleyFor, volleyOf, ignoresProtection, needsSightToLanding, PILOT_OPAL, PILOT_TOURMALINE } from '../src/units';\n");
await build({
  entryPoints: [fileURLToPath(entry)], outfile: fileURLToPath(out),
  bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': '"/"' },
});
const U = await import(`${out.href}?t=${Date.now()}`);
rmSync(entry); rmSync(out);
const data = await U.loadData();
const card = (id) => data.byId.get(id);
const act = (id) => (card(id.replace(/_[A-Z]$/, ''))?.actions ?? []).find((a) => a.id === id);

// ---------- prices ----------
check('UN Torsos cost their 1.04 prices',
  ['092', '096', '097', '098', '247'].map((id) => card(id).score), [45, 78, 63, 51, 78]);
check('the LM210S and its Trial Model: 33', ['100', '250'].map((id) => card(id).score), [33, 33]);
check('the Wakizashi and both Trial Models go UP to 30', ['126', '256', '257'].map((id) => card(id).score), [30, 30, 30]);
check('the JP5 drops 18 and the Meteor 12', [card('538').score, card('540').score], [42, 57]);
check('the Tarantula Carrier goes up to 18', card('162').score, 18);
check('Onyx Mellow Chord costs 18; plain Onyx is unchanged', [card('LPA-23-2').score, card('LPA-23').score], [18, 21]);

// ---------- Direct Fire on the two Deploying Backpacks ----------
check('the Turtle Shell Rack prints Direct Fire', /^· Direct Fire\n/.test(act('084_A').description.en), true);
check('the Delphinium Carrier prints Direct Fire', /^· Direct Fire\n/.test(act('085_A').description.en), true);
check('so both Deploys need sight to their landing Grid',
  [U.needsSightToLanding(act('084_A')), U.needsSightToLanding(act('085_A'))], [true, true]);
check('and the card backs carry the reminder',
  ['084', '085'].map((id) => /Direct Fire: This action requires visual/.test(card(id).description?.en ?? '')), [true, true]);

// ---------- the two pilots ----------
const opal = card(U.PILOT_OPAL), tour = card(U.PILOT_TOURMALINE);
check('Opal is a UN pilot at the list\'s numbers',
  opal && [opal.category, data.factionOf(opal), opal.score, opal.LV, opal.swift, opal.melee, opal.projectile, opal.firing, opal.moving, opal.tactic],
  ['pilot', 'UN', 18, 4, 4, 5, 7, 3, 8, 4]);
check('Tourmaline is a UN pilot at the list\'s numbers',
  tour && [tour.category, data.factionOf(tour), tour.score, tour.LV, tour.swift, tour.melee, tour.projectile, tour.firing, tour.moving, tour.tactic],
  ['pilot', 'UN', 21, 4, 6, 4, 5, 2, 3, 3]);
check('each trait has its name, so the trait block shows it', [opal.trait, tour.trait], ['Bondage', 'Shadow']);
check('neither is boxed yet', [opal.containedIn ?? null, tour.containedIn ?? null], [null, null]);

const mech = (pilot, uid = 7) => ({ kind: 'mech', uid, side: 's1', mech: { pilot }, statuses: [], partStates: {} });
const deploy = act('084_A');
const volley2 = act('ZHLA-102_A');

// Opal, Bondage
check('Opal at Projectile Timing: a Projectile Action with no Volley counts as Volley 2',
  U.volleyFor(data, mech(U.PILOT_OPAL), deploy, { timing: 'projectile' }), 2);
check('at any other timing it is the printed 1',
  U.volleyFor(data, mech(U.PILOT_OPAL), deploy, { timing: 'firing' }), 1);
check('with no Opportunity it is the printed 1', U.volleyFor(data, mech(U.PILOT_OPAL), deploy, null), 1);
check('another pilot at Projectile Timing gets 1', U.volleyFor(data, mech('LPA-23'), deploy, { timing: 'projectile' }), 1);
check('a printed Volley stands, for Opal too',
  U.volleyFor(data, mech(U.PILOT_OPAL), volley2, { timing: 'projectile' }), U.volleyOf(volley2));

// Tourmaline, Shadow
const defender = { kind: 'mech', uid: 9, side: 's2', statuses: [], partStates: {} };
const still = { uid: 7, moved: false, maneuvered: false };
check('Tourmaline, Stationary: the target\'s protection does not apply',
  U.ignoresProtection(data, mech(U.PILOT_TOURMALINE), defender, still), true);
check('not after a Maneuver', U.ignoresProtection(data, mech(U.PILOT_TOURMALINE), defender, { ...still, maneuvered: true }), false);
check('not after a Movement Action', U.ignoresProtection(data, mech(U.PILOT_TOURMALINE), defender, { ...still, moved: true }), false);
check('not where no Opportunity is tracked', U.ignoresProtection(data, mech(U.PILOT_TOURMALINE), defender, null), false);
check('not on another unit\'s Opportunity', U.ignoresProtection(data, mech(U.PILOT_TOURMALINE), defender, { ...still, uid: 8 }), false);
check('another pilot standing still keeps the protection', U.ignoresProtection(data, mech('LPA-23'), defender, still), false);

// ---------- every reader asks the shared questions ----------
const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const calls = (f, name) => (src(f).match(new RegExp(`\\b${name}\\(`, 'g')) ?? []).length;
check('the attack window asks ignoresProtection at both of its doors', calls('src/combat.ts', 'ignoresProtection'), 2);
check('freeplay, the Match Centre board and its target list ask it too',
  // The target list's reading and the attack's opening are turn.ts
  // attackReading and attackOpening since 2026-10-01; the Match Centre asks them.
  [calls('src/main.ts', 'ignoresProtection'), calls('src/match.ts', 'ignoresProtection'), calls('src/turn.ts', 'ignoresProtection')], [1, 0, 2]);
check('and nothing outside units.ts asks the old Highlight-only question',
  ['src/combat.ts', 'src/main.ts', 'src/match.ts', 'src/matchhud.ts'].map((f) => calls(f, 'ignoresProtectionOnHighlight')), [0, 0, 0, 0]);
// The Match Centre's count is turn.ts launchShots since 2026-10-01.
check('every launch reader sizes the volley with volleyFor',
  [...['src/commands.ts', 'src/main.ts', 'src/turn.ts', 'pad/pad.ts'].map((f) => [calls(f, 'volleyFor') > 0, calls(f, 'volleyOf')]),
    [calls('src/matchhud.ts', 'turn.launchShots') > 0, calls('src/matchhud.ts', 'volleyOf')]],
  [[true, 0], [true, 0], [true, 0], [true, 0], [true, 0]]);
check('the attack window is handed the running Opportunity on both boards',
  [/attackHelper\.opportunity = \(\) => state\.script\?\.opp/.test(src('src/main.ts')), /attackHelper\.opportunity = \(\) => state\.script\?\.opp/.test(src('src/match.ts'))], [true, true]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
