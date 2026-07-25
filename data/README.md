# Extracted Game Data

Extracted 2026-07-23 from the community builder site bundle
(watermelon02.github.io/builder-web, `assets/index.DZ3TxGWT.js`) and the official
rulebook v1.0. Re-extract with `node tools/extract_cards.js` / `extract_terrain.js`
(paths inside point at a downloaded copy of the bundle).

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
Tooltip-ready. Cross-check subtle ones against `rules/06_missions_and_appendix.md`
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
