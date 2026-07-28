// Checks the Projectile launch attributes: Volley X and the sight requirement.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/units.ts', import.meta.url), 'utf8');
const start = src.indexOf('// Volley X:');
const end = src.indexOf('export function interceptCapacity');
if (start < 0 || end < 0) throw new Error('could not locate the launch helpers in units.ts');
const tmp = new URL('./_launch.slice.ts', import.meta.url);
writeFileSync(tmp, 'type CardAction = any;\n' + src.slice(start, end));
const { volleyOf, needsSightToLanding } = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

const act = (zh = '', keywords = [], en = '') => ({ id: 'a', description: { zh, en }, keywords });

console.log('Projectile launch attributes\n');

// Volley X means up to X Projectiles for X Ammo; no keyword means one.
check('no keyword is a single shot', volleyOf(act()), 1);
check('Volley 2 in the text', volleyOf(act('· 齐射2  · 曲射')), 2);
check('Volley 3 in the text', volleyOf(act('· 齐射3')), 3);
check('an inline keyword counts', volleyOf(act('', [{ inline: '齐射2' }])), 2);
check('a keyword key counts', volleyOf(act('', [{ key: '齐射3' }])), 3);
check('the japanese spelling counts', volleyOf(act('·斉射2')), 2);
check('the english spelling counts', volleyOf(act('', [], '· Volley 2 · Fire in arc')), 2);
// The DTG-30S card prints "Volly 2", so the reading has to survive that typo.
check('the card typo Volly still reads', volleyOf(act('', [], '· Volly 2')), 2);
check('a spaced form reads', volleyOf(act('· 齐射 2')), 2);
check('a nonsense value never drops below one', volleyOf(act('· 齐射0')), 1);

// Direct Fire needs sight of the Landing Point; Fire in arc explicitly does not.
check('Fire in arc needs no sight', needsSightToLanding(act('· 曲射')), false);
check('Direct Fire needs sight', needsSightToLanding(act('· 直射')), true);
check('the english Fire in arc counts', needsSightToLanding(act('', [], '· Fire in arc')), false);
check('the english Direct Fire counts', needsSightToLanding(act('', [], '· Direct Fire')), true);
check('an inline arc keyword counts', needsSightToLanding(act('', [{ inline: '曲射' }])), false);
// Neither keyword means no stated sight requirement, so nothing extra is imposed.
check('an unmarked action imposes nothing', needsSightToLanding(act('· 发射1枚导弹。')), false);
// Fire in arc wins if a card somehow carries both, since it is the explicit waiver.
check('arc beats direct when both appear', needsSightToLanding(act('· 直射 · 曲射')), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
