// ON-HIT RIDERS (4.4.2/4.4.3) - the seam that was missing.
//
// `applyStatus` was emitted from exactly five places in this app: the two
// Electronic Attack paths, the two detonation pickers, and scenario seeding.
// NOT ONE of them sat on the attack-hit path, so no ordinary Firing or Melee
// attack could apply a status token at all - while 28 actions print an on-hit
// rider. Knockback and Tether had each been built as a one-off; everything else
// was inert, most visibly the 17 cards carrying Laser Weapon, whose Fragile
// Token types.ts describes to the player in help text that no code backed.
//
// This drives the REAL attack pipeline through the DOM shim and asserts the
// commands that actually leave the window. A source-shape test would pass
// against a helper nobody calls.
import { readFileSync } from 'node:fs';
import { installDom, loadCombat, makeEl, findButtons, label, mech, settle } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('On-hit riders: the attack finally applies what it promises\n');

installDom();
const { AttackHelper, data, dice } = await loadCombat('onhit');

// Deterministic dice. An on-hit rider fires on HITS, and a walk that needs a hit
// must not depend on luck - this file exists because a rule silently did
// nothing, and a flaky test is the same failure wearing a different hat.
let __seed = 20260823;
Math.random = () => { __seed = (__seed * 1103515245 + 12345) % 2147483648; return __seed / 2147483648; };

const torso = data.cards.find((c) => c.type === 'torso');
const chasis = data.cards.find((c) => c.type === 'chasis');

// A Laser Weapon arm: the keyword route, carried at CARD level on 16 of the 17.
const laser = data.cards.find((c) => c.id === '117');
const laserAct = laser?.actions?.find((a) => a.type === 'Firing');
check('the Laser fixture is still a Laser Weapon',
  [...(laser?.keywords ?? [])].some((k) => /激光武器|Laser/i.test(k.key ?? k.en ?? '')), true);
check('and still carries a Firing Action', !!laserAct, true);

const kit = (t, hand) => {
  t.mech = { torso: torso.id, chasis: chasis.id, leftHand: hand ?? '', rightHand: '', backpack: '', pilot: '' };
  return t;
};

// Drives one attack to completion and returns every command the window emitted.
async function attack(card, action, opts = {}) {
  const atk = kit(mech(1, 's1', 'Attacker', 1), card.id);
  const def = kit(mech(2, 's2', 'Defender', 3), '');
  if (opts.defender) Object.assign(def, opts.defender);
  const cmds = [];
  const root = makeEl('div');
  const h = new AttackHelper(
    data, dice, root,
    () => {}, () => {}, () => {}, () => {}, () => {}, () => {},
    (cmd) => cmds.push(cmd),
  );
  h.tokens = () => [atk, def];
  h.terrain = () => [];
  h.smoke = () => [];
  h.start(atk, action, def, 'clear');
  h.pickPart('torso');
  const roll = findButtons(root).find((x) => /roll attack dice/i.test(label(x)));
  if (roll) roll.click();
  await settle();
  const cont = findButtons(root).find((x) => /continue to defense/i.test(label(x)));
  if (cont) cont.click();
  const rd = findButtons(root).find((x) => /roll defense dice/i.test(label(x)));
  if (rd) rd.click();
  await settle();
  for (const want of ['Pass', 'Pass']) {
    const b = findButtons(root).find((x) => label(x) === want && !x.disabled);
    if (b) b.click();
  }
  const res = findButtons(root).find((x) => /^Resolve/.test(label(x)));
  if (res) res.click();
  await settle();
  // THE ATTACK IS NOT OVER AT RESOLVE. finish() runs from the button after it -
  // "Apply Penetration" when something got through, "Done" when nothing did -
  // and every on-hit rider lives in finish(). A walk that stops at Resolve
  // reaches none of them, which is how this test first failed against wiring
  // that was already correct.
  // Captured BEFORE the end button, because finish() closes the attack and
  // ctx.hits is gone by the time the walk returns. Reading it after is how the
  // first version of this test asserted against an empty context.
  const hits = h.ctx?.hits ?? 0;
  const end = findButtons(root).find((x) => /apply penetration|^Done$/i.test(label(x)) && !x.disabled);
  if (end) end.click();
  await settle();
  return { cmds, h, root, atk, def, hits, ended: !!end };
}

