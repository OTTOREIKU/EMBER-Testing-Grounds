// SHOCK ATTACK X AND THE CONDITIONAL KEYWORD GRANT (built 2026-08-24).
//
// Five actions print `[condition] 获得X` / `[Condition] gains X`: three GoF
// polearms grant 冲锋1 Shock Attack 1 in Offensive Stance, two laser rifles
// grant 狙击 Snipe while Stationary. Until this build the grammar had NO
// machinery at all - grep for 冲锋 found nothing - and the Stationary Snipe
// was parked as item B3 precisely because nothing could grant a keyword.
//
// The load-bearing trap, pinned hard below: the grant LINE contains the
// keyword's name, so any reader that looked at the raw description would arm
// the keyword for a Mech in the wrong stance. The keyword must be invisible on
// the raw action and visible only on the grantAdjusted copy.
import { readFileSync, writeFileSync } from 'node:fs';

const unitsSrc = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
// Two ranges: snipeOn (so B3's closure is proved against the real reader, not
// a copy) and the grant block. BOTH offsets asserted - an end marker sitting
// before its start silently slices nothing, which this harness has been bitten
// by before.
const snipeStart = unitsSrc.indexOf('// TWO ROUTES, because the data prints it two ways.');
const snipeEnd = unitsSrc.indexOf("// ---------- LASER SUPPRESSION'S OTHER HALF");
if (snipeStart < 0 || snipeEnd < 0 || snipeEnd <= snipeStart) throw new Error('could not slice snipeOn');
const grantStart = unitsSrc.indexOf('// ---------- [condition] 获得X: keywords GRANTED by a printed condition ----------');
const grantEnd = unitsSrc.indexOf('// Pulse Weapon: "May exchange');
if (grantStart < 0 || grantEnd < 0 || grantEnd <= grantStart) throw new Error('could not slice the grant block');
const tmp = new URL('./_shock.slice.ts', import.meta.url);
writeFileSync(tmp, 'type CardAction = any;\ntype Token = any;\n'
  + unitsSrc.slice(snipeStart, snipeEnd)
  + unitsSrc.slice(grantStart, grantEnd));
const U = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Shock Attack and the conditional keyword grant\n');

// ---------- the real printed shapes, straight off the card data ----------
const spear = {
  id: 'ZHRA-103_A',
  description: { zh: '· [攻击姿态]获得冲锋1。', en: '· [Offensive Stance] gains Shock Attack 1.' },
  keywords: [],
};
const halberd = {
  id: 'ZHRA-303_A',
  description: { zh: '· [攻击姿态]获得冲锋1。\n· [命中]造成拖拽。', en: '· [Offensive Stance] gains Shock Attack 1.\n· [On Hit] Causes Drag.' },
  keywords: [],
};
const laser = {
  id: 'R33S_A',
  description: { zh: '· 激光武器\r\n· [静止] 获得狙击。\r\n· 静默' },
  keywords: [{ inline: '激光武器' }, { inline: '静默' }],
};
const broadsword = {
  id: 'ZHLA-304_B',
  description: { zh: '· 【双手】获得毁伤。', en: '· [Two-Handed] Gains Mutilation.' },
  keywords: [],
};

// The data itself, so a regenerated cards.json that rewords the lines fails
// HERE rather than leaving the parser matching nothing.
{
  const raw = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
  const cards = Array.isArray(raw) ? raw : raw.cards;
  const byAct = new Map(cards.flatMap((c) => (c.actions ?? []).map((a) => [a.id, a])));
  check('the Spear still prints the grant', /获得冲锋1/.test(byAct.get('ZHRA-103_A')?.description?.zh ?? ''), true);
  check('in English too', /gains Shock Attack 1/.test(byAct.get('ZHRA-103_A')?.description?.en ?? ''), true);
  check('and the laser rifle its Stationary Snipe', /\[静止\] ?获得狙击/.test(byAct.get('R33S_A')?.description?.zh ?? ''), true);
}

// ---------- parsing the grammar ----------
check('a zh-only grant parses', U.conditionalGrants(laser), [{ when: 'stationary', keywords: ['狙击'] }]);
{
  const g = U.conditionalGrants(spear);
  check('a both-language card yields the grant in both languages', g.length, 2);
  check('each in Offensive Stance', g.every((x) => x.when === 'offensive'), true);
  check('carrying the zh keyword with its number', g[0].keywords, ['冲锋1']);
  check('and the en one, trailing period stripped', g[1].keywords, ['Shock Attack 1']);
}
check('a second bracketed line on the action does not confuse it',
  U.conditionalGrants(halberd).every((x) => x.when === 'offensive'), true);
// The condition vocabulary is CLOSED. [Two-Handed] uses the same 获得/gains
// grammar and belongs to twoHandedRider; parsing it here would double-apply
// Mutilation once a Freehand is designated.
check('[Two-Handed] grants are NOT this machine', U.conditionalGrants(broadsword), []);
check('an action with no grants parses to nothing', U.conditionalGrants({ id: 'x', description: { en: '· Cleaving' } }), []);

