// DISARM 缴械 (glossary :343) - "Change target Part to Discard State."
//
// One card carries it, 050 the Big Hand Grappler, printing an on-hit CHOICE:
// "[On Hit] Causes Drag or Disarm". The Disarm half flips the TARGET'S hit Part
// to its Discard Card through the 4.17 throwIndex pointer - a lookup
// transformFaces deliberately refuses to make, because widening THAT would let
// players hand-transform all 61 discard faces. So Disarm has its own lookup
// (discardFaceOf) and its own command: transformPart is owner-gated, built for
// the White Dwarf flipping its OWN modes, and the flip Disarm wants is the
// defender's Part from the attacker's seat.
import { readFileSync } from 'node:fs';
import { installDom, loadCombat, makeEl, findButtons, label, mech, settle } from './_combatdrive.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Disarm: the hit Part goes to its Discard Card, as a choice\n');

installDom();
const { AttackHelper, data, dice } = await loadCombat('disarm');

let __seed = 20260823;
Math.random = () => { __seed = (__seed * 1103515245 + 12345) % 2147483648; return __seed / 2147483648; };

const grappler = data.cards.find((c) => c.id === '050');
const hook = grappler?.actions?.find((a) => a.type === 'Melee');
check('050 still prints the choice', /Drag or Disarm/i.test(hook?.description?.en ?? ''), true);
const shield = data.cards.find((c) => c.id === 'ZHLA-301');
check('the shield fixture still points at its Discard Card', shield?.throwIndex, 'ZHLA-301-T');

const torso = data.cards.find((c) => c.type === 'torso');
const chasis = data.cards.find((c) => c.type === 'chasis');
const kit = (t, left) => {
  t.mech = { torso: torso.id, chasis: chasis.id, leftHand: left ?? '', rightHand: '', backpack: '', pilot: '' };
  return t;
};

// One grapple, driven to the terminal screen, hit Part forced to `slot`.
async function grapple(slot, defLeft) {
  const atk = kit(mech(1, 's1', 'Attacker', 1), grappler.id);
  const def = kit(mech(2, 's2', 'Defender', 3), defLeft);
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
  h.start(atk, hook, def, 'clear');
  h.pickPart(slot);
  // The shield is a PARRY part, so hitting it asks the defender's Parry
  // question before any dice exist. Declined - a Successful Parry stops the
  // hits, and a walk that parries would prove nothing about the rider.
  const keep = findButtons(root).find((x) => /^Keep /.test(label(x)));
  if (keep) keep.click();
  for (const want of [/roll attack dice/i, /continue to defense/i, /roll defense dice/i]) {
    const b = findButtons(root).find((x) => want.test(label(x)));
    if (b) b.click();
    await settle();
  }
  for (let i = 0; i < 2; i++) {
    const b = findButtons(root).find((x) => label(x) === 'Pass' && !x.disabled);
    if (b) b.click();
  }
  const res = findButtons(root).find((x) => /^Resolve/.test(label(x)));
  if (res) res.click();
  await settle();
  const hits = h.ctx?.hits ?? 0;
  const end = findButtons(root).find((x) => /apply penetration|^Done$/i.test(label(x)) && !x.disabled);
  if (end) end.click();
  await settle();
  return { cmds, root, hits };
}

// ---------- the offer, and the flip it sends ----------
{
  const { cmds, root, hits } = await grapple('leftHand', shield.id);
  check('the walk landed a Hit (else nothing here is proven)', hits > 0, true);
  const offer = findButtons(root).find((x) => /^Disarm: flip/.test(label(x)));
  check('the terminal screen offers the Disarm', !!offer, true);
  check('as a CHOICE, so nothing was sent before the press',
    cmds.filter((c) => c.kind === 'disarm').length, 0);
  offer.click();
  const sent = cmds.filter((c) => c.kind === 'disarm');
  check('pressing it sends the disarm', sent.length, 1);
  check('for the hit Part', sent[0]?.slot, 'leftHand');
  check('naming the defender', sent[0]?.targetUid, 2);
  check('from the attacking seat', sent[0]?.seat, 's1');
  offer.click();
  check('a second press is not a second flip', cmds.filter((c) => c.kind === 'disarm').length, 2 - 1);
}

