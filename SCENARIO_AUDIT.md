# Scenario accuracy audit

All ten demo booklets by **Luna Lilly Games** were re-checked line by line against the versions
built into EMBER Testing Grounds (`data/scenarios.json`). Text was extracted from the original
PDFs and compared field by field: team lists and points, deployment grids and facings, terrain,
objective markers, round counts and scoring rows.

**Result: the ten scenarios faithfully reproduce the booklets.** Every place the app differs
from a booklet is one of the four causes below, each recorded per scenario in the JSON and shown
in-app when the scenario loads.

| Scenario | Deployment | Terrain | Markers | Rounds | Scoring |
|---|---|---|---|---|---|
| RDL Core Box Demo | exact | exact | exact | 3 | exact |
| UN Core Box Demo | exact | exact | exact | 3 | exact |
| Asymmetric Duel | exact | exact | exact | as printed | exact |
| Advanced Stealth Duel | exact | as printed (no containers) | exact | as printed | exact |
| Signal Relay War | exact | inferred (see 3) | exact | as printed | exact |
| Missile Umbrella | exact | inferred (see 3) | exact | as printed | exact |
| Power Spike | exact | none printed | exact | as printed | exact |
| Breach the Gate | exact | gate printed, type inferred (see 5) | as printed | exact |
| Hold Until Extraction | exact | none printed (prose only) | exact | as printed | exact |
| Full Game Setup Guide | zones only (see 4) | exact | exact | as printed | exact |

## Why the point totals do not always add up

The app sums the points of the actual cards it places. Three things in the booklets mean that sum
can differ from the printed team total, and none of them is an error on either side.

**1. Non-unit point lines.** Several team lists include entries that are not parts or units:
Power Spike has "Resource training kit / Ammo Cache / Charge Relay scenario value" at 27 (RDL)
and 28 (UN), and Missile Umbrella applies a **Teaching balance adjustment of −148** to the UN
list. No sum of cards can reach those printed totals, by design.

**2. Loadouts with two parts in one slot.** A mech has one of each slot, but some lists give two.
Each case is recorded and the second part is left off:

| Scenario | Unit | Booklet lists | Conflict |
|---|---|---|---|
| UN Core Box Demo | Red Fireline M.A.P. | R33 Sniper Rifle **and** R7 Automatic Rifle | cards 106 and 104 are both right-hand only |
| Advanced Stealth Duel | (stealth ace) | R6SD SMG **and** R9B Tactical Rifle | cards 124 and 127 are both right-hand only |
| Signal Relay War | Relay Marksman | AC-32 **and** R-35 Heavy Railgun | both right-hand only |
| Signal Relay War | Network Breaker | R6SD SMG **and** R9B Tactical Rifle; OCSP Pack **and** EBS/X40 | right hand, then two backpacks |
| Missile Umbrella | RDL Missile Artillery | ML-34 Quad Missile Rack **and** ECS-2 Cooler | both backpacks |
| Missile Umbrella | UN Escort | M15BO Katana **and** R6SD SMG | both right-hand only |
| Breach the Gate | UN Anchor | S9 Meteor Shield + IGX106 **and** S100 Shield | both left-hand only |
| Power Spike | RDL Missile Brawler | ML-34 Quad Missile Rack **and** SH-15 Field Repair System | both backpacks |

**3. Two parts are missing from the community card database.** Missile Umbrella's UN Escort
M.A.P. calls for **TM17 "Wolfhound" Guard Core** (42) and **LM108 Agile Chassis** (30). Neither
appears in the card data the app is built from, so that mech is placed with only the parts that do
exist. This is the one gap that is not a booklet quirk and not fixable on our side.

**4. Terrain and deployment that the booklets do not print.** Signal Relay War and Missile Umbrella
describe the centre as terrain-heavy or blocked without itemising grids, so the series-standard
layout from the Core Box demos was reused. Hold Until Extraction likewise describes a centre
"blocked by wreckage and walls" in prose but prints no terrain rows, so none are placed. The Full
Game Setup Guide gives deployment *zones* (RDL columns A–B, UN columns K–L) rather than grids, so
A5/A8/B6/B7 and L5/L8/K7 follow the convention every other booklet in the series uses; its terrain,
however, **is** itemised in its section 10 and is reproduced exactly. Wall and container
**orientations** are never printed anywhere, and were inferred from map symmetry. All of these are
marked as inferred rather than presented as printed.

**5. Breach the Gate's gate is terrain, not just a marker.** Its setup table prints one terrain row,
"Gate — F7, G7 — Main breach obstacle/line", and the booklet opens by describing "choke-point
terrain: buildings and walls create a narrow fight". Those two grids were previously placed as
objective markers only, which left the choke point blocking nothing. They are now also placed as
two 3-inch walls. The booklet never states whether the gate is a wall or a building, nor its
orientation, so both are inferred and recorded in the scenario's own notes.

## The ten scenarios share two centre layouts, by design

Worth knowing before you load them expecting variety. Seven booklets prescribe the same centre:
buildings at F6/G7, tall walls at E5/H5/E8/H8, short walls at D6/I6/D7/I7. The Core Box demos and
the Full Game Setup Guide add containers at C4/J4/C9/J9 and D3/I10; Asymmetric Duel and Advanced
Stealth Duel print the same centre without containers. Power Spike and Hold Until Extraction print
no terrain at all, and Breach the Gate prints only its gate. So the boards genuinely do look alike
between scenarios: that is the series standard the authors chose, not missing data.

## Two support drones were left open on purpose

Power Spike lists "Raven / training support package" (33) and Hold Until Extraction lists
"Raven-style support drone / approved UN support drone" (30), the latter explicitly permitting
"another approved UN support drone of similar value". No card matches either point value, so a
substitution was chosen and recorded:

- **Power Spike** uses card 166 **ADK60S "Raven" Interference Type** (36), 3 points above the line.
- **Hold Until Extraction** uses card 161 **ADK15/MAS "Porcupine" Microwave Type** (30), an exact
  match; that booklet's own setup row reads "UN Porcupine / Raven Drone".

Before this audit both were left unresolved, which meant the unit silently did not appear on the
board. That is fixed.

## Things worth telling the authors

1. **TM17 "Wolfhound" Guard Core and LM108 Agile Chassis** are not in the community card database,
   so Missile Umbrella's UN Escort cannot be built as printed.
2. **Eight units across six booklets have two parts competing for one slot** (table above), most
   often two right-hand weapons. Worth a pass if a revision is ever planned.
3. **Wall and container orientations** are not printed in any booklet, so anyone rebuilding a map
   has to guess. A single line per map would remove the ambiguity.
4. Everything else matched exactly, including all deployment grids, facings, objective markers,
   round counts and scoring tables.

Scenario names, deployments, objectives and teaching structure are Luna Lilly Games' work,
reproduced here with credit and without changes beyond the points listed above. The booklets
reached me via **u/Soavon**, who shared them on Reddit. See [ATTRIBUTION.md](ATTRIBUTION.md).
