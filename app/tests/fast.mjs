// The quick part of the suite, which the deploy runs before it builds (the code
// audit, 2026-10-12): every test that finished in under five seconds in each of
// three whole-suite runs on a busy desktop; 38 s for all of them, one after
// another, on the same desktop idle.
// The long ones (whole games, the computer's own suites) stay with the full
// proof before a push. One at a time, because tests write their bundles and
// slices under fixed names.
//   node tests/fast.mjs          (from app/)
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FAST = `
accountscreen activation aiseam ammo amplify announce api armorpiercing askband attackmode auditbugs aurareach
auras autoshield blastorder boardart boardhover boardwalk boxes breakaway camo cardplaceholder changelog charge
colourpicker combatrole commandgen commands containerclick contest coordination104 counterroll crush datashape
deadopp defender defensereaction deployroom dialog disarm dodgedie dodgehold emdash endaward englishtext environments
faction features feltclip fingerprint flight focuspublish followup formswitch fpstamp glyphs gofchassis gridref
hindered hostileinput idleactions immobilized intercept jamkeep keystone keywordlink knockback largeboard launch
learned ledger linkaudit linksupport linktick loads lockon loops lowprofile maneuver mapeditor martyrdom mechanics
mechanics1 mechanics2 mechanics3 mechanics4 mechanics5 mechanics6 mechbuilder mechlayers meleelock mines movepath
movespot multitarget net noboard nonhumanoid noticepages notices offset onhit padew padreference padstrip padticks
partfaces pilottraits playerodds projflight protection reaction refglossary reftone rejoin report riposte rollback
rulings rws safetext scanattack script season seasonplay seat seataccessfirst seatboxplace seatcommandnext seathorizon seatlines seatnohold seatrws seatlaunchbias seatlaunchthreat seatbait seatspent seatumbrella seatnotarget seatoverkill seatflight auranote seatammopace
seatreach seatseconds seatsighted seattow selfgrant setup shockattack sidecolours sightview signout simgame singleshot smoke
smokesquad solosetup squadpanel squadtactics stacked stakes standing stealth stock straightline supplement104
suppression surplus surplusdefense tabletokens tactichand tactics targettrace tasks tether ticks tiebreak
tokendecay tokenshapes tracepath tracer traits twohanded update104 updates viewline vippending vprider whitedwarf
wiring wrecking
`.trim().split(/\s+/).map((n) => `tests/${n}.test.mjs`);

const app = fileURLToPath(new URL('..', import.meta.url));
// A test taken out of the suite must come out of here too, or the deploy would
// quietly stop running it.
const suite = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
const lost = FAST.filter((f) => !existsSync(new URL(`../${f}`, import.meta.url)) || !suite.includes(`node ${f}`));
if (lost.length) {
  console.log(`Not in the suite: ${lost.join(', ')}`);
  process.exit(1);
}

const failed = [];
const t0 = Date.now();
for (const f of FAST) {
  const r = spawnSync(process.execPath, [f], { cwd: app, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.status === 0) continue;
  failed.push(f);
  console.log(`FAIL ${f} (exit ${r.status})`);
  console.log(out.split('\n').filter((l) => /FAIL|Error/.test(l)).slice(0, 20).join('\n'));
  console.log(out.split('\n').slice(-15).join('\n'));
}
console.log(`${FAST.length - failed.length} of ${FAST.length} test files passed in ${Math.round((Date.now() - t0) / 1000)} s`);
process.exitCode = failed.length ? 1 : 0;
