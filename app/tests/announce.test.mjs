// Telling the OTHER player what you just did.
//
// Reported 2026-08-19: "Charging doesn't alert the other player when I do it,
// I wanted to charge my gun but my friend didn't know what I did when my turn
// passed as he got no notification."
//
// Most commands announce themselves — a roll reaches the shared dice feed, a
// move animates, an attack opens the combat mirror. Charging changes the board
// silently, and noteNow is LOCAL to whoever pressed the button, so the acting
// client's note never travels. announceRemote is the seam: it runs on the
// WATCHING client after a remote command has been applied.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};
const match = readFileSync(new URL('../src/match.ts', import.meta.url), 'utf8');

console.log('Remote action announcements\n');

check('announceRemote exists', /function announceRemote\(cmd: Command\): void/.test(match), true);
check('and it names a Charge either way',
  /cmd\.kind === 'setCharge'[\s\S]{0,400}Charges its[\s\S]{0,200}spends the Charge/.test(match), true);

// It must run on the WATCHING client, after the command has actually applied.
const call = match.indexOf('announceRemote(cmd);');
const applied = match.indexOf('const verdict = applyRemote(data, state, cmd);');
const guard = match.indexOf('if (catchingUp) return;');
check('it is called from the remote-apply path', call > 0, true);
check('after the command has been applied, not before', applied > 0 && call > applied, true);
// A replay re-runs every command; announcing there would spam the panel with
// history the moment a player rejoins.
check('and after the replay guard, so a rejoin does not re-announce history',
  guard > 0 && call > guard, true);

// The note channel has to be the shared panel line, not the acting client's.
check('it writes the panel note', /announceRemote[\s\S]{0,900}lobbyNote =/.test(match), true);
check('and it names which squad acted, since the watcher did not do it',
  /announceRemote[\s\S]{0,900}squadLabel\(cmd\.seat\)/.test(match), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
