// Checks the icon-offsetting allocator against rulebook 4.4 step 6.
//   1 [Dodge]   offsets 1 of ANY icon      -> not a Hit at all
//   1 [Defense] offsets 1 [Light Hit] ONLY -> still counts as a Hit
import { readFileSync, writeFileSync } from 'node:fs';

// Slice out just the exported allocator — combat.ts's other imports need the DOM. Written to
// a .ts file and imported directly; Node 24 strips the type annotations itself.
const src = readFileSync(process.argv[2] ?? new URL("../src/combat.ts", import.meta.url), 'utf8');
const start = src.indexOf('export function offsetIcons');
const end = src.indexOf('const ICON_LABEL');
if (start < 0 || end < 0) throw new Error('could not locate offsetIcons in ' + process.argv[2] ?? new URL("../src/combat.ts", import.meta.url));
const slice = src.slice(start, end);
const tmp = new URL('./_offset.slice.ts', import.meta.url);
writeFileSync(tmp, 'interface DuelIcon { kind: string; offset: "dodge" | "defense" | null }\n' + slice);
const { offsetIcons } = await import(tmp.href); // already a file: URL — don't re-encode it

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = Object.entries(want).every(([k, v]) => got[k] === v);
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else {
    fail++;
    console.log(`  FAIL ${name}`);
    console.log(`       want ${JSON.stringify(want)}`);
    console.log(`       got  ${JSON.stringify(Object.fromEntries(Object.keys(want).map(k => [k, got[k]])))}`);
  }
};

console.log('offsetIcons — rulebook 4.4 step 6\n');

// Dodge is the universal canceller and must go to Heavy first, since Defense cannot.
check('2H+1L vs 2 Dodge, 1 Defense -> nothing gets through',
  offsetIcons(2, 1, 2, 1), { dodged: 2, blocked: 1, penetrating: 0, hits: 1, spareDodge: 0, idleDefense: 0 });

// The rule this view exists to teach: Defense cannot touch a Heavy Hit.
check('1H vs 0 Dodge, 3 Defense -> Heavy penetrates, all Defense idle',
  offsetIcons(1, 0, 0, 3), { dodged: 0, blocked: 0, penetrating: 1, hits: 1, idleDefense: 3 });

// Wasted Dodge is surfaced rather than silently dropped.
check('no icons vs 2 Dodge -> both spare',
  offsetIcons(0, 0, 2, 0), { dodged: 0, blocked: 0, penetrating: 0, hits: 0, spareDodge: 2 });

// Defense-blocked icons still count as Hits (drives "on Hit" effects).
check('3L vs 1 Dodge, 1 Defense -> 1 dodged, 1 blocked, 1 through, 2 Hits',
  offsetIcons(0, 3, 1, 1), { dodged: 1, blocked: 1, penetrating: 1, hits: 2 });

// Dodge spent on Heavy even when Lights are also present and Defense could cover them.
check('1H+2L vs 1 Dodge, 2 Defense -> Dodge takes the Heavy',
  offsetIcons(1, 2, 1, 2), { dodged: 1, blocked: 2, penetrating: 0, hits: 2 });
const alloc = offsetIcons(1, 2, 1, 2).icons;
check('  ^ and the dodged icon is the Heavy, not a Light',
  { k: alloc.find(i => i.offset === 'dodge').kind }, { k: 'heavyHit' });

// Overkill defence against a mixed roll.
check('2H vs 5 Dodge -> both dodged, 3 spare, no Hits',
  offsetIcons(2, 0, 5, 0), { dodged: 2, penetrating: 0, hits: 0, spareDodge: 3 });

// Nothing at all.
check('0 vs 0 -> clean miss',
  offsetIcons(0, 0, 0, 0), { dodged: 0, blocked: 0, penetrating: 0, hits: 0 });

