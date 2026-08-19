// Card 547_B, H2-B "Crisis" II "Attack Mode" — the reader, and the three
// readers agreeing.
//   "[Offensive Stance] when this mech gains an Action Opportunity, may gains
//   another 1 Action Tick." The Tick economy is pinned in ticks.test.mjs and
//   the command gate in commands.test.mjs; what this file covers is the two
//   things neither of those can see.
//
//   FIRST, the reader against the real card. The bare Chinese says 时点, which
//   names no class of Tick; the printed English and the structured
//   `actionPoints: 1` both say ORDINARY. Read as an Extra Tick it would refuse
//   to pay for a Medium Action (3.4.5) and would wrongly license repeating an
//   Action already performed (FAQ K2/K12). So the reader is driven off
//   cards.json, and a regenerated bundle that loses a field fails here.
//
//   SECOND, that commands.ts, matchhud.ts and playguide.ts reach the same
//   verdict. They share no code for this surface — the plan says so in as many
//   words — so a rule enforced in one is a row that refuses in the HUD and
//   succeeds in the guide, or worse the other way round.
import { readFileSync, writeFileSync } from 'node:fs';

const unitsSrc = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
const slice = (from, to, what) => {
  const a = unitsSrc.indexOf(from);
  const b = unitsSrc.indexOf(to, a);
  if (a < 0 || b < 0 || b < a) throw new Error(`could not locate ${what}`);
  return unitsSrc.slice(a, b);
};
const reader = slice(
  '// ---------- Attack Mode (H2-B "Crisis" II, card 547) ----------',
  'export interface ExtraActivation',
  'the Attack Mode reader',
);
const tmp = new URL('./_attackmode.slice.ts', import.meta.url);
writeFileSync(
  tmp,
  'type Card = any;\ntype CardAction = any;\ntype GameData = any;\ntype Token = any;\ntype PartSlot = any;\ntype Stance = any;\n'
    // Mirrored rather than sliced: the real tokenCards drags in the whole app,
    // and all this reader asks it for is "which cards is this unit wearing".
    + `function tokenCards(data: any, t: any): any[] {
  if (t.kind === 'mech') {
    return Object.entries(t.mech ?? {}).map(([slot, id]) => ({ slot, card: data.byId.get(id) })).filter((x: any) => x.card);
  }
  return [{ slot: 'main', card: data.byId.get(t.cardId) }].filter((x: any) => x.card);
}
`
    + reader,
);
const { opportunityBonusOf, opportunityBonusOn } = await import(tmp.href);

const raw = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
const cards = Array.isArray(raw) ? raw : raw.cards ?? [];
const byId = new Map(cards.map((c) => [String(c.id), c]));
const data = { byId };
const common = JSON.parse(readFileSync(new URL('../../data/common_actions.json', import.meta.url), 'utf8'));

const read = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const commands = read('commands.ts');
const hud = read('matchhud.ts');
const guide = read('playguide.ts');
const ticks = read('ticks.ts');
const types = read('types.ts');

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Attack Mode — card 547_B\n');

// ---------- the reader, against the real card ----------

const crisis = byId.get('547');
const attack = (crisis?.actions ?? []).find((a) => a.id === '547_B');
check('the Crisis torso is in the data with its passive', [!!crisis, attack?.name?.en], [true, 'Attack Mode']);
// The printed English is the authority on which class of Tick this is.
check('the English says "Action Tick", not "Extra Tick"',
  [/another 1 Action Tick/i.test(attack.description?.en ?? ''), /Extra/i.test(attack.description?.en ?? '')],
  [true, false]);

const bonus = opportunityBonusOf(attack);
check('the reader finds it', !!bonus, true);
check('it grants exactly 1 ordinary Action Tick', bonus.actionPoints, 1);
check('it is gated on Offensive Stance', bonus.stance, 'offensive');
// The card prints "may", so it must be OFFERED. A Tick nobody wants is a real
// possibility: it cannot be handed back, and taking it sets the Stance.
check('it is optional', bonus.optional, true);
check('it is labelled with the printed Action name', bonus.label, 'Attack Mode');

// Exactly one card of the 401 carries the effect, which is why a reader keyed
// on it can be this direct. A second one appearing is not a bug, but it is a
// reason to come back and re-read this file.
const carriers = cards.filter((c) => (c.actions ?? []).some((a) => !!opportunityBonusOf(a))).map((c) => String(c.id));
check('exactly one card carries action_opportunity_bonus', carriers, ['547']);
check('the reader is silent on the same card\'s other Action',
  opportunityBonusOf((crisis.actions ?? []).find((a) => a.id === '547_A')), undefined);