// ---------- a Part with no Discard Card cannot be disarmed ----------
{
  const { root, hits } = await grapple('torso', shield.id);
  check('the torso walk landed a Hit too', hits > 0, true);
  check('a torso offers no Disarm button', !!findButtons(root).find((x) => /^Disarm/.test(label(x))), false);
  // But the choice is still SAID, so the table knows the card fired and why
  // only the by-hand half remains.
  const texts = [];
  const walk = (el) => { if (el.textContent) texts.push(String(el.textContent)); for (const ch of el.children ?? []) walk(ch); };
  walk(root);
  check('and the note explains the 4.17 reason', /no Discard Card/.test(texts.join(' ')), true);
}

// ---------- Drag, the other half of the printed OR ----------
// Glossary :344: force the target to a grid adjacent to this Mech and set its
// facing, treated as Flying Movement. It travels as the forceMove command the
// engine already trusts for Knockback, with the landing spot computed by the
// caller exactly as forceMove's own comment demands.
{
  const { cmds, root } = await grapple('leftHand', shield.id);
  const grids = findButtons(root).filter((x) => /^Drag [NSEW]/.test(label(x)));
  check('the terminal screen offers the adjacent grids', grids.length > 0, true);
  const faceBtn = () => findButtons(root).find((x) => /^Face East/.test(label(x)));
  check('but no facing until a grid is picked - the pull needs a destination first',
    (() => { faceBtn().click(); return cmds.filter((c) => c.kind === 'forceMove').length; })(), 0);
  grids[0].click();
  faceBtn().click();
  const fm = cmds.filter((c) => c.kind === 'forceMove');
  check('grid then facing sends the pull', fm.length, 1);
  check('as a forceMove naming the defender', fm[0]?.targetUid, 2);
  check('with the chosen facing riding along', fm[0]?.facing, 1);
  check('and the landing spot beside the attacker',
    Math.abs(Math.floor(fm[0].to.col / 3) - 0) <= 1 && Math.abs(Math.floor(fm[0].to.row / 3) - 0) <= 1, true);
  // The printed OR: taking Drag retires Disarm, and the latch is the rule
  // rather than the disabled attribute (the shim's click() ignores disabled).
  const disarmBtn = findButtons(root).find((x) => /^Disarm: flip/.test(label(x)));
  disarmBtn.click();
  check('taking Drag retires the Disarm half', cmds.filter((c) => c.kind === 'disarm').length, 0);
  // Not faceBtn() again: retire() renamed the pressed chip to its confirmation
  // text, so the honest re-press is a DIFFERENT facing chip that kept its label.
  findButtons(root).find((x) => /^Face North/.test(label(x))).click();
  check('and a second pull is not sent either', cmds.filter((c) => c.kind === 'forceMove').length, 1);
}

// ---------- a generic strike, for the rest of the choice family ----------
async function strike(cardId, actionId, slot, boost) {
  const card = data.cards.find((c) => c.id === cardId);
  const act = card?.actions?.find((a) => a.id === actionId);
  const atk = kit(mech(1, 's1', 'Attacker', 1), card.id);
  const def = kit(mech(2, 's2', 'Defender', 3), '');
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
  h.start(atk, act, def, 'clear');
  h.pickPart(slot);
  // A healthy pool, so the seeded walk reliably lands the Hit the riders need.
  if (boost && h.ctx) h.ctx.attackPool = boost;
  for (const want of [/roll attack dice/i, /continue to defense/i, /roll defense dice/i]) {
    const b = findButtons(root).find((x) => want.test(label(x)));
    if (b) b.click();
    await settle();
  }
  for (let i = 0; i < 2; i++) {
    const b = findButtons(root).find((x) => label(x) === 'Pass' && !x.disabled);
    if (b) b.click();
  }
  const res = findButtons(root).find((x) => /^Resolve/.test(label(x)));
  if (res) res.click();
  await settle();
  const hits = h.ctx?.hits ?? 0;
  // The RESOLVE step's text, captured before Done sweeps to the terminal
  // screen: the no-damage explanation lives on the strip, not in the log.
  const resolveTexts = [];
  const grab = (el) => { if (el.textContent) resolveTexts.push(String(el.textContent)); if (el.innerHTML) resolveTexts.push(String(el.innerHTML)); for (const ch of el.children ?? []) grab(ch); };
  grab(root);
  const applyBtn = findButtons(root).find((x) => /^Apply Penetration/.test(label(x)));
  const end = findButtons(root).find((x) => /apply penetration|^Done$/i.test(label(x)) && !x.disabled);
  if (end) end.click();
  await settle();
  return { cmds, root, hits, hadApply: !!applyBtn, def, resolveText: resolveTexts.join(' ') };
}