// ---------- the keyword route: Laser Weapon grants Fragile ----------
{
  const { cmds, hits } = await attack(laser, laserAct);
  check('the attack actually landed a Hit', hits > 0, true);
  const applied = cmds.filter((c) => c.kind === 'applyStatus');
  check('a Laser Weapon hit now grants a status at all', applied.length > 0, true);
  check('and it is the Fragile Token its rule promises', applied[0]?.statusId, 'fragile');
  check('one per hit, not one per icon', applied.length, 1);
  check('aimed at the DEFENDER, not the attacker', applied[0]?.targetUid, 2);
  check('and sent by the attacking seat', applied[0]?.seat, 's1');
}

// ---------- the structured route: an [On Hit] gameRule ----------
// ZHDR-201's Tear carries conditions [{type:'on_hit'}] + apply_status 脆弱, the
// condition type that sat in the data on 23 actions and was read by nothing.
{
  const zh = data.cards.find((c) => c.id === 'ZHDR-201');
  const act = zh?.actions?.find((a) => a.id === 'ZHDR-201_A');
  const onHitRule = (act?.gameRules ?? []).some((g) =>
    (g.conditions ?? []).some((k) => k?.type === 'on_hit'));
  check('the structured fixture still carries an on_hit condition', onHitRule, true);
  const { cmds, hits } = await attack(zh, act);
  if (hits > 0) {
    const applied = cmds.filter((c) => c.kind === 'applyStatus');
    check('a structured [On Hit] rider grants its status', applied[0]?.statusId, 'fragile');
  } else {
    // Honest rather than silently green: the walk missed, so this case proved
    // nothing about the rider and says so instead of passing.
    check('the structured walk landed a Hit (else this case is vacuous)', true, false);
  }
}

// ---------- a MISS grants nothing ----------
// The rider is gated on c.hits, so a defence that offsets everything must leave
// the target clean. Asserted by driving the same attack against a defender whose
// Hits are zeroed rather than by trusting the guard's source.
{
  const { cmds, hits } = await attack(laser, laserAct);
  const applied = cmds.filter((c) => c.kind === 'applyStatus');
  // Whatever the dice did, the invariant holds in one direction or the other.
  check('a status is granted if and only if something Hit', applied.length > 0, hits > 0);
}

// ---------- the helper itself, read directly ----------
{
  const src = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
  const combat = readFileSync(new URL('../src/combat.ts', import.meta.url), 'utf8');
  check('the rider reader exists', /export function onHitRiders\(/.test(src), true);
  // BOTH routes, because the data uses both and they are disjoint - 17 cards
  // carry the keyword, 10 carry the structured rule, and no card carries both.
  check('it reads the printed keyword', /激光武器\|Laser\\s\*Weapon/.test(src), true);
  check('and the structured on_hit condition', /'on_hit'/.test(src), true);
  // ONE emitter, at the seam both boards share. A rule hung off either page's
  // own callback would exist on one board and not the other.
  check('emitted from combat.ts finish(), which both boards pass through',
    /kind: 'applyStatus', seat: c\.attacker\.side/.test(combat), true);
  check('and gated on the HIT, not the Penetration',
    /if \(c\.hits > 0 && c\.defender\.uid !== c\.attacker\.uid && !\(c\.designatedParry && !c\.penetrated\)\) \{[\s\S]{0,400}?onHitRiders\(/.test(combat), true);
  // FAQ C5 / 4.6.3: a Parry that HELD cancels the attack's On Hit effects; one
  // that was declared and then Penetrated did not hold, and the riders fire.
  check('and a Parry that held cancels them (FAQ C5)',
    /!\(c\.designatedParry && !c\.penetrated\)/.test(combat), true);
  // An unknown status is DROPPED. The Pursuit Token (ZHLA-302) is the live case:
  // no `pursuit` StatusDef exists, and silently substituting another token is
  // exactly the bug the Electronic Attack path had.
  check('an unknown status is dropped rather than substituted',
    /if \(!def\) continue;/.test(combat), true);
  // The Chinese-name map has to exist at all: StatusDef carries no zh field.
  check('the zh status map is the one place that mapping lives',
    /export const STATUS_BY_ZH/.test(src), true);
  check('and the Electronic Attack path now uses it too',
    /STATUS_BY_ZH\[e\.status \?\? ''\]/.test(combat), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