// ---------- and off a real loadout ----------

const wearing = (loadout, partStates) => ({
  uid: 1, side: 's1', kind: 'mech', stance: 'offensive', mech: loadout, partStates,
});
check('a Mech wearing the Crisis torso carries the bonus',
  opportunityBonusOn(data, wearing({ torso: '547' }, { torso: 'intact' }))?.actionPoints, 1);
check('a Mech wearing something else does not',
  opportunityBonusOn(data, wearing({ torso: '546' }, { torso: 'intact' })), undefined);
// tokenCards lists the wrecked Parts too, so the destroyed test has to be made
// by the reader. A blown Torso is academic — the Mech is dead — but the reader
// is keyed on an effect, not on a slot, and a reprint could put it anywhere.
check('a destroyed Part prints no rules',
  opportunityBonusOn(data, wearing({ torso: '547' }, { torso: 'destroyed' })), undefined);

// ---------- NOT routed through the common-action tables ----------
//
// Overload and the two Extra Tick grants are listed in common_actions.json,
// and the obvious-looking move was to add 547 beside them. It is wrong twice
// over: extraTicks mints an EXTRA Tick, which pays for one Short Action alone,
// and the overload table is keyed to a Link spend this card does not make.
const listed = [...(common.extraTicks ?? []), ...(common.overload ?? [])].map((g) => g.actionId);
check('547_B is in neither common-action table', listed.includes('547_B'), false);
check('and the engine never reads it as an Extra Tick',
  /extraTicks|extrasFor|spentExtras/.test(ticks.slice(ticks.indexOf('function canAttackMode'), ticks.indexOf('function spendManeuver'))), false);
// The grant itself: ordinary Action Ticks, straight into the base pool.
check('the grant adds to the base Action pool',
  /return \{ \.\.\.o, action: o\.action \+ points, attackMode: true \};/.test(ticks), true);

// ---------- the whitelist ----------
//
// normaliseOpportunity is a WHITELIST and has already shipped one bug this way
// (preMoved). A banked flag it does not name is dropped on every rehydrate,
// network round trip and rollback — and this one dropped means the Tick can be
// taken again, and again.
const norm = types.slice(types.indexOf('export function normaliseOpportunity'), types.indexOf('export interface ScriptState'));
check('normaliseOpportunity was located', norm.includes('preMoved'), true);
check('and it carries attackMode through', /attackMode: o\.attackMode === true \? true : undefined,/.test(norm), true);

// ---------- three readers, one verdict ----------

check('the command exists', /\| \{ kind: 'attackMode'; seat: Side; uid: number \}/.test(commands), true);
// The rule lives in check(), never in a disabled button.
const gate = commands.slice(commands.indexOf("case 'attackMode': {"), commands.indexOf("case 'playTactic': {"));
check('check() asks the reader which Part offers it', /opportunityBonusOn\(data, t\)/.test(gate), true);
check('and hands the Stance to the tick engine', /canAttackMode\(o, t\.stance, bonus\.stance\)/.test(gate), true);
// THE anti-abuse mechanism: taking the Tick IS the Stance choice, the same
// reasoning Reboot runs on (4.1.1). With it, "flip to Offensive, bank the
// Tick, flip to Mobility, act" is refused by setStance's existing 4.1 gate, so
// nothing revokes the Tick and nothing re-checks the Stance later.
const applied = commands.slice(commands.lastIndexOf("case 'attackMode': {"), commands.lastIndexOf("case 'playTactic': {"));
check('apply() locks the Stance in the same command',
  /sc\.opp = lockStance\(t, spendAttackMode\(o, points\)\);/.test(applied), true);
check('and no stance arm was added to grantHolds', /check === 'stance'/.test(ticks), false);

for (const [name, src] of [['the Match Centre', hud], ['the play guide', guide]]) {
  check(`${name} asks the same reader`, /opportunityBonusOn\(/.test(src), true);
  check(`${name} asks the same verdict function`, /canAttackMode\(o, t\.stance, bonus\.stance\)/.test(src), true);
  check(`${name} sends the command`, /kind: 'attackMode', seat: t\.side, uid: t\.uid/.test(src), true);
  // Warn, don't block: the refusal is shown, never baked into a dead button.
  check(`${name} shows the refusal rather than disabling the row`,
    /disabled[^\n]*attackmode|attackmode[^\n]*disabled/.test(src), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
