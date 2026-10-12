# Game data

The app loads every file here at start. Three were extracted once, on 2026-07-23, from the
community builder site bundle (watermelon02.github.io/builder-web, `assets/index.DZ3TxGWT.js`)
and the official rulebook v1.0: `cards.json`, `keywords.json` and `boxes.json`. Everything else
is written by hand from the printed cards, the rulebook, the publisher's parts lists and FAQ, and
the official card pages, and each of those files says where it came from in its own `_comment`.

**Never regenerate the extracted files.** The corrections live in override files that the app
merges over them at load, and `keywords.json` has since been edited by hand as well, so a fresh
extraction would quietly undo work. The extraction scripts were retired for that reason. To see what
the community builder has changed since, compare its cards with ours by id: it is where this data
came from, so it can show what changed upstream but never verify a stat.

Re-checked 2026-07-29 against the then-current bundle (`assets/index.BXLZ9l80.js`). All 401
cards still matched by id, and across every numeric stat plus `stance` only three values had
changed upstream: 078 and 079 stance offensive to defensive, and 161 move 0 to 5. All three were
already covered by `stat_overrides.json` from the card scans. Four errors found in the scan sweep
(159, 074, 158, ZHAM-002) were still present upstream.

## The cards

**`cards.json`: 401 cards** (extracted). One flat array; `category` distinguishes: `mech_part`
(273), `pilot` (52), `drone` (44), `projectile` (26), `tactics_or_upgrade` (6).

Common fields: `id`, `name {zh,en,jp}` (19 zh-only; `name_overrides.json` gives them English),
`score` (points), `armor`, `structure`, `parray` (parry), `dodge`, `electronic`, `move`,
`stance`, `type` (torso/chasis/leftHand/rightHand/backpack | small/medium/large), `keywords`
(`{key, en}` → keywords.json, or `{inline}` for parameterized ones like 拦截1),
`containedIn [{box, quantityPerBox}]` (→ boxes.json), `actions[]` with
`{name, type (Firing/Melee/Moving/Projectile/Passive...), speed, range (0 = adjacent "--"),
yellowDice, redDice, storage, description {zh,en,jp}, keywords, gameRules?}`. Some cards carry
machine-readable `gameRules` `{conditions[], effects[]}`; use them where present, but don't rely
on full coverage.

Pilots instead have timing initiative values: `swift, melee, projectile, firing,
movement/tactical...` plus `LV`, `faction` (RDL/UN/GOF/PD). NOTE: `projectile` is a number on
pilots but an id-array on launcher parts.

Merged over the cards at load:

| File | What it holds |
|---|---|
| `cards_extra.json` | 24 cards the bundle does not have (14 parts, 5 pilots, 4 drones, 1 projectile) |
| `stat_overrides.json` | stats the extracted cards get wrong, read off printed cards and the publisher's lists |
| `action_overrides.json` | per-action corrections, keyed by the card id plus its A/B slot |
| `action_translations.json` | English for actions whose source has none |
| `ammo_overrides.json` | Ammo Token counts the bundle does not carry |
| `name_overrides.json` | English names where the extracted `en` still holds Chinese or Japanese |
| `faction_overrides.json` | per-card faction corrections |
| `box_contents_overrides.json` | box membership corrections |
| `qr_ids.json` | the publisher's QR ids for cards held under a serial-style id |

Images: `assets/cards/en/<id>.webp` (373 of the 425 cards), token art `assets/tokens/tab/<id>.webp`
(362 of 425), part art `assets/mech_parts/`.

## The rules

| File | What it holds |
|---|---|
| `keywords.json` | 60 glossary entries, `{key (zh canonical), zh/en/jp: {name, value}}` (extracted, then three added by hand) |
| `keyword_overrides.json` | glossary fixes from the rulebook, merged over keywords.json |
| `mechanics.json` | rules that Action names refer to but which are not glossary keywords, and the Seasons |
| `common_actions.json` | the seven Common Actions every Mech has (rulebook 6.1) |
| `play.json` | round phases, Action Timings and Stances |
| `tactics.json` | the six Tactics Cards' rules text |
| `dice.json` | exact face tables for the 4 custom d8s and the black d6, with the offset rules (rulebook 2.3) |
| `tokens.json` | every physical token in the box, for the Reference |
| `changelog.json` | what each rules and card update changed |

## The battlefield

| File | What it holds |
|---|---|
| `terrain_layouts.json` | 4 maps (alley, crossroads, hotspot, steelworks): terrain pieces on the 36x36 small grid with height, line of sight, protection and fragility |
| `board_maps.json` | the shipped maps in the map editor's own format: terrain, zones, deployment and per-Task layers |
| `zones.json` | Tactical Zones and deployment zones read off the Main Task cards |
| `missions.json` | the Main Task cards |
| `secondary.json` | the 8 Secondary Task cards |
| `environments.json` | the Environment Cards (rulebook 5.4.1) |

## Boxes and factions

| File | What it holds |
|---|---|
| `boxes.json` | 26 retail boxes, `{key, id, faction[], name {zh,en,jp}, hasImage}` (extracted) |
| `box_status.json` | whether each box has actually been produced |
| `factions.json` | faction lore for the Reference |

## Games

| File | What it holds |
|---|---|
| `solo.json` | the ready-made games against the computer: map, Main Task, length and squads |
| `ai/judge-v4.json` | the Ace's learned judge of a position |
