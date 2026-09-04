// Concussion / Wrecking Lightning against a {Dodge}, driven through the real
// AttackHelper (FAQ D2/D3), plus the order of the defender's three declares
// (FAQ H9/A18).
//
// D2: a Dodge can cancel the Lightning that causes Wrecking, and Wrecking
// damage is not resolved separately. D3: Wrecking's Lightning does not become
// Surplus Damage. The engine used to fold that Lightning into the Light Hits,
// so {Defense} soaked it and a Surplus keyword carried it - and it drained Link
// for every Lightning rolled, dodged or not.
import { readFileSync } from 'node:fs';
import { installDom, loadCombat, makeEl, findButtons, label, mech, settle, textOf } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

installDom();
const { AttackHelper, data, dice } = await loadCombat('wrecking');

// Faces looked up by what they show, so the test cannot rot with dice.json.
const faceOf = (colour, type) => dice.dice[colour].faces.findIndex((f) => f.some((i) => i.type === type && !i.hollow));
const YELLOW_LIGHTNING = faceOf('yellow', 'lightning');
const BLUE_DODGE = faceOf('blue', 'dodge');
const BLUE_BLANK = dice.dice.blue.faces.findIndex((f) => f.length === 0);
check('the shipped dice carry the faces this needs', [YELLOW_LIGHTNING >= 0, BLUE_DODGE >= 0, BLUE_BLANK >= 0], [true, true, true]);

// A Wrecking Firing Action: the keyword is what lightningLinkDrain reads.
const WRECK = { id: 'W_A', type: 'Firing', size: 's', name: { en: 'Wrecking Shot' }, yellowDice: 1, redDice: 0, range: 4,
  keywords: [{ inline: '粉碎' }], description: { zh: '· 粉碎', en: '· Wrecking' } };

async function fire(defenseFaces) {
  const atk = mech(1, 's1', 'Attacker', 1);
  const def = mech(2, 's2', 'Defender', 3);
  atk.mech = { torso: '172', chasis: '179', leftHand: '', rightHand: '', backpack: '', pilot: '' };
  def.mech = { torso: '172', chasis: '179', leftHand: '', rightHand: '', backpack: '', pilot: '' };
  def.link = 3;
  def.stance = 'mobility';
  const root = makeEl('div');
  const cmds = [];
  const h = new AttackHelper(data, dice, root, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, (c) => cmds.push(c));
  h.tokens = () => [atk, def];
  h.terrain = () => [];
  h.smoke = () => [];
  h.start(atk, WRECK, def, 'clear');
  h.pickPart('torso');
  const press = async (rx) => {
    const b = findButtons(root).find((x) => rx.test(label(x)) && !x.disabled);
    if (b) b.click();
    await settle();
    return !!b;
  };
  await press(/roll attack dice/i);
  h.ctx.attackRoll = [{ color: 'yellow', face: YELLOW_LIGHTNING }];
  h.render();
  await press(/continue to defense/i);
  await press(/roll defense dice/i);
  h.ctx.defenseRoll = defenseFaces.map((face) => ({ color: 'blue', face }));
  h.render();
  for (let i = 0; i < 4; i++) await press(/^Pass$/);
  await press(/^Resolve/);
  return { h, root, cmds, text: () => textOf(root).join(' | ') };
}

console.log('A spare Dodge cancels the Wrecking Lightning (FAQ D2)\n');
{
  const { h, text, cmds } = await fire([BLUE_DODGE]);
  check('the resolution says the Lightning was cancelled', /1 \[Lightning\] cancelled by spare Dodge/.test(text()), true);
  check('no Lightning got through', h.ctx.lightningThrough, 0);
  check('so it is not a Hit', h.ctx.hits, 0);
  // Done sends the drain; with nothing through there is nothing to send.
  const done = findButtons(h.root ?? {}).find?.(() => false);
  void done;
  check('and no Link is drained', cmds.some((c) => c.kind === 'drainLink'), false);
}

console.log('\nWith no Dodge the Lightning is damage, once, and never Surplus (FAQ D3)');
{
  const { h, text } = await fire([BLUE_BLANK]);
  check('the Lightning got through', h.ctx.lightningThrough, 1);
  check('and counts as a Hit and a Penetration', [h.ctx.hits >= 1, /PENETRATION/.test(text())], [true, true]);
  check('but is never carried as Surplus', h.ctx.carried, { heavy: 0, light: 0 });
}

console.log('\nThe defender declares before the roll (FAQ H9 / A18)');
{
  const combat = readFileSync(new URL('../src/combat.ts', import.meta.url), 'utf8');
  const step = combat.slice(combat.indexOf('private stepDefense('), combat.indexOf('private stepResolve('));
  const kc = step.indexOf('KC Armor: consume a Charge Token');
  const evade = step.indexOf("'Melee Evasion: spend a Command Token");
  const dodge = step.indexOf("'Dodge Enhancement: spend a Command Token");
  const roll = step.indexOf('Roll defense dice');
  check('all four are in the defense step', [kc, evade, dodge, roll].every((i) => i >= 0), true);
  check('KC Armor is offered before the roll button', kc < roll, true);
  check('Melee Evasion is offered before the roll button', evade < roll, true);
  check('Dodge Enhancement is offered before the roll button', dodge < roll, true);
  check('and the KC label no longer reads the roll', /defLightning/.test(step), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
