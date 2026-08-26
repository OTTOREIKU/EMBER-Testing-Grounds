// UNDO V2, U1: the labelled ledger (Project-Documents/UNDO-V2-PLAN.md).
//
// labelFor turns the command that is about to run into words a player reads in
// a rollback timeline. Three properties carry the feature and are pinned here:
// every command kind gets a real label (no camelCase leaking to players), the
// SEALED vocabulary cannot drift from history.ts's private copy, and the one
// SECRET command's label never leaks the secret.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/ledger.ts', import.meta.url), 'utf8');
const tmp = new URL('./_ledger.slice.ts', import.meta.url);
writeFileSync(tmp, 'type GameState = any;\ntype Side = any;\n'
  + src.replace(/^import[^\n]*\n/gm, ''));
const L = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('The undo ledger: labels, seals, and the secret that must not leak\n');

// A small board for the unit()/grid() readings. Grid math: col/row are CELLS,
// three per large grid, so col 18 row 3 is G2 on the printed A1..L12 reading.
const state = {
  tokens: [
    { uid: 1, label: 'P7-A3 “Centurion”', col: 18, row: 3, side: 's1' },
    { uid: 2, label: 'RT-06 Mire', col: 18, row: 30, side: 's2' },
  ],
  round: { n: 1, phase: 2 },
};

// ---------- every kind gets a real label ----------
// The vocabulary is read off commands.ts itself, so a command added next month
// is covered by this test the day it lands: labelFor must not throw on it and
// must not hand the player camelCase.
{
  const cmdSrc = readFileSync(new URL('../src/commands.ts', import.meta.url), 'utf8');
  const kinds = [...new Set([...cmdSrc.matchAll(/kind: '([a-zA-Z]+)'/g)].map((m) => m[1]))];
  check('the command vocabulary was found', kinds.length > 80, true);
  const bad = [];
  for (const kind of kinds) {
    let meta;
    try {
      meta = L.labelFor({ kind }, state);
    } catch (e) {
      bad.push(`${kind}: threw ${e}`);
      continue;
    }
    if (!meta.label || !meta.label.trim()) bad.push(`${kind}: empty`);
    // No camelCase reaches a player: "adjustCommandTokens" must have become
    // words by the time it is a label.
    else if (/[a-z][A-Z]/.test(meta.label)) bad.push(`${kind}: ${meta.label}`);
  }
  check('every kind labels cleanly on a minimal command', bad, []);
}

// ---------- the curated readings ----------
check('a Maneuver names the unit and the grid',
  L.labelFor({ kind: 'maneuver', seat: 's1', uid: 1, to: { col: 9, row: 9 } }, state).label,
  'P7-A3 “Centurion”: Maneuver to D4');
check('a free move says so',
  L.labelFor({ kind: 'maneuver', uid: 1, free: true, to: { col: 9, row: 9 } }, state).label,
  'P7-A3 “Centurion”: free move to D4');
check('a deployment reads the landing grid',
  L.labelFor({ kind: 'deployUnit', uid: 2, to: { col: 18, row: 30 }, camo: true }, state).label,
  'RT-06 Mire deploys at G11, hidden');
check('a status grant names target and token',
  L.labelFor({ kind: 'applyStatus', uid: 1, targetUid: 2, statusId: 'fragile' }, state).label,
  'RT-06 Mire gains a fragile Token');
check('stacks are counted',
  L.labelFor({ kind: 'applyStatus', uid: 1, targetUid: 2, statusId: 'fragile', stacks: 2 }, state).label,
  'RT-06 Mire gains 2 fragile Tokens');
check('a Charge spend and a Charge set read differently',
  [L.labelFor({ kind: 'setCharge', uid: 1, on: false }, state).label,
   L.labelFor({ kind: 'setCharge', uid: 1, on: true }, state).label],
  ['P7-A3 “Centurion”: Charge Token spent', 'P7-A3 “Centurion”: Charge Token set']);
check('a Link drain counts what it takes',
  L.labelFor({ kind: 'drainLink', uid: 1, targetUid: 2, n: 2 }, state).label,
  'RT-06 Mire loses 2 Link');
check('an unknown unit does not crash the words',
  L.labelFor({ kind: 'maneuver', uid: 99, to: { col: 0, row: 0 } }, state).label,
  'a unit: Maneuver to A1');

// ---------- the names resolver ----------
{
  const names = L.namesFrom({
    cards: [{ id: 'ZHRA-103', name: { en: 'M115 Spear' }, actions: [{ id: 'ZHRA-103_A', name: { en: 'Thrust' } }] }],
    commonActions: [{ id: 'COMMON_SCAN', name: { en: 'Scan' } }],
  });
  check('an action resolves through its card', names.action(1, 'ZHRA-103_A'), 'Thrust');
  check('a common action resolves too', names.action(1, 'COMMON_SCAN'), 'Scan');
  check('and a performAction reads as the action by the unit',
    L.labelFor({ kind: 'performAction', uid: 1, actionId: 'ZHRA-103_A' }, state, names).label,
    'Thrust - P7-A3 “Centurion”');
  check('without a resolver the wording still stands',
    L.labelFor({ kind: 'performAction', uid: 1, actionId: 'ZHRA-103_A' }, state).label,
    'an Action - P7-A3 “Centurion”');
}