// ---------- applying the condition ----------
const off = { stance: 'offensive' };
const mob = { stance: 'mobility' };
check('Offensive Stance arms the Spear', U.shockAttackOf(U.grantAdjusted(spear, off, null)), 1);
check('Mobility Stance does not', U.shockAttackOf(U.grantAdjusted(spear, mob, null)), 0);
check('nor Defensive', U.shockAttackOf(U.grantAdjusted(spear, { stance: 'defensive' }, null)), 0);
// THE TRAP: the grant line contains 冲锋1, and the raw action must NOT read as
// carrying it - that is the whole reason the grammar sat unwired for so long.
check('the RAW action never carries Shock Attack', U.shockAttackOf(spear), 0);
check('grantAdjusted returns the same object when nothing is satisfied', U.grantAdjusted(spear, mob, null) === spear, true);
check('and never mutates the card', spear.keywords.length, 0);

// Stationary is judged exactly as stationaryAdjusted judges it: no Movement
// yet THIS Opportunity, told by the Opportunity the caller hands over.
check('an unmoved Opportunity arms the Stationary grant',
  U.grantAdjusted(laser, mob, {}).keywords.some((k) => k.inline === '狙击'), true);
check('a moved one does not', U.grantAdjusted(laser, mob, { moved: true }) === laser, true);
check('a maneuvered one neither', U.grantAdjusted(laser, mob, { maneuvered: true }) === laser, true);
check('and no Opportunity at all means not stationary', U.grantAdjusted(laser, mob, null) === laser, true);

// ---------- B3 CLOSES: snipeOn sees the granted keyword ----------
// The real snipeOn, sliced from units.ts, not a copy. Its bare-line route has
// always excluded grant lines; the INLINE route is what the grant feeds.
check('snipeOn is false on the raw laser rifle', U.snipeOn(laser), false);
check('and TRUE on the stationary-adjusted copy', U.snipeOn(U.grantAdjusted(laser, mob, {})), true);

// ---------- the chassis gate ----------
check('a Mech with its chassis may take the walk',
  U.shockMoveAllowed({ kind: 'mech', partStates: { chasis: 'intact' } }), true);
check('a damaged chassis still walks', U.shockMoveAllowed({ kind: 'mech', partStates: { chasis: 'damaged' } }), true);
check('a destroyed one does not', U.shockMoveAllowed({ kind: 'mech', partStates: { chasis: 'destroyed' } }), false);
check('and a drone is not a Mech with a chassis', U.shockMoveAllowed({ kind: 'drone', partStates: {} }), false);

// ---------- the wiring, on BOTH boards ----------
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const hud = readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8');
const match = readFileSync(new URL('../src/match.ts', import.meta.url), 'utf8');

// The grant chain runs wherever stationaryAdjusted already ran, so a granted
// keyword reaches every reader a printed one reaches - the combat window's
// Snipe designation included.
check('freeplay folds grants into the attack action', /grantAdjusted\(steadied, t, opp0/.test(main), true);
check('the Match Centre attack panel does', /grantAdjusted\(steadied, by, opp0/.test(hud), true);
check('twice - the target re-check too', (hud.match(/grantAdjusted\(steadied, by, opp0/g) ?? []).length, 2);
check('and the combat window action deriver does', /grantAdjusted\(stationaryAdjusted\(printed, opp\), t, opp\)/.test(match), true);

// Freeplay: the offer, the free walk, then the same targeting either way.
check('freeplay offers the walk before targeting', /Shock Attack \$\{shock\}[\s\S]{0,600}?startMove\(uid, \{ range: shock/.test(main), true);
check('declining goes straight to the targeting', /if \(!go\) return proceed\(\)/.test(main), true);
check('and the walk continues into it', /range: shock[\s\S]{0,80}?\(\) => proceed\(\)/.test(main), true);

// Match Centre: ONE door asks, every route funnels through it.
check('openAttackPick is the single door', /function openAttackPick\(t: Token, a: CardAction, refund\?[\s\S]{0,1400}?shockPick = \{/.test(hud), true);
check('asked exactly once', /shockAsked = false/.test(hud) && /openAttackPick\(t, a, after\.refund, true\)/.test(hud), true);
check('an Immobilized Mech is not offered the walk', /shockMoveAllowed\(t\) && !immobilizedStop\(t, null\)/.test(hud), true);
// THE PAYMENT ORDER. The command layer only allows a free move once its Action
// has been performed this Opportunity, so the Action pays BEFORE the walk -
// and a refused payment refunds the Charge and stops.
check('the walk pays the Action first', /data-act="shockmove"[\s\S]{0,900}?commitAction\(ctx\)[\s\S]{0,900}?startMovePlan/.test(hud), true);
check('a refused payment refunds the Charge', /if \(paid\.why\) ctx\.noteNow\(paid\.why\);\s*\r?\n\s*refundCharge\(ctx, m\.refund\)/.test(hud), true);
// The attack rides the plan the way the shove does, through every exit.
check('the plan carries the attack', /attackAfter\?: \{ actionId: string/.test(hud), true);
check('through a Crush as well', /shoveActionId: shoveId,\s*\r?\n\s*attackAfter: after,/.test(hud), true);
check('every shove exit also resumes the attack',
  (hud.match(/resumeShockAttack\(ctx, t\.uid, (?:after|m\.attackAfter)\)/g) ?? []).length >= 4, true);
// Backing out of the OPTIONAL walk must not eat the paid Action.
check('cancelling the walk still owes the attack', /function cancelMove[\s\S]{0,800}?resumeShockAttack\(ctx, uid, after\)/.test(hud), true);
check('and the planner refusing to open falls through to it', /if \(!movePlan\) resumeShockAttack/.test(hud), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
