# EMBER Testing Grounds

A browser tabletop for learning **EMBER Obsidian Protocol**.

I learn by doing rather than by reading, so I built a board I could push mechs around on, with the rules
close enough to hand that I could stop flipping through the PDF every thirty seconds. It runs
entirely in your browser, needs no install and no account, and keeps everything in local storage.

**[Open the tabletop](https://ottoreiku.github.io/EMBER-Testing-Grounds/)** ·
**[Open the reference](https://ottoreiku.github.io/EMBER-Testing-Grounds/reference.html)**

## What you can do with it

**Play a whole game on a proper board.** A 12x12 board of large grids, each split into 3x3 small
grids, exactly like the real thing. Drag units around, rotate them to set facing, and drop in
terrain from the official pieces. Ten of the community demo scenarios are built in, so you can
load a full setup with squads, terrain and objectives in one click.

**Build squads, or import the ones you already made.** There is a mech builder for picking a
torso, chassis, arms, backpack and pilot, and it totals the points as you go. If you use the
community squad builder, you can import its .json export or even the squad .png it produces and
your list lands on the board.

**Let the app do the fiddly rules bits.** Press M to see exactly how far a unit can move, A to see
its firing arcs, or hover another unit for range and line of sight. Movement respects terrain and
blocked lanes rather than just drawing a circle.

**Roll the game's own dice.** All five dice with their real faces, including the black part die,
with the once-per-player reroll built in and a running tally of the symbols you rolled.

**Work through combat step by step.** The attack helper walks the actual attack sequence: target
part, attack roll, defence roll, then resolution. The best part is the resolution view, which lays
the dice out facing each other the way the rulebook diagrams do, and shows each Dodge and Defense
striking out the icon it cancels. It makes the awkward rules obvious, like the fact that Defense
can only ever cancel a Light Hit, and that an icon blocked by Defense still counts as a Hit.
Projectiles work too, with a Detonate flow for explosion damage and for effect grenades that just
mark whoever they caught.

**Keep track of what happened.** Every unit has its own combat log, so you can select a mech and
read what has been done to it across the game. Damage, Link loss and shutdown are all tracked, and
you can drop rulebook tokens like Fire Control Interference onto units and see them on the board.

**Look things up without breaking your flow.** Hover almost anything for its card scan and rules
text. Every keyword resolves to its glossary entry, and where the card database only had Chinese I
have translated it, always labelled as unofficial with the original kept alongside it.

## The reference page works on its own

The [reference page](https://ottoreiku.github.io/EMBER-Testing-Grounds/reference.html) is a
separate page built for a phone. Bookmark it and you have
the full glossary, every part, unit, pilot and tactics card, and a searchable rules section in your
pocket, without loading the tabletop first.

## Things to know

It is **rules-assisted, not rules-enforced**. It will show you the legal moves and do the math,
but it will not stop you doing something illegal, which is deliberate: you are learning, and
sometimes you want to try the illegal thing to see why it is illegal. The printed card always wins
over anything shown here.

All **ten Main Task cards** are in the reference, each with its objective, scoring and setup, and
the card scan is one click away if you want to see the terrain placement. The six **Tactics cards**
are there too, and they are selectable in the Add tab with their point values so they count toward
your list. The card text is my English rendering of the printed Korean, so the physical card always
wins over what you read here.

All **eight Secondary Task cards** are in there too, the ones each player picks in secret and scores
on their own. They took some digging to find, so the text is my English rendering of the Korean
cards and the scan is one tap away if you want to check me.

Everything saves to your browser. Nothing is uploaded anywhere and there is no server.

## Credits

The game, its artwork and its rules belong to **Beijing Queti Technology Co., Ltd.** The card
database and art came from **watermelon02's** community squad builder, and the ten demo scenarios
are **Luna Lilly Games'** work, which I found thanks to **u/Soavon** sharing them on Reddit. This
is an unofficial fan tool, made for learning and not for profit. Full details in
[ATTRIBUTION.md](ATTRIBUTION.md), and the scenario conversions are audited line by line in
[SCENARIO_AUDIT.md](SCENARIO_AUDIT.md).

If you play EMBER and something here is wrong, please tell me. I would rather fix it than have
someone learn a rule incorrectly from my tool.
