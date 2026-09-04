// The free Scan on designation (4.12.2, FAQ I11/I12): naming a unit in the
// Optical Camouflage State as the target of a Firing or Melee Action earns one
// free Scan first. A success Reveals it (its player chooses where it appears)
// and the attack resumes; a failure ends the attack with the Tick spent and
// the remaining Ticks still the attacker's. Both pages used to refuse the
// target outright. The shared record is driven; the two flows are pinned.
import { readFileSync, writeFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('The free Scan on designation\n');

// ---------- the record survives every rebuild ----------
const types = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const start = types.indexOf('export function newOpportunity');
const end = types.indexOf('export type BattleScale');
const sideStart = types.indexOf('export const LEGACY_SIDE');
const sideEnd = types.indexOf('export type Stance');
if ([start, end, sideStart, sideEnd].some((i) => i < 0)) throw new Error('could not locate the script helpers in types.ts');
const tmp = new URL('./_scanattack.slice.ts', import.meta.url);
writeFileSync(tmp, 'type Side = any;\ntype ScriptState = any;\ntype Opportunity = any;\ntype ExtraTick = any;\ntype Timing = any;\n'
  + types.slice(sideStart, sideEnd) + types.slice(start, end));
const { normaliseScript } = await import(tmp.href);
const counter = { initiatorUid: 7, responderUid: 9, actionId: 'COMMON_SCAN', initRoll: null, respRoll: null, initFocused: false, respFocused: false, provoke: null };
check('the attack behind the Scan survives a checkpoint',
  normaliseScript({ counter: { ...counter, thenAttack: { actionId: '032_A' } } }, 's1').counter.thenAttack, { actionId: '032_A' });
check('a Scan opened as an Action of its own carries none', normaliseScript({ counter }, 's1').counter.thenAttack, null);
check('and garbage reads as none', normaliseScript({ counter: { ...counter, thenAttack: { actionId: 7 } } }, 's1').counter.thenAttack, null);
check('the attacker\'s owed reaction is a kind the record keeps',
  normaliseScript({ reactions: [{ uid: 7, actionId: '032_A', count: 1, range: 0, kind: 'scanAttack', fromUid: 9 }] }, 's1').reactions.length, 1);

// ---------- the command layer ----------
const cmds = readFileSync(new URL('../src/commands.ts', import.meta.url), 'utf8');
const scan = cmds.slice(cmds.indexOf("case 'startCounterRoll': {"), cmds.indexOf("case 'startCounterRoll': {") + 4200);
check('startCounterRoll carries the attack', /thenAttack\?: \{ actionId: string \};/.test(cmds), true);
check('only a Scan may carry one', /if \(cmd\.thenAttack\) \{\s*\n\s*if \(!isScanAction\(a\)\) return no/.test(scan), true);
check('only against a camouflaged target', /statusCount\(target\.statuses, 'camouflage'\) === 0\) return no\(`\$\{target\.label\} is not in the Optical Camouflage State/.test(scan), true);
check('and only ahead of a Firing or Melee Action the unit has', /atk\.type !== 'Firing' && atk\.type !== 'Melee'\)\) return no/.test(scan), true);
check('the apply writes it into the record', /thenAttack: cmd\.thenAttack \? \{ actionId: cmd\.thenAttack\.actionId \} : null,/.test(cmds), true);
check('the Scan is judged at its effective reach', /const reach = actionRange\(data, state\.tokens, t, a\);/.test(scan), true);

// ---------- the Match Centre ----------
const hud = readFileSync(new URL('../src/matchhud.ts', import.meta.url), 'utf8');
check('a camouflaged target is a pressable row', /const blocked = !hidden && note\.includes\('✕'\);/.test(hud), true);
check('that says what will happen', /one free Scan first; the attack follows if it is Revealed \(4\.12\.2, FAQ I12\)/.test(hud), true);
const press = hud.slice(hud.indexOf("on('[data-attacktarget]'"), hud.indexOf("on('[data-attacktarget]'") + 4200);
check('the press asks the command before paying', /const can = ctx\.check\(scan\);\s*\n\s*if \(!can\.ok\)/.test(press), true);
check('then pays the Tick - the attack is declared (3.4.5)', /const paid = commitAction\(ctx\);[\s\S]{0,200}?ctx\.send\(scan\);/.test(press), true);
check('and the Scan carries the attack', /actionId: 'COMMON_SCAN', targetUid: t\.uid, thenAttack: \{ actionId: m\.actionId \}/.test(press), true);
const apply = hud.slice(hud.indexOf("if (act === 'apply') {"), hud.indexOf("if (act === 'apply') {") + 3000);
check('a successful Scan queues the attack behind the Reveal', /kind: 'scanAttack' as const, fromUid: resp\.uid/.test(apply), true);
check('to the ATTACKER\'s seat', /\.\.\.\(c\.thenAttack \? \[\{ uid: init\.uid, actionId: c\.thenAttack\.actionId/.test(apply), true);
check('a Scan closed without applying ends the attack (I11)', /c\.thenAttack && !\(ensureScript\(s\)\.reactions \?\? \[\]\)\.some\(\(r\) => r\.kind === 'scanAttack'/.test(hud) && /any remaining Ticks may still be used \(FAQ I11\)/.test(hud), true);
check('the reaction panel waits while the target Reveals', /r\.kind === 'scanAttack'\) \{[\s\S]{0,600}?const hidden = !!target && statusCount\(target\.statuses, 'camouflage'\) > 0;/.test(hud), true);
check('judges the attack from where it appeared', /r\.kind === 'scanAttack'\) \{[\s\S]{0,900}?losNote\(t, target, \{ \.\.\.act, range: actionRange\(ctx\.data, ctx\.state\.tokens, t, act\) \}/.test(hud), true);
check('and resumes through the ordinary front door', /r\.kind === 'scanAttack'\) \{\s*\n\s*if \(!place\) \{[\s\S]{0,300}?ctx\.startAttack\(uid, actionId, r\.fromUid\);/.test(hud), true);

// ---------- freeplay ----------
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const combat = readFileSync(new URL('../src/combat.ts', import.meta.url), 'utf8');
check('the camouflaged branch runs the free Scan instead of refusing', /statusCount\(defender\.statuses, 'camouflage'\) > 0\) \{[\s\S]{0,500}?freeScanThenAttack\(attacker, defender, action, done\);/.test(main), true);
check('a Mech that cannot Scan cannot attack it (4.11.2)', /electronicValue\(data, attacker, loanedParts\(data, state\.tokens, attacker\)\) <= 0\) \{[\s\S]{0,400}?done\?\.\(false\);/.test(main), true);
check('the window reports the verdict once, at Resolve', /c\.then\?\.\(win\);\s*\n\s*this\.onChanged\(\);/.test(combat), true);
check('a failed Scan ends the attack with the Tick spent (I11)', /if \(!win\) \{\s*\n\s*logTo\(attacker, `The Scan failed, so the attack on \$\{defender\.label\} ends\. The Action Tick is spent; any remaining Ticks may still be used \(FAQ I11\)\.`\);\s*\n\s*done\?\.\(true\);/.test(main), true);
check('a success waits for the manifest debt and then resumes', /offerManifestation\(defender, 'Scanned:'\)\.then\(\(\) => \{[\s\S]{0,300}?resumeScanAttack\(\);/.test(main), true);
check('resuming judges the attack from where it appeared', /function resumeScanAttack\(\)[\s\S]{0,900}?const note = losNote\(attacker, defender, s\.action\);/.test(main), true);
check('and opens the same window an ordinary attack does', /function resumeScanAttack\(\)[\s\S]{0,1600}?attackHelper\.start\(attacker, s\.action, defender, note, prot\.white, prot\.note\);/.test(main), true);
check('the old refusal text is gone from both pages', /cannot be designated as the target of a Firing or Melee Action until it has been Revealed/.test(main) || /Scan it first \(4\.12\.2\)/.test(hud), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
