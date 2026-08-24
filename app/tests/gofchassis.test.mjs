// The four GoF chassis, and the two things wrong with them.
//
// 1. COMMAND COORDINATION. The publisher's GoF 1.021 EN list prints
//    "· Command Coordination" on all four (179, 180, 181, 182). Our data
//    carried it on none: the community bundle left those action descriptions
//    empty. And the list writes the keyword BARE, with no number, defining it
//    in its own Extra Info as "may immediately issue 1 Command to a Ally
//    Drone" -- so bare means 1, and a reader demanding a digit scored all four
//    as 0 while looking perfectly wired.
//
// 2. THE PL29 JUMP WAS STILL SILENT. v1.021 redesigned card 180 from a Stealth
//    Chassis into an All-terrain Chassis, "losing Silence and gaining a Jump".
//    The overrides renamed the action, retyped it, and stripped the card-level
//    keyword -- but actionPrintsSilence() reads the ACTION's Chinese text, and
//    that still held the superseded passive 本部件的移动动作/调整移动，均为静默.
//    So the Jump kept Optical Camouflage and the Low Profile Token, which is
//    precisely the rule the redesign took away.
//
// Only 181 is in a released box (LAB-CENTAUR SK). The other three are GoF-only
// and unreleased, so this is one live fix and three filed ahead of time.
import { readFileSync, writeFileSync } from 'node:fs';

const unitsSrc = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
const start = unitsSrc.indexOf('// Command Coordination X (4.15.3)');
const end = unitsSrc.indexOf('// How much Coordination this Mech owes');
if (start < 0 || end < 0) throw new Error('could not locate the Command Coordination readers in units.ts');
const tmp = new URL('./_gof.slice.ts', import.meta.url);
writeFileSync(tmp, 'type CardAction = any;\n' + unitsSrc.slice(start, end));
const U = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('GoF chassis: bare Command Coordination, and the Jump that stayed Silent\n');

const en = (s) => ({ description: { en: s } });
const zh = (s) => ({ description: { zh: s } });

// ---------- the bare keyword reads as 1 ----------
check('a bare English Command Coordination is 1', U.commandCoordination(en('· Command Coordination')), 1);
check('a bare Chinese one is too', U.commandCoordination(zh('· 指令协调')), 1);
check('the Centaur Run, with three other bullets around it',
  U.commandCoordination(en('· Non-humanoid 1\n· Unstoppable\n· If there is an Enemy Ground Unit in the adjacent grid in front of the Mech after performing this Action, may cause Push 1.\n· Command Coordination')), 1);
check('the Kick, where a digit belongs to a DIFFERENT keyword',
  U.commandCoordination(en('· [On Hit] Knock Back 1.\n· Command Coordination')), 1);

// ---------- an explicit number still wins ----------
// Every card in the community bundle writes it this way, so nothing already
// shipped may change value.
check('an explicit 1 is still 1', U.commandCoordination(zh('· 穿甲1\n· 指令协调1')), 1);
check('an explicit 2 is 2, not flattened to the bare default',
  U.commandCoordination(zh('· 指令协调2')), 2);
check('and an explicit 3', U.commandCoordination(en('Command Coordination 3')), 3);

// ---------- what must still read as ZERO ----------
// These are the reason the bare check sits BELOW the grant and on-end guards.
check('a GRANT to other Actions is not Coordination this Action carries',
  U.commandCoordination(zh('· 本机近战动作获得指令协调1。')), 0);
check('the English grant shape too',
  U.commandCoordination(en('Melee Actions by this Unit gain Command Coordination 1')), 0);
check('an end-of-Opportunity Passive is a different trigger',
  U.commandCoordination(zh('· 本机行动机会结束时，指令协调1。')), 0);
check('an Action that never mentions it is 0', U.commandCoordination(en('· Unstoppable')), 0);
check('and empty text is 0', U.commandCoordination({}), 0);

