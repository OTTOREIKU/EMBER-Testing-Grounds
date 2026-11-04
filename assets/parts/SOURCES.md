# Part pictures

Pictures for parts that have no card scan of their own (2026-11-03/04). The app shows them without credit text; this file is where their sources are recorded.

- **Box sheet tiles** (app/src/boxtiles.ts `PART_ART`, by sprue code): the DTG-30, ADK15 and ADK30 drone bodies, the GA-3 grenade and the Optical Camouflage decoy.
- **In place of a missing card scan** everywhere else (app/src/data.ts `PART_IMAGES`, drawn by `cardPlaceholder` in app/src/images.ts): every part-<id>.webp below, shown with a small "part picture" line so it is never mistaken for the printed card. The list of every card without a scan is in Project-Documents/research/box-catalogue/MISSING-CARD-ART.md.

The publisher's database (api.obsidianprotocol.net, cached by tools/sync_official.mjs in .cache/official/) has a `pic` for every card it holds, but no record for a drone body on its own (DTG-30, ADK15 Porcupine), so those have no official picture.

## dtg-30-body.webp

The DTG-30 "Hyena" drone body on its own, cut out like Queti's part pictures: transparent outside, white-filled, black line art. Source: step 4 of Achillain's (Discord) "RDL - DTG30 Hyena Drone.pdf", drawn after Queti's instructions, rendered at 600 dpi; the step number, magnet, pin and the "3" callout were removed and the outside flood-filled to transparent. Achillain gave OTTO the OK to use his files, with credit kept here rather than in the app.

## adk30-body.webp, adk15-body.webp, optical-camouflage.webp

Cut out of Queti's own assembly PDFs on 2026-11-04 (OTTO: "we should try to cut it out of the PDF if there isnt an official image"). The publisher database has no record for a drone body on its own or for the decoys. Each was rendered at 400-600 dpi from the vector page. The step number, magnets, leader lines, callouts and the frame were removed, everything outside the part was made transparent, and the inside was filled white with the black line art kept. Each was then trimmed and resized to 480 px wide.

- **adk30-body.webp:** the ADK30 "Tarantula" body, step 3 of the ADK30 build, `UN/UN Core.pdf` printed page 39.
- **adk15-body.webp:** the ADK15 "Porcupine" body, step 3 of the ADK15 build, `UN/UN Door Breaker.pdf` printed page 39.
- **optical-camouflage.webp:** one Optical Camouflage decoy, step 4 (the leader lines to the base were taken out of the vector drawing first), `UN/UN Scalpel.pdf` printed page 48.

## Official part pictures (Queti, obsidianprotocol.net), fetched 2026-11-03

Each is the `pic` of the card's record in the publisher database (card page `https://obsidianprotocol.net/#/info?id=<QR id>&lang=en`). The originals are PNGs with a transparent background; they are trimmed, given a small margin and resized to 480px as webp with the transparency kept. The site shows no licence or reuse terms.

| File | Card | Source PNG | Original size |
|---|---|---|---|
| part-PDAM-007.webp | PDAM-007 FG12 HE Grenade | https://img.obsidianprotocol.net/images/1784195862_47851.png | 129 KB |
| part-PDBP-202.webp | PDBP-202 Lh271 Dual Howitzer | https://img.obsidianprotocol.net/images/1784093147_43932.jpg | 56 KB |
| part-PDBP-203.webp | PDBP-203 Lm382 Dual "Exocet" Missile Launcher + Lh171 Howitzer | https://img.obsidianprotocol.net/images/1784093209_84271.jpg | 62 KB |
| part-PDBP-204.webp | PDBP-204 Ls197 Autocannon + Lh171 Howitzer | https://img.obsidianprotocol.net/images/1784093263_72135.jpg | 62 KB |
| part-PDCH-201.webp | PDCH-201 HL3 "Chance" Chassis | https://img.obsidianprotocol.net/images/1784090942_77522.jpg | 164 KB |
| part-PDLH-201.webp | PDLH-201 Lm383 Triple "Exocet" Missile Launcher (L) | https://img.obsidianprotocol.net/images/1784091612_38402.jpg | 146 KB |
| part-PDRH-201.webp | PDRH-201 Lm383 Triple "Exocet" Missile Launcher (R) | https://img.obsidianprotocol.net/images/1784091830_44583.jpg | 93 KB |
| part-PDTR-201.webp | PDTR-201 H3-J "Chance" I | https://img.obsidianprotocol.net/images/1784090554_44289.jpg | 109 KB |
| part-XPA-62.webp | XPA-62 海鸥 | https://img.obsidianprotocol.net/images/1784196630_12380.jpg | 63 KB |
| part-070.webp | 070 GA-3 HE Grenade | https://img.obsidianprotocol.net/images/1721654450_30660.png | 419 KB |
| part-523.webp | 523 DTG-30Art "Hyena" Painting Type | https://img.obsidianprotocol.net/images/1758708554_11714.png | 521 KB |
| part-560.webp | 560 Asia Championship Trophy | https://img.obsidianprotocol.net/images/1784085488_37812.png | 587 KB |
| part-524.webp | 524 ADK15Art "Porcupine" Painting Type | https://img.obsidianprotocol.net/images/1758708607_72408.png | 660 KB |
