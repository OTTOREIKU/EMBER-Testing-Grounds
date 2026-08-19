// The board fingerprint that rides on every command. What matters most here is
// not that it notices a difference — that is easy — but that it stays silent on
// the differences the two clients are SUPPOSED to have. A false alarm resyncs an
// honest game, which is worse than not checking at all.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/secrecy.ts', import.meta.url), 'utf8');
const tmp = new URL('./_fingerprint.slice.ts', import.meta.url);
writeFileSync(tmp, 'type GameState = any;\ntype Side = any;\ntype Timing = any;\n' + src.replace(/^import[^\n]*\n/gm, ''));
const { boardFingerprint } = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

const tok = (uid, over = {}) => ({
  uid, side: 's1', kind: 'mech', cardId: 'T1', col: 3, row: 3, facing: 0, size: 3,
  stance: 'offensive', link: 4, deployed: true,
  partStates: { torso: 'intact', chasis: 'intact' }, statuses: [], ammo: {}, ...over,
});
const board = (over = {}) => ({
  round: { n: 1, phase: 2, firstPlayer: 's1' },
  map: 'alley', mission: null, scale: 'standard', roundLimit: 5,
  commandTokens: { s1: 0, s2: 0 },
  tokens: [tok(1), tok(2, { side: 's2', col: 9, row: 9 })],
  removedTerrain: [], smoke: [], markers: [],
  tasks: { vp: { s1: 0, s2: 0 }, items: [] },
  script: { turn: 's1', acted: [], passed: [], opp: null },
  ...over,
});

console.log('The board fingerprint\n');

// ---------- it is stable ----------

check('the same board hashes the same way', boardFingerprint(board()), boardFingerprint(board()));
// Token order is an artefact of how the array was built, not a fact about the
// game; a checkpoint can rebuild it in a different order.
const shuffled = board();
shuffled.tokens = [...shuffled.tokens].reverse();
check('token order does not change it', boardFingerprint(shuffled), boardFingerprint(board()));
const reKeyed = board();
reKeyed.tokens[0].partStates = { chasis: 'intact', torso: 'intact' };
check('nor does the order of a token\'s parts', boardFingerprint(reKeyed), boardFingerprint(board()));
const reStatus = board();
reStatus.tokens[0].statuses = ['fci', 'imb'];
const reStatus2 = board();
reStatus2.tokens[0].statuses = ['imb', 'fci'];
check('nor the order statuses were applied in', boardFingerprint(reStatus), boardFingerprint(reStatus2));

// ---------- it stays quiet about what may legitimately differ ----------

// This is the one that matters: dials are secret until both squads reveal, so
// each client knows only its own. Hashing them would report every Planning
// Phase as a desync.
const dialled = board();
dialled.tokens[0].timing = 'firing';
dialled.tokens[1].timing = 'melee';
check('a Timing Dial is not part of it', boardFingerprint(dialled), boardFingerprint(board()));

// Who Commanded a Drone MUST be hashed. It is not cosmetic: the A2 Data Link
// lets a Commanded Drone perform Automatic Actions and the M2 lets it move a
// grid first, so check() reads it — and a drift would have one client offering
// an Action the other refuses, which is exactly what this hash is for.
const commanded = board();
commanded.tokens[1].commandedBy = 1;
check('who Commanded a unit IS part of it', boardFingerprint(commanded) !== boardFingerprint(board()), true);
const commandedElsewhere = board();
commandedElsewhere.tokens[1].commandedBy = 2;
check('and a different issuer hashes differently',
  boardFingerprint(commanded) !== boardFingerprint(commandedElsewhere), true);

// RE-PINNED 2026-08-11, deliberately the other way round. The original pin
// said a hand of Tactics Cards is never fingerprinted, "never sent to the
// other client" — which stopped being true when setTactics became a mirrored
// command: both seats are told both hands, and playTactic's own check() reads
// the hand and tacticsPlayed on the RECEIVING side. A drift there makes one
// client refuse a play the other accepted, which is precisely what the hash
// exists to catch, so the hand went from must-not-hash to must-hash.
const handed = board({ tactics: { s1: ['274'], s2: [] } });
check('a Tactics hand IS caught, because setTactics mirrors it', boardFingerprint(handed) !== boardFingerprint(board()), true);
const played = board({ tacticsPlayed: { s1: ['1:274'], s2: [] } });
check('and so is the record of plays, which gates once-per-round', boardFingerprint(played) !== boardFingerprint(board()), true);
// Per-seat handshake bookkeeping differs by design.
const committed = board();
committed.script.commits = { s1: 'abc' };
committed.script.revealed = ['s1'];
check('nor the dial commitments', boardFingerprint(committed), boardFingerprint(board()));
// The one that stopped a live game: `opportunity()` mints `script.opp` from
// inside a render, so the sender hashes before its next frame and the receiver
// after its last one and the two differ by one every time. None of the turn
// bookkeeping is commanded, so none of it is comparable.
const opped = board();
opped.script.opp = { uid: 1, timing: 'firing', action: 2, maneuver: 1 };
check('and NOT the Action Opportunity, which each client derives itself', boardFingerprint(opped), boardFingerprint(board()));
const turned2 = board();
turned2.script.turn = 's2';
turned2.script.acted = [1, 2];
turned2.script.passed = ['s1'];
check('nor whose turn it is, or who has acted', boardFingerprint(turned2), boardFingerprint(board()));
const noScript = board({ script: undefined });
check('a board with no script at all hashes the same', boardFingerprint(noScript), boardFingerprint(board()));