// Every icon accounted for, across a wide sweep (no icon lost or double-counted).
let sweepBad = 0;
for (let h = 0; h <= 4; h++) for (let l = 0; l <= 4; l++) for (let d = 0; d <= 4; d++) for (let f = 0; f <= 4; f++) {
  const r = offsetIcons(h, l, d, f);
  const conserved = r.dodged + r.blocked + r.penetrating === h + l;
  const dodgeOk = r.dodged + r.spareDodge === d;
  const defOk = r.blocked + r.idleDefense === f;
  const hitsOk = r.hits === h + l - r.dodged;
  // a Heavy may never be offset by Defense
  const legal = r.icons.every(i => !(i.kind === 'heavyHit' && i.offset === 'defense'));
  // Defense must never sit idle while an un-offset Light Hit remains
  const greedy = !(r.idleDefense > 0 && r.icons.some(i => i.kind === 'lightHit' && !i.offset));
  if (!(conserved && dodgeOk && defOk && hitsOk && legal && greedy)) {
    sweepBad++;
    if (sweepBad <= 3) console.log(`  FAIL sweep H${h} L${l} D${d} F${f}`, JSON.stringify(r));
  }
}
check(`sweep 625 combinations — conservation, legality, greediness`, { bad: sweepBad }, { bad: 0 });

// Dense Armor (致密装甲): {Defense} may offset {Heavy Hit} too.
check('Dense Armor: 1H vs 0 Dodge, 3 Defense -> the Heavy is blocked',
  offsetIcons(1, 0, 0, 3, true), { dodged: 0, blocked: 1, penetrating: 0, hits: 1, idleDefense: 2 });
check('Dense Armor off by default keeps the old answer',
  offsetIcons(1, 0, 0, 3), { blocked: 0, penetrating: 1 });
check('Dense Armor: 2H+1L vs 1 Dodge, 2 Defense -> everything offset',
  offsetIcons(2, 1, 1, 2, true), { dodged: 1, blocked: 2, penetrating: 0, hits: 2 });


// ---------- Dodge Enhancement (ZYBP-302): a Dodge cancels a DIE ----------
//
// "When this Mech is hit, may spend 1 Command Token, make each {Dodge} offset 1
// Attack die." Normally one Dodge cancels one ICON; with this, it cancels every
// hit icon that one attack die produced. Passing the per-die breakdown is what
// switches the allocator over; without it nothing changes.

// A die showing 2 Heavy is worth far more than one showing 1 Light, and the
// single Dodge must take the expensive one.
check('one Dodge cancels the whole of the heaviest die',
  offsetIcons(2, 1, 1, 0, false, [{ heavy: 2, light: 0 }, { heavy: 0, light: 1 }]),
  { dodged: 2, penetrating: 1, spareDodge: 0 });
// The same roll WITHOUT the enhancement: one Dodge, one icon.
check('and without it the same Dodge cancels only one icon',
  offsetIcons(2, 1, 1, 0),
  { dodged: 1, penetrating: 2 });
check('two Dodges cancel two dice',
  offsetIcons(2, 2, 2, 0, false, [{ heavy: 1, light: 1 }, { heavy: 1, light: 1 }]),
  { dodged: 4, penetrating: 0 });
check('a spare Dodge is still spare when the dice run out',
  offsetIcons(1, 0, 3, 0, false, [{ heavy: 1, light: 0 }]),
  { dodged: 1, penetrating: 0, spareDodge: 2 });
// Defense still only offsets Light Hits, on whatever the Dodges left standing.
check('Defense mops up the Light Hits the Dodges did not reach',
  offsetIcons(1, 2, 1, 1, false, [{ heavy: 1, light: 0 }, { heavy: 0, light: 1 }, { heavy: 0, light: 1 }]),
  { dodged: 1, blocked: 1, penetrating: 1 });
// A die that rolled no hit icon is not something a Dodge should be spent on.
check('an empty die is never worth a Dodge',
  offsetIcons(1, 0, 1, 0, false, [{ heavy: 0, light: 0 }, { heavy: 1, light: 0 }]),
  { dodged: 1, penetrating: 0, spareDodge: 0 });
// The totals must survive even if the caller's per-die breakdown is short.
check('icons the breakdown missed are still counted',
  offsetIcons(2, 0, 1, 0, false, [{ heavy: 1, light: 0 }]),
  { dodged: 1, penetrating: 1, hits: 1 });

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