// ---------- the seal ----------
check('the six sealed kinds are sealed',
  ['acceptRoll', 'rollSetup', 'noteRoll', 'applyPenetration', 'recordKill', 'resolveIntercept']
    .every((k) => L.labelFor({ kind: k }, state).sealed), true);
check('and a maneuver is not', L.labelFor({ kind: 'maneuver', uid: 1 }, state).sealed, false);
// ONE canonical set. history.ts keeps a private copy because it may import
// nothing but types; the two must be the same set or the catalog floor and the
// ledger's sealed flag will disagree about the same command.
{
  const histSrc = readFileSync(new URL('../src/history.ts', import.meta.url), 'utf8');
  const m = /const SEALED = new Set\(\[([^\]]*)\]\)/.exec(histSrc);
  const hist = m ? [...m[1].matchAll(/'([a-zA-Z]+)'/g)].map((x) => x[1]).sort() : [];
  check('history.ts and ledger.ts agree on what seals', hist, [...L.SEALED_KINDS].sort());
}

// ---------- THE SECRET MUST NOT LEAK ----------
// setTiming never travels (SECRET_KINDS) and snapshots only locally - but a
// label is exactly the kind of surface that could smuggle the dial out later.
// The label may say a dial was set; it must never say to what.
{
  const meta = L.labelFor({ kind: 'setTiming', seat: 's1', uid: 1, timing: 'melee' }, state);
  check('a timing label names the unit', /Centurion/.test(meta.label), true);
  check('and never the timing', /melee/i.test(meta.label), false);
}

// ---------- the wiring: one vocabulary, both boards ----------
const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const matchSrc = readFileSync(new URL('../src/match.ts', import.meta.url), 'utf8');
const histSrc = readFileSync(new URL('../src/history.ts', import.meta.url), 'utf8');
check('the Match Centre records the human words',
  /const meta = labelFor\(cmd, s, ledgerNames\);\s*\r?\n\s*recordSnapshot\(s, cmd\.kind, \{ human: meta\.label, seat: meta\.seat, role: meta\.role \}\)/.test(matchSrc), true);
check('freeplay records through the same function',
  /labelFor\(cmd, s, ledgerNames\)/.test(mainSrc), true);
