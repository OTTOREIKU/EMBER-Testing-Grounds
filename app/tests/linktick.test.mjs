// FPA-04-2 Hammerhead Domestic Expert (FAQ L2): "[Offensive Stance] During
// piloted Mech's Action Opportunity, piloted Mech may consume up to 1 Link and
// gain 1 Action Tick." An ordinary Action Tick bought with Link, like Overload;
// L2 pins that the Stance comes first, then the declaration. The reader runs
// against the shipped card; the command-layer gates are pinned by source.
import { readFileSync, writeFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Domestic Expert: Link for an Action Tick\n');

const units = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
const from = units.indexOf('// ---------- Link for a Tick');
const to = units.indexOf('export interface ExtraActivation');
if (from < 0 || to <= from) throw new Error('could not locate linkTickTraitOn in units.ts');
const tmp = new URL('./_linktick.slice.ts', import.meta.url);
writeFileSync(tmp, `type GameData = any; type Token = any; type Stance = any;
function pilotCard(data: any, t: any): any { return t.kind === 'mech' && t.mech?.pilot ? data.byId.get(t.mech.pilot) : undefined; }
` + units.slice(from, to));
const { linkTickTraitOn } = await import(tmp.href);

const raw = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
const cards = Array.isArray(raw) ? raw : raw.cards;
const data = { byId: new Map(cards.map((c) => [c.id, c])) };
const mech = (pilot) => ({ uid: 1, kind: 'mech', label: 'M1', stance: 'offensive', mech: { torso: '014', pilot }, partStates: { torso: 'intact' } });

const trait = linkTickTraitOn(data, mech('FPA-04-2'));
check('FPA-04-2 carries the trait', !!trait, true);
check('one Link, one Tick, Offensive Stance', [trait?.maxLink, trait?.perLink, trait?.stance], [1, 1, 'offensive']);
check('named after the pilot', trait?.label, 'Hammerhead Domestic Expert');
check('the other Hammerhead (FPA-04 Fierce Assault) has none', linkTickTraitOn(data, mech('FPA-04')), null);
check('a pilotless Mech has none', linkTickTraitOn(data, { uid: 2, kind: 'mech', mech: { torso: '014' }, partStates: {} }), null);
check('a Drone has none', linkTickTraitOn(data, { uid: 3, kind: 'drone', cardId: '550', partStates: { main: 'intact' } }), null);
check('and only this one pilot in the box prints it',
  cards.filter((c) => c.category === 'pilot' && (c.traitEffects ?? []).some((e) => e.type === 'action_opportunity_link_to_action_point')).map((c) => c.id), ['FPA-04-2']);

// ---------- the command, by source ----------
const cmds = readFileSync(new URL('../src/commands.ts', import.meta.url), 'utf8');
const types = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const hud = readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8');
const guide = readFileSync(new URL('../src/playguide.ts', import.meta.url), 'utf8');
check('linkTick is a unit command', /\| \{ kind: 'linkTick'; seat: Side; uid: number \}/.test(cmds), true);
const chk = cmds.slice(cmds.indexOf("case 'linkTick': {"), cmds.indexOf("case 'linkTick': {") + 1600);
check('it needs the trait', /const trait = linkTickTraitOn\(data, t\);\s*\n\s*if \(!trait\) return no/.test(chk), true);
check('and the Mech\'s own Opportunity', /const o = oppOf\(state, cmd\.uid\);\s*\n\s*if \(!o\) return no/.test(chk), true);
check('the Stance comes first (FAQ L2)', /if \(trait\.stance && t\.stance !== trait\.stance\)/.test(chk) && /switch Stance first, then declare it \(FAQ L2\)/.test(chk), true);
check('capped by the trait per Opportunity', /\(o\.linkTicks \?\? 0\) >= trait\.maxLink/.test(chk), true);
check('and the last Link is never spent voluntarily (4.10)', /if \(\(t\.link \?\? 0\) < 2\) return no/.test(chk), true);
check('a Shutdown Mech may not', /if \(t\.stance === 'shutdown'\) return no\('A Mech in Shutdown Stance/.test(chk), true);
const app = cmds.slice(cmds.lastIndexOf("case 'linkTick': {"), cmds.lastIndexOf("case 'linkTick': {") + 900);
check('the apply spends the Link and adds an ORDINARY Action Tick',
  /t\.link = Math\.max\(0, \(t\.link \?\? 0\) - 1\);[\s\S]{0,400}?action: o\.action \+ trait\.perLink, linkTicks: \(o\.linkTicks \?\? 0\) \+ 1/.test(app), true);
check('and locks the Stance the trait asked for', /sc\.opp = lockStance\(t, \{ \.\.\.o, action: o\.action \+ trait\.perLink/.test(app), true);
check('the count survives a rehydrate', /linkTicks: typeof o\.linkTicks === 'number' && o\.linkTicks > 0 \? o\.linkTicks : undefined,/.test(types), true);
check('the Match Centre offers it beside Overload', /data-act="linktick"/.test(hud) && /\$\{ovlRow\}\s*\n\s*\$\{linkRow\}/.test(hud), true);
check('through the command\'s own verdict', /ctx\.check\(\{ kind: 'linkTick', seat: t\.side, uid: t\.uid \}\)/.test(hud), true);
check('and the guide too', /data-linktick="1"/.test(guide) && /check\(this\.data, s, \{ kind: 'linkTick', seat: t\.side, uid: t\.uid \}\)/.test(guide), true);
check('with a handler on each', /on\('\[data-act="linktick"\]'/.test(hud) && /private tryLinkTick\(\)/.test(guide), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
