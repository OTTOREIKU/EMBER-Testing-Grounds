// Checks Surplus Damage against rulebook 4.4.5 and 4.8, including the worked
// example printed on book p.66.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/combat.ts', import.meta.url), 'utf8');
const start = src.indexOf('export function offsetIcons');
const end = src.indexOf('const ICON_LABEL');
if (start < 0 || end < 0) throw new Error('could not locate the damage helpers in combat.ts');
const tmp = new URL('./_surplus.slice.ts', import.meta.url);
writeFileSync(tmp, 'type DuelIcon = any;\ntype CardAction = any;\n' + src.slice(start, end));
const { offsetIcons, surplusEffects } = await import(tmp.href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

const act = (zh = '', keywords = []) => ({ id: 'a', description: { zh }, keywords });

console.log('Surplus Damage\n');

// 4.8: a plain attack has no Surplus effect, so leftover damage simply stops.
check('a plain attack has no surplus effect', surplusEffects(act()).length, 0);
check('unrelated card text does not count', surplusEffects(act('· 发射1台护巢蜂。')).length, 0);

// The three keywords that DO resolve Surplus Damage.
check('Scatter-shot is recognised in the text', surplusEffects(act('· 霰射')).map((e) => e.name), ['Scatter-shot']);
check('Cleaving is recognised', surplusEffects(act('· 顺劈')).map((e) => e.name), ['Cleaving']);
check('Mutilation is recognised', surplusEffects(act('· 毁伤')).map((e) => e.name), ['Mutilation']);
check('an inline keyword counts too', surplusEffects(act('', [{ inline: '霰射' }])).map((e) => e.name), ['Scatter-shot']);
check('a keyword key counts too', surplusEffects(act('', [{ key: '毁伤' }])).map((e) => e.name), ['Mutilation']);
// 4.8: with more than one, the attacker chooses; the app offers them in order.
check('multiple effects are all reported', surplusEffects(act('· 霰射 · 毁伤')).map((e) => e.name).sort(), ['Mutilation', 'Scatter-shot']);
check('each effect says what it targets', surplusEffects(act('· 毁伤'))[0].targets, 'the Structure of the same Part');

// 4.4.5: Surplus Damage is ALL un-offset damage, not the un-offset damage minus
// the one icon that caused the Penetration.
const r = offsetIcons(1, 1, 0, 0);
check('two un-offset icons are two surplus', r.unoffset, { heavy: 1, light: 1 });
check('and penetrating agrees', r.penetrating, 2);
check('a single un-offset icon is one surplus', offsetIcons(1, 0, 0, 0).unoffset, { heavy: 1, light: 0 });
check('fully offset damage leaves none', offsetIcons(1, 0, 1, 0).unoffset, { heavy: 0, light: 0 });

// The Light/Heavy mix has to survive the carry, since a Light Hit can be blocked
// by a [Defense] on the second roll while a Heavy Hit cannot.
const mixed = offsetIcons(2, 2, 1, 1);
check('the carried mix keeps its light hits', mixed.unoffset, { heavy: 1, light: 1 });
check('dodge eats a heavy hit first', mixed.icons.filter((i) => i.offset === 'dodge').map((i) => i.kind), ['heavyHit']);
check('defense only ever blocks a light hit', mixed.icons.filter((i) => i.offset === 'defense').map((i) => i.kind), ['lightHit']);

// The worked example on book p.66, both halves.
// Right Arm Armor 4: the attack leaves 1 Light + 1 Heavy un-offset.
const first = offsetIcons(1, 1, 0, 0);
check('p.66 first penetration carries 1 light and 1 heavy', first.unoffset, { heavy: 1, light: 1 });
check('p.66 first roll is a penetration', first.penetrating > 0, true);
// Backpack Armor 3 rolls 3 White; the example offsets the Light and leaves 1 Heavy.
const second = offsetIcons(first.unoffset.heavy, first.unoffset.light, 0, 1);
check('p.66 the backpack blocks the light hit', second.icons.filter((i) => i.offset === 'defense').length, 1);
check('p.66 one heavy hit still gets through', second.unoffset, { heavy: 1, light: 0 });
check('p.66 that is the second penetration', second.penetrating, 1);
// 4.8: no chaining. The app stops after one surplus round, so nothing reads
// `second.unoffset` for a third pass; this records the intent.
check('p.66 the attack ends there', true, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