// ---------- it notices what must not differ ----------

const moved = board();
moved.tokens[0].col = 6;
check('a unit standing somewhere else is caught', boardFingerprint(moved) !== boardFingerprint(board()), true);
const hurt = board();
hurt.tokens[1].partStates.torso = 'damaged';
check('a damaged Part is caught', boardFingerprint(hurt) !== boardFingerprint(board()), true);
const turned = board();
turned.tokens[0].facing = 2;
check('a different facing is caught', boardFingerprint(turned) !== boardFingerprint(board()), true);
const scored = board({ tasks: { vp: { s1: 2, s2: 0 }, items: [] } });
check('a difference in VP is caught', boardFingerprint(scored) !== boardFingerprint(board()), true);
const phased = board({ round: { n: 1, phase: 3, firstPlayer: 's1' } });
check('a different phase is caught', boardFingerprint(phased) !== boardFingerprint(board()), true);
const carried = board({ tasks: { vp: { s1: 0, s2: 0 }, items: [{ id: 'bb1', kind: 'blackbox', bearerUid: 1 }] } });
const loose = board({ tasks: { vp: { s1: 0, s2: 0 }, items: [{ id: 'bb1', kind: 'blackbox', col: 4, row: 4 }] } });
check('a Black Box in hand versus on the ground is caught', boardFingerprint(carried) !== boardFingerprint(loose), true);
const gone = board();
gone.tokens = [gone.tokens[0]];
check('a missing unit is caught', boardFingerprint(gone) !== boardFingerprint(board()), true);
const ammo = board();
ammo.tokens[0].ammo = { A1: 2 };
check('a spent Ammo Token is caught', boardFingerprint(ammo) !== boardFingerprint(board()), true);

// The four blind spots closed on 2026-08-11 — all commanded, all read back by
// check(), and until then all invisible to the hash.
const charged = board();
charged.tokens[0].charge = ['torso'];
check('a Charged Part is caught', boardFingerprint(charged) !== boardFingerprint(board()), true);
const aging = board();
aging.tokens[0].statuses = ['fci'];
const aged = board();
aged.tokens[0].statuses = ['fci'];
aged.tokens[0].expiring = ['fci'];
check('a token showing its red face is caught', boardFingerprint(aged) !== boardFingerprint(aging), true);
const laden = board();
laden.tokens[0].droneBackpack = '013';
check('a Drone\'s Load is caught', boardFingerprint(laden) !== boardFingerprint(board()), true);
// Found 2026-08-11 while closing D7: both of these are commanded AND read back
// by rules, and both were missed by the first fingerprint sweep the same day.
const repaired = board();
repaired.tokens[0].repairedSlots = ['leftHand'];
check('a Repaired Token is caught — check() reads it on both seats',
  boardFingerprint(repaired) !== boardFingerprint(board()), true);
const credited = board();
credited.tokens[1].lastDamagedBy = { side: 's1', uid: 1 };
const credited2 = board();
credited2.tokens[1].lastDamagedBy = { side: 's2', uid: 2 };
check('and so is the kill credit, which decides who scores an Integrity-Loss removal',
  boardFingerprint(credited) !== boardFingerprint(credited2), true);

const armed = board();
armed.tokens[0].mech = { torso: 'T1', chasis: 'C1' };
const rearmed = board();
rearmed.tokens[0].mech = { torso: 'T1', chasis: 'C2' };
check('a different Part in a Mech slot is caught', boardFingerprint(armed) !== boardFingerprint(rearmed), true);
// Slot order is an object artefact, not a fact about the Mech.
const slotOrder = board();
slotOrder.tokens[0].mech = { chasis: 'C1', torso: 'T1' };
check('but the order of the slots is not', boardFingerprint(slotOrder), boardFingerprint(armed));

// A Tether chip is rules-bearing twice over: the leash REFUSES Grids the other
// client would otherwise offer, and the pair is what holds a Harpoon's Tether
// Mode face on. A drift makes one client accept a Maneuver the other rejects.
const leashed = board();
leashed.tokens[1].tether = [{ uid: 1, range: 4, role: 'tethered' }];
check('a Tether chip IS part of it', boardFingerprint(leashed) !== boardFingerprint(board()), true);
const shorter = board();
shorter.tokens[1].tether = [{ uid: 1, range: 2, role: 'tethered' }];
check('and the leash length changes it', boardFingerprint(leashed) !== boardFingerprint(shorter), true);
// The asymmetry is the rule, so the two ends must not hash alike: swapping who
// holds whom would otherwise be invisible.
const flipped = board();
flipped.tokens[1].tether = [{ uid: 1, range: 4, role: 'initiator' }];
check('as does which end of it a unit is', boardFingerprint(leashed) !== boardFingerprint(flipped), true);

// ---------- shape ----------

check('it is short enough to ride on every command', boardFingerprint(board()).length <= 8, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
