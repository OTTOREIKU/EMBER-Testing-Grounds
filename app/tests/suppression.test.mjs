// SUPPRESSION (glossary, 06_missions_and_appendix.md:437) - built from the zh
// print, which is more precise than the English: a Mech DECLARED AS A TARGET of
// the action immediately switches to Defensive Stance, Shutdown alone immune.
//
// It fires at DESIGNATION, not on a hit - by the time the defence pool is
// suggested, the stance it reads must already have moved. Before this, 压制
// appeared in app/src exactly twice, both in comments naming it as an example
// of a 获得-granted keyword; nothing forced a stance anywhere.
import { readFileSync } from 'node:fs';
import { installDom, loadCombat, makeEl, mech } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Suppression: being declared a target moves the Stance dial\n');

installDom();
const { AttackHelper, data, dice } = await loadCombat('suppression');

const hmg = data.cards.find((c) => c.id === '030');
const hmgAct = hmg?.actions?.find((a) => a.id === '030_A');
check('the HMG still prints Suppression inline',
  (hmgAct?.keywords ?? []).some((k) => /压制/.test(k.inline ?? k.key ?? '')), true);

const torso = data.cards.find((c) => c.type === 'torso');
const chasis = data.cards.find((c) => c.type === 'chasis');
const kit = (t, hand) => {
  t.mech = { torso: torso.id, chasis: chasis.id, rightHand: hand ?? '', leftHand: '', backpack: '', pilot: '' };
  return t;
};

// Opens the attack (designation is the whole event under test) and returns the
// commands the window emitted at that moment.
function declare(action, defOpts = {}) {
  const atk = kit(mech(1, 's1', 'Attacker', 1), hmg.id);
  const def = kit(mech(2, 's2', 'Defender', 3), '');
  Object.assign(def, defOpts);
  const cmds = [];
  const h = new AttackHelper(
    data, dice, makeEl('div'),
    () => {}, () => {}, () => {}, () => {}, () => {}, () => {},
    (cmd) => cmds.push(cmd),
  );
  h.tokens = () => [atk, def];
  h.terrain = () => [];
  h.smoke = () => [];
  h.start(atk, action, def, 'clear');
  return { cmds, h, def };
}

// ---------- the rule fires at the door ----------
{
  const { cmds } = declare(hmgAct, { stance: 'mobility' });
  const sup = cmds.filter((c) => c.kind === 'suppress');
  check('declaring the target sends the suppress', sup.length, 1);
  check('naming the DEFENDER', sup[0]?.targetUid, 2);
  check('from the attacking seat', sup[0]?.seat, 's1');
  check('and it fires at designation, before any dice exist', cmds[0]?.kind, 'suppress');
}

// ---------- the printed exemptions ----------
{
  const { cmds } = declare(hmgAct, { stance: 'shutdown' });
  check('a Shutdown Mech is immune', cmds.filter((c) => c.kind === 'suppress').length, 0);
}
{
  const { cmds } = declare(hmgAct, { stance: 'defensive' });
  check('an already-Defensive Mech has nowhere to switch', cmds.filter((c) => c.kind === 'suppress').length, 0);
}
{
  // An action with no Suppression sends nothing - the ordinary case must be
  // byte-identical to what it was.
  const rifle = data.cards.find((c) => c.id === 'ZHRA-201');
  const plain = rifle?.actions?.find((a) => a.id === 'ZHRA-201_B');
  const { cmds } = declare(plain, { stance: 'mobility' });
  check('a plain attack suppresses nobody', cmds.filter((c) => c.kind === 'suppress').length, 0);
}

// ---------- the reader ----------
{
  const src = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
  check('the reader is a keyword-array read', /export function suppressionOn\(/.test(src), true);
  // The Two-Handed grants (ZHRA-303_B, 038_A) arrive as ADJUSTED inline
  // keywords, which is exactly the shape this asserts the reader accepts.
  const body = src.slice(src.indexOf('export function suppressionOn('), src.indexOf('export function suppressionOn(') + 300);
  check('reading inline and key alike', /k\.inline \?\? k\.key/.test(body), true);
  // And NOT the description, or 556_A's [Charged] grant would fire unpaid.
  check('and never the description, so a Charged grant cannot fire unpaid',
    /description/.test(body), false);
}

// ---------- where it lives ----------
{
  const combat = readFileSync(new URL('../src/combat.ts', import.meta.url), 'utf8');
  const cmds = readFileSync(new URL('../src/commands.ts', import.meta.url), 'utf8');
  // All four designation doors, so a Multi-Target's later targets and a
  // Cleaving's new unit are declared targets too.
  check('every designation door asks it',
    (combat.match(/this\.suppressDeclared\(/g) ?? []).length, 4);
  // The command layer owns the rule: target must be a Mech, Shutdown immune.
  const chk = cmds.slice(cmds.indexOf("case 'suppress': {"), cmds.indexOf("case 'suppress': {") + 600);
  check('the command refuses a non-Mech', /Suppression only moves a Mech/.test(chk), true);
  check('and the Shutdown immunity is the command\'s, not just the button\'s',
    /immune to Suppression/.test(chk), true);
  // Apply writes no stance lock, on provoke's reasoning: 4.1 owns the locking.
  const apply = cmds.slice(cmds.lastIndexOf("case 'suppress': {"), cmds.lastIndexOf("case 'suppress': {") + 700);
  check('the switch writes no invented Stance lock', /lockStance|stanceLock/.test(apply), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
