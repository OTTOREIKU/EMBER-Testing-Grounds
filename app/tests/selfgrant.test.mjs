// Self-applied Tokens: Ambush (094/095/096/247, a Low Profile Token) and
// Amplify Profile (007/098, a Highlight Token). Both pages used to fall through
// to "follow the card text" and never placed the Token; FAQ J1 refuses a second
// Ambush while the first Token is still worn, J19 allows one in Contact. The
// readers run against the shipped cards; the gate and both doors are pinned.
import { readFileSync, writeFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('Self-applied Tokens: Ambush and Amplify Profile\n');

const units = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
const from = units.indexOf('// ---------- Self-applied Tokens');
const to = units.indexOf('export function interceptCapacity(');
if (from < 0 || to <= from) throw new Error('could not locate the self-status readers in units.ts');
const tmp = new URL('./_selfgrant.slice.ts', import.meta.url);
writeFileSync(tmp, `type CardAction = any; type GameData = any; type Token = any; type PartSlot = any; type GameState = any;
function statusCount(list: any, id: string): number { return (list ?? []).filter((x: any) => x === id).length; }
function tokenCards(_data: any, _t: any): any[] { return []; }
` + units.slice(from, to));
const { selfStatusGrant, selfGrantWhy } = await import(tmp.href);

const raw = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
const cards = Array.isArray(raw) ? raw : raw.cards;
const act = (id) => cards.flatMap((c) => c.actions ?? []).find((a) => a.id === id);

for (const id of ['094_A', '095_A', '096_A', '247_A']) {
  check(`${id} Ambush grants a Low Profile Token`, selfStatusGrant(act(id)), { statusId: 'lowProfile', stacks: 1 });
}
for (const id of ['007_A', '098_B']) {
  check(`${id} Amplify Profile grants a Highlight Token`, selfStatusGrant(act(id)), { statusId: 'highlight', stacks: 1 });
}
check('a Sprint grants nothing', selfStatusGrant(act('179_A')), null);
check('an On Hit rider aimed at the target is not a self-grant',
  selfStatusGrant({ gameRules: [{ effects: [{ type: 'apply_status', status: '低特征', target: 'target' }] }] }), null);
check('every self-grant in the box is one of the two Tokens',
  [...new Set(cards.flatMap((c) => c.actions ?? []).map((a) => selfStatusGrant(a)?.statusId).filter(Boolean))].sort(), ['highlight', 'lowProfile']);

const viper = (statuses) => ({ uid: 1, kind: 'mech', label: 'Viper', statuses });
check('a bare Viper may Ambush', selfGrantWhy(viper([]), { statusId: 'lowProfile', stacks: 1 }), null);
check('one already wearing the Token may not (FAQ J1)', /FAQ J1/.test(selfGrantWhy(viper(['lowProfile']), { statusId: 'lowProfile', stacks: 1 }) ?? ''), true);
check('and the refusal cites 6.1', /6\.1/.test(selfGrantWhy(viper(['lowProfile']), { statusId: 'lowProfile', stacks: 1 }) ?? ''), true);
check('a Highlight already worn refuses Amplify Profile the same way',
  /already bears a Highlight Token/.test(selfGrantWhy(viper(['highlight']), { statusId: 'highlight', stacks: 1 }) ?? ''), true);
check('a Viper in Optical Camouflage may still Ambush (J19: Contact never removes it, and the Token is not the State)',
  selfGrantWhy(viper(['camouflage']), { statusId: 'lowProfile', stacks: 1 }), null);

// ---------- the gate and both doors ----------
const cmds = readFileSync(new URL('../src/commands.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const hud = readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8');
const perf = cmds.slice(cmds.indexOf("case 'performAction': {"), cmds.indexOf("case 'performAction': {") + 2400);
check('performAction refuses the grant the unit already wears', /const selfGrant = selfStatusGrant\(a\);\s*\n\s*if \(selfGrant\) \{\s*\n\s*const why = selfGrantWhy\(t, selfGrant\);\s*\n\s*if \(why\) return no\(why\);/.test(perf), true);
check('freeplay places the Token through applyStatus', /const grant = selfStatusGrant\(action\);[\s\S]{0,700}?kind: 'applyStatus', seat: t\.side, uid: t\.uid, targetUid: t\.uid, statusId: grant\.statusId, stacks: grant\.stacks/.test(main), true);
check('and refuses before the card text is shown', /selfGrantWhy\(t, grant\);[\s\S]{0,200}?return done\(false\);/.test(main), true);
check('the Match Centre places it and pays for it', /const grant = selfStatusGrant\(a\);[\s\S]{0,600}?const paid = commitAction\(ctx\);[\s\S]{0,300}?kind: 'applyStatus', seat: t\.side, uid: t\.uid, targetUid: t\.uid, statusId: grant\.statusId, stacks: grant\.stacks/.test(hud), true);
check('and drops the latched Ticks on a refusal', /selfGrantWhy\(t, grant\);\s*\n\s*if \(why\) \{\s*\n\s*ctx\.noteNow\(why\);\s*\n\s*dropAction\(\);/.test(hud), true);
check('both branches sit before the card-text fallthrough',
  main.indexOf('const grant = selfStatusGrant(action);') < main.indexOf('Swift and Tactical actions are card text')
  && hud.indexOf('const grant = selfStatusGrant(a);') < hud.indexOf('Swift and Tactical Actions are card text'), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