// ---------- the data itself ----------
{
  const raw = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
  const cards = Array.isArray(raw) ? raw : raw.cards;
  const fixes = JSON.parse(readFileSync(new URL('../../data/action_overrides.json', import.meta.url), 'utf8')).actions ?? {};
  for (const c of cards) {
    for (const a of c.actions ?? []) {
      const f = fixes[a.id];
      if (f?.description) a.description = { ...a.description, ...f.description };
    }
  }
  const act = (id) => cards.flatMap((c) => c.actions ?? []).find((a) => a.id === id);

  // All six Movement/Melee actions the list prints the keyword on.
  for (const id of ['179_A', '180_A', '180_B', '181_A', '182_A', '182_B']) {
    check(`${id} carries Command Coordination`, U.commandCoordination(act(id)), 1);
  }
  // 181_B is the one chassis action the list leaves blank, so it must stay 0 --
  // otherwise the fix was applied to the card rather than to the action.
  check('181_B, which the list leaves blank, carries none', U.commandCoordination(act('181_B')), 0);

  // The Silence half.
  check('the PL29 Jump no longer prints Silence in Chinese',
    /静默/.test(act('180_B')?.description?.zh ?? ''), false);
  check('nor in English', /Silence/i.test(act('180_B')?.description?.en ?? ''), false);
  check('and it does say what it IS now',
    /Airborne Movement/.test(act('180_B')?.description?.en ?? ''), true);

  // The CARD's own reminder line was the other half, and stripping the keyword
  // did not reach it: the chip was gone while the sentence explaining it
  // stayed, so the page still advertised Silence on a card that has none.
  const statFix = JSON.parse(readFileSync(new URL('../../data/stat_overrides.json', import.meta.url), 'utf8')).cards ?? {};
  const card180 = cards.find((c) => c.id === '180');
  const sf = statFix['180'];
  if (sf?.description) card180.description = { ...card180.description, ...sf.description };
  check('card 180 no longer advertises Silence', /Silence|静默/.test(
    (card180?.description?.en ?? '') + (card180?.description?.zh ?? '')), false);
  check('and its keyword chip is gone too', (sf?.keywords ?? null), []);

  // ---------- 182_B: Push corrected to Knockback ----------
  // Different rules: Push X also takes 1 Link, Knock Back X does not. The
  // bundle contradicted ITSELF here -- the card's keyword field reads 击退X
  // Knockback X while its action text read 造成推动1 -- so this is the known
  // 推动/击退 transcription collision, not the two editions disagreeing.
  const kick = act('182_B');
  check('the Kick reads Knock Back in English', /Knock ?Back 1/i.test(kick?.description?.en ?? ''), true);
  check('and 击退 in Chinese', /击退\s*1/.test(kick?.description?.zh ?? ''), true);
  // BOTH halves matter. knockbackOf prefers description.en, so the English
  // alone fixes the mechanics -- but a zh still saying 推动 would leave the
  // data contradicting itself and any zh-consulting reader taking a Link.
  check('and the Chinese no longer says Push', /推动|推動/.test(kick?.description?.zh ?? ''), false);
  check('the card keyword it now agrees with',
    (cards.find((c) => c.id === '182')?.keywords ?? []).map((k) => k.key), ['击退X']);

  // The card's own reminder line was the third place this had to be right: it
  // spelled out PUSH X, in both languages, on a Knockback card -- teaching a
  // Link cost this card cannot impose. Display-only, and the half a player
  // actually reads.
  const card182 = cards.find((c) => c.id === '182');
  const sf182 = statFix['182'];
  if (sf182?.description) card182.description = { ...card182.description, ...sf182.description };
  const body182 = (card182?.description?.en ?? '') + (card182?.description?.zh ?? '');
  check('card 182 no longer defines Push X', /Push X|推动X/.test(body182), false);
  check('and defines Knock Back X instead', /Knock ?Back X/i.test(body182) && /击退X/.test(body182), true);

  // 181 is the control: it really IS Push, it is the only released card that
  // is, and nothing here may quietly flip it.
  const card181 = cards.find((c) => c.id === '181');
  check('card 181 is still Push, not swept up in the 182 fix',
    (card181?.keywords ?? []).some((k) => k.key === '推动X'), true);
  check('and its Run still reads as Push', /推动\s*1/.test(act('181_A')?.description?.zh ?? ''), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