// ---------- 139_A: Drag OR Immobilize, the attacker picks ----------
{
  const { cmds, root, hits } = await strike('139', '139_A', 'torso', { red: 4, yellow: 4 });
  check('the whip landed a Hit', hits > 0, true);
  const imm = findButtons(root).find((x) => /^Immobilize:/.test(label(x)));
  check('the Immobilize alternative is offered beside the Drag chips', !!imm, true);
  check('with the Drag chips there too - it is an OR',
    findButtons(root).some((x) => /^Drag [NSEW]/.test(label(x))), true);
  imm.click();
  const st = cmds.filter((c) => c.kind === 'applyStatus');
  check('taking it applies the Immobilized Token', st[0]?.statusId, 'immobilized');
  check('to the defender', st[0]?.targetUid, 2);
  // The shared latch: the OR is spent.
  const grid = findButtons(root).find((x) => /^Drag [NSEW]/.test(label(x)));
  grid.click();
  findButtons(root).filter((x) => /^Face /.test(label(x))).forEach((b) => b.click());
  check('and the Drag half is retired with it', cmds.filter((c) => c.kind === 'forceMove').length, 0);
}

// ---------- 139_B: forced to face AWAY, one specific facing ----------
// The zh is stricter than the English ("may set the Facing"): 可强迫目标背对本机,
// and the structured rule agrees - away_from_attacker. Not a free pick.
{
  const { cmds, root, hits, def } = await strike('139', '139_B', 'torso', { red: 4, yellow: 4 });
  check('the flat of the whip landed too', hits > 0, true);
  const turn = findButtons(root).find((x) => /face away from the attacker/.test(label(x)));
  check('the face-away offer is there', !!turn, true);
  turn.click();
  const fm = cmds.filter((c) => c.kind === 'forceMove');
  check('it travels as a facing-only forceMove', fm.length, 1);
  check('to the defender\'s OWN square - nobody moves', fm[0]?.to, { col: def.col, row: def.row });
  // The harness places the defender EAST of the attacker (the 4th mech()
  // argument is the COLUMN - misread as the row in this test's first draft),
  // so away points East, facing 1.
  check('and the facing points away along the line between them', fm[0]?.facing, 1);
  check('a forceMove, so an Immobilized target still turns - displacement is not its own Movement',
    fm[0]?.kind, 'forceMove');
}

// ---------- Laser Suppression: the hit lands its token and nothing else ----------
// 不造成伤害 (552_B, PRDR-102_C/104_C): Hits are kept - the FCI grant rides the
// on-hit seam and needs them - but the un-offset icons never become a
// Penetration, so no damage, no Part state change, no Surplus.
{
  const { cmds, hits, hadApply, resolveText } = await strike('552', '552_B', 'torso', { red: 3, yellow: 4 });
  check('the suppression laser landed a Hit', hits > 0, true);
  check('and granted Fire Control Interference through the rider seam',
    cmds.filter((c) => c.kind === 'applyStatus' && c.statusId === 'fci').length, 1);
  check('but offered NO Apply Penetration - the action causes no damage', hadApply, false);
  check('and no Penetration was ever applied',
    cmds.filter((c) => c.kind === 'applyPenetration').length, 0);
  check('and the resolution says why in words', /causes no damage/.test(resolveText), true);
}

// ---------- where the rule lives ----------
{
  const dataSrc = readFileSync(new URL('../src/data.ts', import.meta.url), 'utf8');
  const cmdsSrc = readFileSync(new URL('../src/commands.ts', import.meta.url), 'utf8');
  check('discardFaceOf is its own lookup, not a widened transformFaces',
    /export function discardFaceOf\(/.test(dataSrc), true);
  // Placed inside the isModeFace..zeroCostReason range the commands test
  // slices, or that slice breaks the way immobilizedStop once did.
  const at = dataSrc.indexOf('export function discardFaceOf');
  check('and sits inside the sliced range',
    at > dataSrc.indexOf('export function isModeFace') && at < dataSrc.indexOf('export function zeroCostReason'), true);
  const chk = cmdsSrc.slice(cmdsSrc.indexOf("case 'disarm': {"), cmdsSrc.indexOf("case 'disarm': {") + 1300);
  check('the command refuses a Part with no Discard Card', /has no Discard Card/.test(chk), true);
  check('and a destroyed Part', /destroyed, so there is no card left to flip/.test(chk), true);
  const apply = cmdsSrc.slice(cmdsSrc.lastIndexOf("case 'disarm': {"), cmdsSrc.lastIndexOf("case 'disarm': {") + 700);
  check('the face is DERIVED in apply, never carried on the wire',
    /discardFaceOf\(data, from\)/.test(apply) && /far\.id/.test(apply), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
