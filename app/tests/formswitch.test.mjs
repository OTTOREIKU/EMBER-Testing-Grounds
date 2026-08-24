// The "White Dwarf" Bit's Stance Change (293 / 294 / 295).
//
// The Bit is ONE Drone printed on three cards, one per Stance, and its Swift
// Action swaps which is face up: "Switch the Stance and perform one movement."
// The data declared the whole thing -- `formIds` on every member, and the
// Action carrying `switch_linked_drone_form_and_move` -- and NOTHING READ
// EITHER. A Bit fielded as 293 could never become 295, which is the only form
// carrying Automatic Shield, so a third of the card was unreachable.
//
// The rule that matters most here is what the switch must NOT do: this is the
// same Drone turning its card over, so everything it has collected survives.
// Rebuilding it from the card (which is what Unfold correctly does, being a
// DIFFERENT unit) would hand out a free repair once per round.
import { readFileSync, writeFileSync } from 'node:fs';

const unitsSrc = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
const start = unitsSrc.indexOf('// ---------- FORM SWITCH: the "White Dwarf" Bit');
const end = unitsSrc.indexOf('// A folded Pholcus is owed its replacement');
if (start < 0 || end < 0 || end <= start) throw new Error('could not slice the form-switch readers out of units.ts');
const tmp = new URL('./_formswitch.slice.ts', import.meta.url);
writeFileSync(tmp, `type GameData = any;
type Token = any;
type CardAction = any;
type Card = any;
type Stance = any;
const shortName = (c) => c.name?.en ?? c.id;
const unitSize = (c) => (c.type === 'large' ? 3 : c.type === 'medium' ? 2 : 1);
const isAerial = (c) => !!c.aerial;
const isBarricade = () => false;
` + unitsSrc.slice(start, end));
const U = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('White Dwarf Bit: the form switch that read nothing\n');

// ---------- the reader, against the SHIPPED cards ----------
const rawCards = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
const cards = Array.isArray(rawCards) ? rawCards : rawCards.cards;
const byId = new Map(cards.map((c) => [c.id, c]));
const data = { byId };

for (const id of ['293', '294', '295']) {
  const swap = (byId.get(id)?.actions ?? []).find((a) => U.formSwitch(a));
  check(`${id} has a form-switching Action`, !!swap, true);
  check(`and it names all three forms`, U.formSwitch(swap), ['293', '294', '295']);
}
check('an Action with no such rule reads undefined',
  U.formSwitch({ gameRules: [{ effects: [{ type: 'modify_dice' }] }] }), undefined);
check('and one with no gameRules at all', U.formSwitch({}), undefined);
// The Bit PORT (292) launches and recovers the Bit; it is not itself a form.
check('the Bit Port is not a form switch',
  (byId.get('292')?.actions ?? []).some((a) => U.formSwitch(a)), false);

// ---------- the swap keeps everything the Drone earned ----------
{
  const bit = {
    uid: 7, side: 's1', kind: 'drone', cardId: '293', label: 'Bit', col: 9, row: 12, facing: 2,
    size: 1, aerial: true, stance: 'offensive', deployed: true,
    partStates: { main: 'damaged' },
    ammo: { '293_A': 1 },
    intercept: { '293_A': 2 },
    statuses: ['highlight'],
    commandedBy: 4,
    log: ['it did a thing'],
  };
  U.switchFormTo(data, bit, '295');

  check('the card is turned over', bit.cardId, '295');
  check('and the Stance comes with it', bit.stance, 'defensive');
  check('the label follows the new face', bit.label, byId.get('295').name?.en ?? '295');
  // Everything below is the point of the test: an Unfold would have reset all
  // of it, which on a once-per-round Action is a free repair.
  check('DAMAGE survives the switch', bit.partStates, { main: 'damaged' });
  check('Ammo survives', bit.ammo, { '293_A': 1 });
  check('Interception Tokens survive', bit.intercept, { '293_A': 2 });
  check('Statuses survive', bit.statuses, ['highlight']);
  check('the Command Token holding it survives', bit.commandedBy, 4);
  check('its log survives', bit.log.length, 1);
  check('and it has not moved', [bit.col, bit.row, bit.facing], [9, 12, 2]);
  check('nor changed uid', bit.uid, 7);
}

// ---------- where the rule LIVES ----------
{
  const cmds = readFileSync(new URL('../src/commands.ts', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const hud = readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8');

  check('there is a switchForm command', /kind: 'switchForm'/.test(cmds), true);
  const gate = cmds.slice(cmds.indexOf("case 'switchForm': {"), cmds.indexOf("case 'switchForm': {") + 1400);
  // BOTH ends are checked against the Action's own list. Trusting the wire
  // would let a sender turn a Bit into any card in the database.
  check('the command reads the form set off the ACTION', /formSwitch\(a\)/.test(gate), true);
  check('and refuses a card outside that set', /forms\.includes\(cmd\.cardId\)/.test(gate), true);
  check('and a unit that is not itself one of the forms', /forms\.includes\(t\.cardId\)/.test(gate), true);
  check('and a switch to the Stance it already has', /cmd\.cardId === t\.cardId/.test(gate), true);

  // Both boards offer it, and both follow with the ONE Movement the Action
  // grants rather than leaving the player to find it.
  check('freeplay routes the Action', /if \(formSwitch\(action\)\) \{[\s\S]{0,140}?performFormSwitch/.test(main), true);
  check('and follows the switch with a Movement',
    /performFormSwitch[\s\S]{0,2000}?kind: 'switchForm'[\s\S]{0,600}?startMove\(/.test(main), true);
  check('the Match Centre routes it', /if \(formSwitch\(a\)\) \{\s*\n\s*formPick =/.test(hud), true);
  check('and follows with its own move plan',
    /data-formgo[\s\S]{0,700}?kind: 'switchForm'[\s\S]{0,300}?startMovePlan\(/.test(hud), true);
  // Paid before the switch, so the Movement belongs to the same Action. The
  // window is generous because `data-formgo` appears twice — once in the panel
  // markup and once on the handler — and the match has to start at the second.
  check('the Match Centre pays for the Action first',
    /on\('\[data-formgo\]'[\s\S]{0,700}?commitAction\(ctx\)[\s\S]{0,400}?kind: 'switchForm'/.test(hud), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
