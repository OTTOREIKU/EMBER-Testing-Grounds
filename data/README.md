# Extracted Game Data

Extracted 2026-07-23 from the community builder site bundle
(watermelon02.github.io/builder-web, `assets/index.DZ3TxGWT.js`) and the official
rulebook v1.0. Re-extract with `node tools/extract_cards.js` / `extract_terrain.js`
(paths inside point at a downloaded copy of the bundle).

Re-checked 2026-07-29 against the then-current bundle (`assets/index.BXLZ9l80.js`).
All 401 cards still matched by id, and across every numeric stat plus `stance` only
three values had changed upstream: 078 and 079 stance offensive to defensive, and 161
move 0 to 5. All three are corrections the site made after our snapshot, and all three
were already covered by `stat_overrides.json` from the card scans, so nothing needed
re-extracting. Note that the site is where this data came from, so it cannot be used to
verify a stat, only to see what upstream has changed since. Four errors found in the
scan sweep (159, 074, 158, ZHAM-002) are still present upstream.

## cards.json — 401 cards
One flat array; `category` distinguishes: `mech_part` (273), `pilot` (52), `drone` (44),
`projectile` (26), `tactics_or_upgrade` (6).

Common fields: `id`, `name {zh,en,jp}` (19 zh-only), `score` (points), `armor`,
`structure`, `parray` (parry), `dodge`, `electronic`, `move`, `stance`, `type`
(torso/chasis/leftHand/rightHand/backpack | small/medium/large), `keywords`
(`{key, en}` → keywords.json, or `{inline}` for parameterized ones like 拦截1),
`containedIn [{box, quantityPerBox}]` (→ boxes.json), `actions[]` with
`{name, type (Firing/Melee/Moving/Projectile/Passive...), speed, range (0 = adjacent
"--"), yellowDice, redDice, storage, description {zh,en,jp}, keywords, gameRules?}`.
Some cards carry machine-readable `gameRules` `{conditions[], effects[]}` — use where
present, but don't rely on full coverage.

Pilots instead have timing initiative values: `swift, melee, projectile, firing,
movement/tactical...` plus `LV`, `faction` (RDL/UN/GOF/PD). NOTE: `projectile` is a
number on pilots but an id-array on launcher parts.

Image mapping: `assets/cards/en/<id>.png` (376/401 exist; missing = untranslated),
token art `assets/tokens/tab/<id>.png` (353/401), part art `assets/mech_parts/`.

## keywords.json — 57 entries
`{key (zh canonical), zh/en/jp: {name, value}}` — full rules text per language.
Tooltip-ready. Cross-check subtle ones against the printed rulebook's appendix
(the book has a couple of print errata the site may or may not repeat).

## boxes.json — 26 retail boxes
`{key, id, faction[], name {zh,en,jp}, hasImage}`.

## dice.json
Exact face tables for the 4 custom d8s + black d6, plus offset-rule notes.
Source: rulebook §2.3 (verified against page scans).

## terrain_layouts.json — 3 maps
`maps[]` (alley/crossroads/hotspot with trilingual names) and `layouts{}` — terrain
pieces as `{id, type (building/high_wall/low_wall/container), subCells [{col,row}]
on the 36×36 small-grid, height (1-3), blocksLos, providesProtection, isFragile}`.
Matches rulebook terrain semantics (high 3" blocks LOS; low 2" gives protection;
containers fragile/destructible).