// The old coarse table is GONE, not shadowed: two label vocabularies for the
// same commands is the drift this codebase keeps refusing.
check('the freeplay UNDO_NAMES table is retired', /UNDO_NAMES/.test(mainSrc), false);
// The kind stays the snapshot's `label` - the sealed floor matches on it - and
// the words ride beside it. Swapping them would quietly break the catalog.
check('the snapshot keeps the KIND as its label', /recordSnapshot\(s, cmd\.kind,/.test(matchSrc), true);
check('history stores the words beside it, not instead of it',
  /human\?: string;/.test(histSrc) && /human: meta\?\.human,/.test(histSrc), true);
// The depth was raised WITH a measurement, not on faith.
check('the ring is 160 deep', /const LIMIT = 160;/.test(histSrc), true);
check('and the raise cites its measurement', /MEASURED before raising/.test(histSrc), true);

// ---------- U2: folding commands into player-sized UNITS ----------
// A unit's `start` is the rewind target: the board as that action began. The
// streams below are the real shapes the game produces, written out by hand so
// a change to the grouping rules has to answer to them.
const E = (kind, extra = {}) => ({ kind, round: 1, phase: 2, ...extra });
const units = (es) => L.groupLedger(es).map((u) => `${u.label}[${u.start}-${u.end}]${u.sealed ? '!' : ''}${u.quiet ? '~' : ''}`);

// An attack: the Charge spent to open it is its own unit (it happened, attack
// or no attack), then ONE unit from performAction through the kill - sealed,
// because dice were acted on inside it.
check('a charged attack folds to two units',
  units([
    E('setCharge', { human: 'Charge spent' }),
    E('performAction', { human: 'Thrust' }),
    E('spendAmmo'), E('answerDefense'), E('acceptRoll'),
    E('applyStatus'), E('applyPenetration'), E('recordKill'),
  ]),
  ['Charge spent[0-0]', 'Thrust[1-7]!']);

// Shock Attack: the free walk BELONGS to the action. A rewind target between
// the walk and the strike would put the board inside an action, which is the
// exact thing units exist to prevent.
check('a Shock Attack walk rides its action',
  units([
    E('performAction', { human: 'Thrust' }),
    E('maneuver', { role: 'follow', human: 'free move' }),
    E('acceptRoll'),
  ]),
  ['Thrust[0-2]!']);

// A plain maneuver begins its own unit and the shove it causes rides along.
check('a maneuver and its shove are one unit',
  units([E('maneuver', { role: 'begin', human: 'Maneuver to F4' }), E('forceMove')]),
  ['Maneuver to F4[0-1]']);

// A Tactics Card and the movement it grants are one unit.
check('a granted move rides its Tactics Card',
  units([E('playTactic', { human: 'Tactics: Redeploy' }), E('maneuver', { role: 'follow' })]),
  ['Tactics: Redeploy[0-1]']);

// The dual-use kinds: the same command attached mid-attack is a hand edit on
// its own. No open unit means a follow stands alone, unsealed and visible.
check('a lone token edit is its own unit',
  units([E('applyStatus', { human: 'RT-06 gains a fragile Token' })]),
  ['RT-06 gains a fragile Token[0-0]']);

// A boundary closes the open unit and never adopts followers.
check('a phase change closes the unit before it',
  units([
    E('maneuver', { role: 'begin', human: 'Maneuver' }),
    E('advancePhase', { human: 'Next phase' }),
    E('forceMove', { human: 'pushed' }),
  ]),
  ['Maneuver[0-0]', 'Next phase[1-1]', 'pushed[2-2]']);

// A round/phase CHANGE closes the unit even without a boundary command - a
// unit must never straddle a phase, or its rewind target lies about where the
// phase began.
check('a unit cannot straddle a phase',
  units([
    E('performAction', { human: 'Thrust' }),
    { kind: 'applyStatus', round: 1, phase: 3 },
  ]).length, 2);

// Quiet bookkeeping rides the open unit; standing alone it is marked quiet so
// a timeline can skip it - and it must never adopt the real command after it.
check('mirror frames ride the attack',
  units([E('performAction', { human: 'Thrust' }), E('setCombatView'), E('acceptRoll')]),
  ['Thrust[0-2]!']);
check('a lone catalog publish is quiet and adopts nothing',
  units([E('setRollbackCatalog', { human: 'Catalog' }), E('applyStatus', { human: 'edit' })]),
  ['Catalog[0-0]~', 'edit[1-1]']);

// Entries recorded before U2 carry no role: the kind-only fallback groups
// them, minus the free/granted nuance old snapshots cannot express.
check('old entries without a role still group',
  units([E('performAction', { human: 'Thrust' }), E('applyPenetration')]),
  ['Thrust[0-1]!']);

// The label falls back to the kind when no words were stored.
check('a wordless entry still has a name', units([E('unfold')]), ['unfold[0-0]']);

// ---------- U7: the MISSED attack still seals ----------
// The consequence kinds (applyPenetration, recordKill) only land when a roll
// carried consequences. A shot that whiffed fires none of them - the noteRoll
// the dice chokepoint records is the only seal it leaves, and it must be
// enough (found live 2026-08-25: a dodged Single Shot was offered for
// one-press undo, dice and all).
check('a missed attack is sealed by its rolls alone',
  units([
    E('performAction', { human: 'Single Shot' }),
    E('setCombatView'), E('noteRoll'), E('setCombatView'),
    E('noteRoll'), E('answerDefense'), E('setCombatView'),
  ]),
  ['Single Shot[0-6]!']);
// A lone noteRoll is quiet bookkeeping, never a row of its own...
check('a lone noteRoll is quiet and adopts nothing',
  units([E('noteRoll', { human: 'Dice hit the table' }), E('applyStatus', { human: 'edit' })]),
  ['Dice hit the table[0-0]!~', 'edit[1-1]']);

// Units carry their OPENING role so the catalog can drop phase machinery
// ("Next phase", "Set ready") without re-deriving validation (U7: those rows
// were listed beside the real actions).
check('a unit is stamped with its opening role',
  L.groupLedger([
    E('maneuver', { role: 'begin' }), E('advancePhase'), E('setReady'), E('applyStatus'),
  ]).map((u) => u.role),
  ['begin', 'boundary', 'boundary', 'follow']);

// Every command kind has a ROLE the grouper accepts - read off commands.ts so
// a new kind is covered the day it lands. The default is solo: a new command
// stands alone rather than being glued to a neighbour.
{
  const cmdSrc = readFileSync(new URL('../src/commands.ts', import.meta.url), 'utf8');
  const kinds = [...new Set([...cmdSrc.matchAll(/kind: '([a-zA-Z]+)'/g)].map((m) => m[1]))];
  const bad = kinds.filter((kind) => {
    const u = L.groupLedger([{ kind, round: 1, phase: 1 }]);
    return u.length !== 1 || u[0].start !== 0;
  });
  check('every kind lands as a well-formed unit on its own', bad, []);
  // And the roles labelFor reports match what the grouper would derive, so the
  // stored role and the fallback cannot disagree about the same command.
  const drift = kinds.filter((kind) => {
    const stored = L.labelFor({ kind }, { tokens: [] }).role;
    const grouped = L.groupLedger([{ kind, round: 1, phase: 1 }, { kind: 'applyStatus', round: 1, phase: 1 }]);
    const opens = grouped.length === 1;
    return (stored === 'begin') !== opens;
  });
  check('stored roles agree with the kind-only fallback', drift, []);
}


console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
