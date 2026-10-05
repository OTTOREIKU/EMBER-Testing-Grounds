// A game against the computer, as the page that hosts it holds it
// (AI-OPPONENT-PLAN.md, M3.4 and M4): src/loopback.ts, the relay with no
// server behind it, and src/solo.ts, which sets the table, sits a driver in
// the second seat and paces it.
//
// The page here is the Match Centre's wiring in miniature and nothing more:
// one GameState, the page's own seat through perform() (which publishes), the
// other seat's commands arriving through the relay's onCommand and
// applyRemote(), the local seat set as a room sets it. The PLAYER's seat is
// played by a second driver, so whole games run with a computer on the far
// side of the relay, exactly where it sits on screen.
import { readFileSync } from 'node:fs';
import { loadEngine, freshState, tableCommands } from './_engine.mjs';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}\n       got  ${g}`); }
};

console.log('A game against the computer\n');

const { M, data } = await loadEngine('solo', [
  "export * as SEAT from '../src/seat';", "export * as AI from '../src/ai/index';",
  "export * as LOOP from '../src/loopback';", "export * as SOLO from '../src/solo';", "export * as SETUP from '../src/solosetup';", "export * as SQ from '../src/squadstore';",
  "export * as H from '../src/tactichand';",
]);
const { LoopbackRelay } = M.LOOP;
const { SoloTable, soloAsk, soloSpec, soloQuery, soloSetup, thinkMs, restMs, SPEEDS, OPPONENTS } = M.SOLO;
const [alley, vip] = data.solo.scenarios;
const other = (s) => (s === 's1' ? 's2' : 's1');
const tick = () => new Promise((r) => { setImmediate(r); });
const sidesOf = (color) => data.dice.dice[color].sides;
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ---------- the relay with no server ----------
{
  const heard = [];
  const hooks = {
    onCommand: (cmd, seat) => heard.push(['command', cmd.kind, seat]),
    onRolled: (dice, seat, label, mine, kind) => heard.push(['rolled', dice.length, seat, label, mine, kind]),
    onChange: (view) => heard.push(['change', view.status, view.seat, !!view.room]),
    onCheckpoint() {}, onCatchUp() {}, onClosed() {}, onNeedCheckpoint() {}, snapshot: () => null,
  };
  const loop = new LoopbackRelay(hooks);
  check('before a table is opened there is no room: nothing is published, and no dice are rolled',
    [loop.state.room, loop.state.seat, loop.connected, loop.catchingUp, await loop.rollDice({ yellow: 1 }).then(() => 'rolled', (e) => e.message)],
    [null, null, false, false, 'Not in a game.']);
  const told = [];
  loop.onPublished((cmd) => told.push(cmd.kind));
  loop.publish({ kind: 'passTurn', seat: 's1' });
  await tick();
  check('a command published with no table open goes nowhere', told, []);
  loop.deliver({ kind: 'passTurn', seat: 's1' }, 's1');
  check('and none is delivered to a page with no table', heard.filter((x) => x[0] === 'command'), []);

  loop.open({ id: 'SOLO', seat: 's2', names: { s1: 'Computer', s2: 'UN Raid' }, dice: new M.AI.Rng('7:dice'), sides: sidesOf });
  const v = loop.state;
  check('opening seats the page at a room of its own: its seat, the host, both seats taken and both here',
    [v.status, v.seat, v.host, v.room.id, v.room.seats, v.room.online, loop.connected, heard.at(-1)],
    ['playing', 's2', true, 'SOLO', { s1: 'Computer', s2: 'UN Raid' }, { s1: true, s2: true }, true, ['change', 'playing', 's2', true]]);

  // What the page performs is heard by the other seat AFTER the page is done.
  loop.publish({ kind: 'passTurn', seat: 's2' });
  loop.publish({ kind: 'setReady', seat: 's2', ready: true });
  const during = told.slice();
  await Promise.resolve();
  check('what the page performs reaches the other seat once the page has finished with it, in order', [during, told], [[], ['passTurn', 'setReady']]);
  let threw = 0;
  loop.onPublished((cmd) => { if (cmd.kind === 'passTurn') { threw++; throw new Error('listener failed'); } told.push(cmd.kind); });
  const quiet = console.error; console.error = () => {};
  loop.publish({ kind: 'passTurn', seat: 's2' });
  loop.publish({ kind: 'endOpportunity', seat: 's2', uid: 1 });
  await Promise.resolve();
  console.error = quiet;
  check('a listener that fails over one command does not lose the next', [threw, told.at(-1)], [1, 'endOpportunity']);

  // The other seat's command arrives as a second player's does.
  loop.deliver({ kind: 'passTurn', seat: 's1' }, 's1');
  check('the other seat\'s command arrives through onCommand, at once, under its seat', heard.at(-1), ['command', 'passTurn', 's1']);

  // Dice: one seeded stream, shown to the page as a room shows them.
  const a = await loop.rollDice({ yellow: 2, red: 1 }, 'Attack');
  check('the page\'s roll: a die per die asked for, each a face its colour has, announced as its own',
    [a.map((d) => d.color), a.every((d) => d.face >= 0 && d.face < sidesOf(d.color)), heard.at(-1)],
    [['yellow', 'yellow', 'red'], true, ['rolled', 3, 's2', 'Attack', true, 'pool']]);
  const b = await loop.roll('s1', { yellow: 2 }, 'rolls for First Player', 'hits');
  check('the other seat\'s roll is announced under its seat, as not the page\'s, with how it is read', [b.length, heard.at(-1)], [2, ['rolled', 2, 's1', 'rolls for First Player', false, 'hits']]);
  const before = heard.length;
  const c = await loop.roll('s1', { black: 1 }, 'Part Die', 'pool', true);
  check('a quiet roll is rolled and not announced', [c.length, heard.length], [1, before]);
  const again = new LoopbackRelay(hooks);
  again.open({ id: 'SOLO', seat: 's2', names: { s1: 'Computer', s2: 'UN Raid' }, dice: new M.AI.Rng('7:dice'), sides: sidesOf });
  const a2 = await again.rollDice({ yellow: 2, red: 1 }, 'Attack');
  const b2 = await again.roll('s1', { yellow: 2 }, 'x', 'hits');
  check('the same seed rolls the same dice', [a2, b2], [a, b]);
  // Each die is drawn over the faces its own colour has: a Part Die has six.
  const drawn = [];
  const scripted = new LoopbackRelay(hooks);
  scripted.open({ id: 'SOLO', seat: 's2', names: { s1: 'Computer', s2: 'UN Raid' }, dice: { int: (n) => { drawn.push(n); return n - 1; } }, sides: sidesOf });
  const top = await scripted.roll('s2', { yellow: 1, white: 1, black: 1 }, 'x', 'pool', true);
  check('each die is drawn over the faces its own colour has', [drawn, top.map((d) => d.face)],
    [[sidesOf('yellow'), sidesOf('white'), sidesOf('black')], [sidesOf('yellow') - 1, sidesOf('white') - 1, sidesOf('black') - 1]]);

  loop.sit('s1');
  check('the page may change chairs', [loop.state.seat, heard.at(-1)], ['s1', ['change', 'playing', 's1', true]]);
  const h = loop.health();
  check('the line has nothing to report: no latency, no loss, nothing queued', [h.latencyMs, h.lossPct, h.backgrounded, h.queued, typeof h.rev], [null, 0, false, 0, 'number']);
  check('and its report says what it is', [loop.diagnostics().solo, loop.diagnostics().room], [true, 'SOLO']);
  loop.about = () => ({ game: 'alley-forward-advance', seed: 7 });
  check('with what the page that hosts the table says of the game', [loop.diagnostics().game, loop.diagnostics().seed], ['alley-forward-advance', 7]);
  loop.leave();
  check('leaving closes the table', [loop.state.room, loop.state.seat, loop.connected], [null, null, false]);
  // Whoever was listening went with the table: a new one is heard by nobody
  // until somebody asks to hear it.
  const stale = told.length;
  loop.open({ id: 'SOLO', seat: 's2', names: { s1: 'Computer', s2: 'UN Raid' }, dice: new M.AI.Rng('7:dice'), sides: sidesOf });
  loop.publish({ kind: 'setReady', seat: 's2', ready: true });
  await tick();
  check('and takes its listener with it', told.length, stale);
  loop.leave();

  // Everything the Match Centre asks of its relay, the loopback has.
  const code = src('match.ts').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const used = [...new Set([...code.matchAll(/\brelay\.(\w+)/g)].map((m) => m[1]))].sort();
  check('everything match.ts asks of its relay is found', used.length > 10, true);
  check('and the loopback has every one of them', used.filter((k) => !(k in loop) && typeof loop[k] === 'undefined'), []);
  check('the page holds its relay by its surface, and takes the loopback for a game against the computer',
    [/const relay: TableRelay = loopback \?\? new Relay\(api\.base, hooks\);/.test(src('match.ts')), /export class Relay implements TableRelay/.test(src('net.ts')), /export class LoopbackRelay implements TableRelay/.test(src('loopback.ts'))],
    [true, true, true]);
}

// ---------- what the address asks for ----------
{
  check('an address with no game in it asks for none', [soloAsk(''), soloAsk('?dev=1')], [null, null]);
  check('one that names a game is read whole', soloAsk('?solo=alley-forward-advance&side=un&seed=12&pace=brisk&ai=legal'),
    { solo: 'alley-forward-advance', side: 'un', seed: '12', pace: 'brisk', ai: 'legal' });
  const spec = (q) => soloSpec(data, soloAsk(q), () => 999);
  const un = spec('?solo=alley-forward-advance&side=un&seed=12&pace=brisk&ai=legal');
  check('a side asked for by its faction takes that squad\'s seat, and the computer the other',
    [un.human, un.bot, un.seed, un.speed, un.opponent, un.scenario.id], ['s2', 's1', 12, 'brisk', 'legal', 'alley-forward-advance']);
  const plain = spec('?solo=intersection-vip-assassination');
  check('with nothing more said: the first squad, a fresh seed, Normal speed, the usual opponent',
    [plain.human, plain.bot, plain.seed, plain.speed, plain.opponent], ['s1', 's2', 999, 'normal', 'tactician']);
  check('a seat may be named outright', [spec('?solo=alley-forward-advance&side=s2').human, spec('?solo=alley-forward-advance&side=RDL').human], ['s2', 's1']);
  check('a seed is a whole number from 0 up, or a fresh one is taken',
    ['0', '12', '-4', '1.5', 'abc'].map((seed) => spec(`?solo=alley-forward-advance&seed=${seed}`).seed), [0, 12, 999, 999, 999]);
  check('a game is watched only when the address says so, in so many words',
    [plain.watch, spec('?solo=alley-forward-advance&watch=1').watch, spec('?solo=alley-forward-advance&watch=yes').watch], [false, true, false]);
  check('and the address of a watched game says it', [soloQuery({ scenario: 'x', side: 's1', watch: true }), soloAsk(soloQuery({ scenario: 'x', side: 's1', watch: true })).watch], ['?solo=x&side=s1&watch=1', '1']);
  const holed = { ...data, solo: { ...data.solo, scenarios: [{ ...alley, seats: { s1: 'nobody-home', s2: alley.seats.s2 } }] } };
  check('a game whose squad is missing is refused in plain words', soloSpec(holed, { solo: alley.id }, () => 1), 'The squad "nobody-home" of that game is missing.');
  check('a speed or an opponent nobody offers falls back to the usual one', [spec('?solo=alley-forward-advance&pace=warp&ai=skynet').speed, spec('?solo=alley-forward-advance&pace=warp&ai=skynet').opponent], ['normal', 'tactician']);
  check('the usual opponent is the Tactician (the Ace of the three levels), the Veteran and the Recruit are the levels below it, the Brawler is there to be played beside it, and the other two are there to be asked for by name',
    [M.SOLO.OPPONENT, Object.keys(OPPONENTS), OPPONENTS.tactician.policy.name, OPPONENTS.tactician.name, OPPONENTS.veteran.policy.name, OPPONENTS.veteran.name, OPPONENTS.recruit.policy.name, OPPONENTS.recruit.name,
      OPPONENTS.brawler.policy.name, OPPONENTS.brawler.name, spec('?solo=alley-forward-advance&ai=eager').opponent, spec('?solo=alley-forward-advance&ai=brawler').opponent,
      spec('?solo=alley-forward-advance&ai=veteran').opponent, spec('?solo=alley-forward-advance&ai=recruit').opponent],
    ['tactician', ['tactician', 'veteran', 'recruit', 'brawler', 'eager', 'legal'], 'tactician', 'Computer (Ace)', 'veteran', 'Computer (Veteran)', 'recruit', 'Computer (Recruit)',
      'brawler', 'Computer (Brawler)', 'eager', 'brawler', 'veteran', 'recruit']);
  check('the opponents a player is offered are the three levels, easiest first, then the Brawler, the Ace the usual one, each with a line saying what it does',
    [M.SOLO.RIVALS.map((r) => r.id), M.SOLO.RIVALS.map((r) => r.name), M.SOLO.RIVAL, M.SOLO.RIVALS.every((r) => r.name && r.note && OPPONENTS[r.id])],
    [['recruit', 'veteran', 'tactician', 'brawler'], ['Recruit', 'Veteran', 'Ace', 'Brawler'], 'tactician', true]);
  check('a game nobody has is refused in plain words', typeof spec('?solo=nope') === 'string' && /no game against the computer/.test(spec('?solo=nope')), true);
  check('the address of a game says only what is not the default',
    [soloQuery({ scenario: 'alley-forward-advance', side: 's2', seed: 5, speed: 'normal', opponent: 'tactician' }), soloQuery({ scenario: 'x', side: 's1', speed: 'relaxed', opponent: 'legal' }),
      soloQuery({ scenario: 'x', side: 's1', opponent: 'brawler' })],
    ['?solo=alley-forward-advance&side=s2&seed=5', '?solo=x&side=s1&pace=relaxed&ai=legal', '?solo=x&side=s1&ai=brawler']);
  check('and reads back as the game it names', (() => { const s = spec(soloQuery({ scenario: vip.id, side: 's2', seed: 41, speed: 'relaxed' })); return [s.scenario.id, s.human, s.seed, s.speed]; })(), [vip.id, 's2', 41, 'relaxed']);
  // The table the host sets: what the suite's harness sends, then both squads, the start, the lock.
  const cmds = soloSetup(data, alley);
  check('the host sets the table as the lobby does: battlefield, Main Task, length, both squads, start, and the battlefield locked',
    [cmds.map((c) => c.kind), JSON.stringify(cmds.slice(0, 3)) === JSON.stringify(tableCommands(M, data, alley)), cmds.slice(3, 5).map((c) => [c.seat, c.name])],
    [['configureTable', 'configureTable', 'configureTable', 'importSquad', 'importSquad', 'startMatch', 'lockMap'], true, [['s1', 'RDL Raid'], ['s2', 'UN Raid']]]);
  M.L.setLocalSeat(null);
  const s = freshState(M, data);
  const went = cmds.map((c) => { const v = M.C.perform(data, s, c); if (v.ok) M.G.glueAfter(data, s, c); return v.ok; });
  check('every one of them is taken by a fresh table, which then waits for the roll for First Player',
    [went.every(Boolean), M.SU.normaliseSetup(s.setup).stage, s.tokens.length, M.TK.normaliseTasks(s.tasks).items.length], [true, 'roll', 6, 3]);
}

// ---------- the way in, on the tabletop (M4.4) ----------
{
  const { soloGameLabel, soloSquadLabel, soloSetupHtml, soloAddress } = M.SETUP;
  // The four things a shipped game is picked by (a game of the player's own
  // has more: further down).
  const soloPick = (d, kept) => { const p = M.SETUP.soloPick(d, kept); return { scenario: p.scenario, side: p.side, speed: p.speed, opponent: p.opponent }; };
  check('the setup opens on the first game, its first squad, Normal speed and the usual opponent', soloPick(data, null), { scenario: alley.id, side: 's1', speed: 'normal', opponent: 'tactician' });
  check('or on the game set up last time, while this build still has it; a pick kept from before there was an opponent to pick takes the usual one',
    [soloPick(data, { scenario: vip.id, side: 's2', speed: 'brisk', opponent: 'brawler' }), soloPick(data, { scenario: vip.id, side: 's2', speed: 'brisk' }),
      soloPick(data, { scenario: 'gone', side: 'north', speed: 'warp', opponent: 'eager' }), soloPick(data, 'nonsense')],
    [{ scenario: vip.id, side: 's2', speed: 'brisk', opponent: 'brawler' }, { scenario: vip.id, side: 's2', speed: 'brisk', opponent: 'tactician' },
      { scenario: alley.id, side: 's1', speed: 'normal', opponent: 'tactician' }, { scenario: alley.id, side: 's1', speed: 'normal', opponent: 'tactician' }]);
  const g = soloGameLabel(data, alley);
  const task = data.missions.cards.find((c) => c.id === alley.mission).name;
  const map = data.terrain.maps.find((m) => m.id === alley.map).name.en;
  check('a game is named by its Main Task, with its battlefield and its length', [g.name, g.note], [task, `${map} · 5 rounds`]);
  check('a squad by its name, its points and what it brings',
    [soloSquadLabel(data, alley, 's1'), soloSquadLabel(data, alley, 's2')],
    [{ name: 'RDL Raid', note: '400 points · 2 Mechs' }, { name: 'UN Raid', note: '410 points · 1 Mech, 3 Drones' }]);
  const html = soloSetupHtml(data, { ...M.SETUP.soloPick(data, null), scenario: vip.id, side: 's2', speed: 'relaxed', opponent: 'brawler' });
  const rows = [...html.matchAll(/<button type="button" class="dlg-pick" data-(game|side|rival|speed)="([^"]+)" aria-pressed="(true|false)">/g)].map((m) => `${m[1]}:${m[2]}${m[3] === 'true' ? '*' : ''}`);
  check('the dialog asks four things, each a pick-one list, with the pick marked: the game, the squad, the opponent, the speed',
    rows, [`game:${alley.id}`, `game:${vip.id}*`, 'side:s1', 'side:s2*', 'rival:recruit', 'rival:veteran', 'rival:tactician', 'rival:brawler*', 'speed:relaxed*', 'speed:normal', 'speed:brisk']);
  check('each opponent is named with a line saying what it does, in the same row a game or a speed has',
    [/<p class="dlg-eyebrow">The computer is<\/p>/.test(html), /data-rival="recruit" aria-pressed="false"><span>Recruit<\/span><em>makes mistakes<\/em>/.test(html),
      /data-rival="veteran" aria-pressed="false"><span>Veteran<\/span><em>plays a turn at a time<\/em>/.test(html),
      /data-rival="tactician" aria-pressed="false"><span>Ace<\/span><em>plays for the mission<\/em>/.test(html),
      /data-rival="brawler" aria-pressed="true"><span>Brawler<\/span><em>attacks what it can reach<\/em>/.test(html)], [true, true, true, true, true]);
  check('and has one way on and one way out', [(html.match(/data-ok/g) ?? []).length, (html.match(/data-cancel/g) ?? []).length, /Start the game/.test(html)], [1, 1, true]);
  check('Start goes to the Match Centre\'s page, asked for that game and that opponent',
    [soloAddress({ scenario: vip.id, side: 's2', speed: 'relaxed', opponent: 'tactician' }), soloAddress({ scenario: alley.id, side: 's1', speed: 'normal', opponent: 'tactician' }),
      soloAddress({ scenario: alley.id, side: 's1', speed: 'normal', opponent: 'brawler' })],
    [`match/?solo=${vip.id}&side=s2&pace=relaxed`, `match/?solo=${alley.id}&side=s1`, `match/?solo=${alley.id}&side=s1&ai=brawler`]);
  check('which reads it back as the same game', (() => { const s = soloSpec(data, soloAsk(soloAddress({ scenario: vip.id, side: 's2', speed: 'relaxed', opponent: 'brawler' }).slice('match/'.length)), () => 1); return [s.scenario.id, s.human, s.speed, s.opponent]; })(), [vip.id, 's2', 'relaxed', 'brawler']);
  // The tabletop offers the game and carries none of what plays it.
  const imports = (f) => [...src(f).matchAll(/^import (?:type )?[^;]*? from '([^']+)';/gm)].map((m) => m[1]).sort();
  check('the tabletop\'s row opens it, on the Setup tab\'s own row pattern',
    [/<button class="setup-row" id="btn-solo"[^>]*>Play the computer<span class="ct">solo game<\/span><\/button>/.test(readFileSync(new URL('../table/index.html', import.meta.url), 'utf8')),
      /document\.getElementById\('btn-solo'\)!\.addEventListener\('click', \(\) => \{\n\s*openSoloSetup\(data, \(address\) => \{ location\.href = address; \}\);/.test(src('main.ts'))], [true, true]);
  check('and the tabletop carries none of what plays the game: the setup imports the address, the speeds and the squads this device keeps, and no more',
    [imports('solosetup.ts'), imports('soloask.ts'), /from '\.\/solo'|from '\.\/ai\//.test(src('main.ts'))], [['./data', './dialog', './soloask', './squadstore', './types'], ['./data', './types'], false]);
}

// ---------- a game of the player's own (M8.1) ----------
{
  const { soloPick, soloSquads, soloSquadPoints, soloLists, soloSetupHtml, soloOwnGame, soloAddress } = M.SETUP;
  const { ownGame, SOLO_OWN, SOLO_OWN_KEY } = M.SOLO;
  // What this device keeps: the two shipped starters (the suite's storage is
  // empty), a squad saved here with a hostile name, and the shipped games' lists.
  const hostile = { id: 'sq1', name: '<img src=x onerror=alert(1)> "Vipers"', saved: 1, mechs: [{ name: 'One', loadout: { torso: '533', chasis: '534', leftHand: '535', rightHand: '536', backpack: '004', pilot: 'FPA-04-2' } }], drones: [] };
  const squads = soloSquads(data, [...M.SQ.loadSquads(), hostile]);
  check('the squads a game of your own may be played with: the ones this device keeps, then the shipped games\' lists, each with what it costs on the current lists',
    [squads.map((x) => x.id), squads.filter((x) => x.id.startsWith('solo:')).map((x) => x.points), squads.every((x) => x.points > 0)],
    [['builtin:squad-raid-rdl', 'builtin:squad-raid-un', 'sq1', 'solo:raid-rdl', 'solo:raid-un'], [data.solo.squads['raid-rdl'].points, data.solo.squads['raid-un'].points], true]);
  check('a squad costs its Mechs\' Parts and Pilots and its Drones, a Carrier\'s Load with them',
    [soloSquadPoints(data, { name: 'x', mechs: [], drones: [{ cardId: '162', backpack: '083' }] }), soloSquadPoints(data, { name: 'x', mechs: [], drones: [] })],
    [(data.byId.get('162').score ?? 0) + (data.byId.get('083').score ?? 0), 0]);
  const opened = soloPick(data, null, squads);
  check('with nothing kept the dialog still opens on the first shipped game; a game of your own waits on the Alley, the usual Occupation, the two starters, no Secondary Tasks',
    [opened.scenario, opened.map, opened.mission, opened.mine, opened.theirs, opened.secondaries], [alley.id, 'alley', 'control-frontal-breakthrough', 'builtin:squad-raid-rdl', 'builtin:squad-raid-un', false]);
  const kept = { scenario: SOLO_OWN, side: 's2', speed: 'brisk', opponent: 'brawler', map: 'steelworks', mission: 'blackbox-key-facilities', mine: 'sq1', theirs: 'solo:raid-un', secondaries: true };
  const pick = soloPick(data, kept, squads);
  check('a game of your own kept from last time opens again as it was', pick, { ...kept });
  check('what this build or this device no longer has falls back: a battlefield, a Main Task, a squad; and with no squad to play it with there is no game of your own',
    [(() => { const p = soloPick(data, { ...kept, map: 'moon', mission: 'tea', mine: 'gone', theirs: 7 }, squads); return [p.scenario, p.map, p.mission, p.mine, p.theirs]; })(), soloPick(data, kept, []).scenario],
    [[SOLO_OWN, 'alley', 'control-frontal-breakthrough', 'builtin:squad-raid-rdl', 'builtin:squad-raid-un'], alley.id]);
  const lists = soloLists(data, squads);
  check('its lists: every battlefield, every Main Task with when it pays, every squad with its cost and what it brings',
    [lists.map.rows.map((r) => r.id), lists.mission.rows.length, lists.mission.rows.find((r) => r.id === 'blackbox-key-facilities').note, lists.mission.rows.find((r) => r.id === 'control-frontal-breakthrough').note,
      lists.mine.rows.map((r) => r.id), lists.theirs.rows.find((r) => r.id === 'solo:raid-un').note],
    [data.terrain.maps.map((m) => m.id), data.missions.cards.length, 'paid as the game ends', 'paid every round', squads.map((x) => x.id), '410 points · 1 Mech, 3 Drones']);
  const html = soloSetupHtml(data, pick, squads);
  const games = [...html.matchAll(/data-game="([^"]+)" aria-pressed="(true|false)"/g)].map((m) => `${m[1]}${m[2] === 'true' ? '*' : ''}`);
  const opens = [...html.matchAll(/<button type="button" class="dlg-pick dlg-open" data-open="([^"]+)"><span>([^<]*)<\/span><span class="dlg-pick-end"><em>([^<]*)<\/em><span class="ui-go" aria-hidden="true">›<\/span><\/span><\/button>/g)].map((m) => [m[1], m[2], m[3]]);
  check('the dialog offers it as a third game, after the shipped two', games, [alley.id, vip.id, `${SOLO_OWN}*`]);
  check('picked, four rows say what is chosen and open the list it was chosen from: the battlefield, the Main Task, your squad, the computer\'s',
    opens.map((o) => o[0]), ['map', 'mission', 'mine', 'theirs']);
  check('each showing the pick in a player\'s words',
    [opens[0].slice(1), opens[1].slice(1), opens[3].slice(1)], [['Battlefield', 'Steelworks'], ['Main Task', 'Black Box: Key Facility'], ['UN Raid', '410 points · 1 Mech, 3 Drones']]);
  check('a squad\'s name is this device\'s own text and is printed as text, never as markup',
    [opens[2][1], /<img/.test(html), /onerror=alert\(1\)&gt; &quot;Vipers&quot;/.test(html)], ['&lt;img src=x onerror=alert(1)&gt; &quot;Vipers&quot;', false, true]);
  check('Secondary Tasks are a pick of two, and the shipped games\' two squads are not asked for',
    [[...html.matchAll(/data-secondary="(on|off)" aria-pressed="(true|false)"/g)].map((m) => `${m[1]}${m[2] === 'true' ? '*' : ''}`), /data-side=/.test(html), /it does not yet use every special Action a card prints/.test(html)],
    [['off', 'on*'], false, true]);
  check('with a shipped game picked none of that is drawn, and with no squad on the device no game of your own is offered',
    [/data-open=|data-secondary=/.test(soloSetupHtml(data, opened, squads)), /data-game="own"/.test(soloSetupHtml(data, opened, squads)), /data-game="own"/.test(soloSetupHtml(data, opened, []))], [false, true, false]);
  // What Start hands the Match Centre's page.
  const game = soloOwnGame(pick, squads);
  check('Start writes the game where the Match Centre\'s page reads it: the table, and each seat\'s squad as the table imports one, the player first',
    [game.map, game.mission, game.rounds, game.secondaries, game.squads.s1.name, game.squads.s2.name, Object.keys(game.squads.s1).sort(), game.squads.s2.drones.length],
    ['steelworks', 'blackbox-key-facilities', 5, true, hostile.name, 'UN Raid', ['drones', 'mechs', 'name'], 3]);
  check('and goes to the Match Centre\'s page asking for it by name, the player in the first seat whatever was kept',
    [soloAddress(pick), SOLO_OWN_KEY, soloOwnGame({ ...pick, mine: 'gone' }, squads)], ['match/?solo=own&side=s1&pace=brisk&ai=brawler', 'ember-solo-own', null]);
  // Out of storage it is read as data, and held to its shape.
  const back = ownGame(JSON.parse(JSON.stringify(game)));
  check('out of storage it is the same game', [JSON.stringify(back.squads.s2) === JSON.stringify(game.squads.s2), back.map, back.mission, back.rounds, back.secondaries], [true, game.map, game.mission, 5, true]);
  check('what is not a game is none: nothing, text, a table with no squads, a squad with nothing in it',
    [ownGame(null), ownGame('own'), ownGame({ map: 'alley', mission: 'x' }), ownGame({ map: 'alley', mission: 'x', squads: { s1: game.squads.s1, s2: { name: 'Empty', mechs: [], drones: [] } } }), ownGame({ ...game, map: 7 })],
    [null, null, null, null, null]);
  const odd = ownGame({ map: 'alley', mission: 'm', rounds: 99, secondaries: 'yes', squads: {
    s1: { name: '   ', faction: 5, extra: 'x', mechs: [{ name: 9, loadout: { torso: '533', chasis: 534, colour: 'red' } }, { loadout: { pilot: 'FPA-04-2' } }, 'junk'], drones: [{ cardId: 543, backpack: '083' }, { cardId: '543', backpack: 4 }] },
    s2: game.squads.s2,
  } });
  check('and only what a table imports is carried over: card ids and names as plain text, a Mech with a Torso or a Chassis, a length that is a game\'s',
    [odd.rounds, odd.secondaries, odd.squads.s1], [5, false, { name: 'Squad', mechs: [{ loadout: { torso: '533' } }], drones: [{ cardId: '543' }] }]);
  // The game the page plays.
  const spec = soloSpec(data, { solo: SOLO_OWN, side: 's2', pace: 'brisk' }, () => 5, game);
  check('the page is handed the game with the address that asks for it: the table as picked, the squads as its own, no Tactics Cards, no fixed edges',
    [spec.scenario, spec.squads.s1.name, spec.squads.s2.name, spec.human, spec.speed],
    [{ id: SOLO_OWN, map: 'steelworks', mission: 'blackbox-key-facilities', rounds: 5, secondaries: true, tactics: false, seats: { s1: 'own:s1', s2: 'own:s2' } }, hostile.name, 'UN Raid', 's2', 'brisk']);
  check('a side may still be asked for by its squad\'s faction, where the squad says one', soloSpec(data, { solo: SOLO_OWN, side: 'un' }, () => 5, game).human, 's2');
  check('with no game on the device, or one this build cannot lay, the page says so in plain words',
    [soloSpec(data, { solo: SOLO_OWN }, () => 5, null), soloSpec(data, { solo: SOLO_OWN }, () => 5, { ...game, map: 'moon' }), soloSpec(data, { solo: SOLO_OWN }, () => 5, { ...game, mission: 'tea' })],
    ['No game of your own is set up on this device. Set one up on the tabletop: Setup, then Play the computer.', 'There is no battlefield called "moon".', 'There is no Main Task called "tea".']);
  const cmds = soloSetup(data, spec.scenario, spec.squads);
  M.L.setLocalSeat(null);
  const fresh = freshState(M, data);
  const went = cmds.map((c) => { const v = M.C.perform(data, fresh, c); if (v.ok) M.G.glueAfter(data, fresh, c); return v.ok; });
  check('the host sets that table as it sets a shipped one, with the squads the player picked; a fresh table takes every command, and the squad\'s name is cleaned on the way in',
    [cmds.map((c) => c.kind), cmds.slice(3, 5).map((c) => c.name), went.every(Boolean), fresh.map, fresh.mission, !!fresh.noSecondary, M.TK.normaliseTasks(fresh.tasks).items.filter((i) => i.kind === 'blackbox').length,
      /[<>]/.test(fresh.sideNames?.s1 ?? '')],
    [['configureTable', 'configureTable', 'configureTable', 'importSquad', 'importSquad', 'startMatch', 'lockMap'], [hostile.name, 'UN Raid'], true, 'steelworks', 'blackbox-key-facilities', false, 5, false]);
  check('the Match Centre\'s page reads the game out of this device\'s storage when the address asks for it, and hands it to the spec',
    [/if \(soloWanted\.solo === SOLO_OWN\) \{\n\s*try \{ own = ownGame\(JSON\.parse\(localStorage\.getItem\(SOLO_OWN_KEY\) \?\? 'null'\)\); \} catch \{ own = null; \}/.test(src('match.ts')),
      /const spec = soloSpec\(data, soloWanted, \(\) => Math\.floor\(Math\.random\(\) \* 1e9\), own\);/.test(src('match.ts'))], [true, true]);
}

// ---------- the Match Centre's page plays it as a room ----------
{
  const m = src('match.ts');
  check('the page asks its address, sets the table through its own door, opens the loopback and seats the computer',
    [/const soloWanted = soloAsk\(location\.search\);/.test(m), /const hands = soloHands\(spec\);\n\s*for \(const cmd of soloSetup\(data, spec\.scenario, spec\.squads, hands\.commands\)\) \{\n\s*const v = send\(cmd\);/.test(m),
      /loopback\.open\(\{\n\s*id: SOLO_ROOM,\n\s*seat: spec\.human,/.test(m), /const table = new SoloTable\(\{/.test(m), /table\.start\(\);/.test(m)], [true, true, true, true, true]);
  check('and deals the computer\'s hand to its seat alone', /\}, spec, hands\.held\);/.test(m), true);
  check('it waits on the server for nothing: no session, no registration and no record before the table is set, and none of the game kept as a record',
    [/soloWanted \? Promise\.resolve\(null\) : api\.refresh\(\),/.test(m), /soloWanted \? Promise\.resolve\(null\) : api\.registration\(\)\.catch\(\(\) => null\),/.test(m),
      /if \(loopback\) return 'A game against the computer is not kept on a record\.';/.test(m)], [true, true, true]);
  check('the account is asked once the table is set, and only for a game whose log may be kept (botlog.ts): filed once, as it ends or as the page goes',
    [/startSolo\(\);\n\s*if \(botlog\) void api\.refresh\(\);/.test(m), /botlog = spec\.watch \? null : new BotLog\(\{/.test(m),
      /ended: \(\) => fileBotLog\('over'\),/.test(m), /window\.addEventListener\('pagehide', \(\) => fileBotLog\(botlogLeaving\)\);/.test(m),
      /const me = api\.user;\n\s*if \(!botlog \|\| botlog\.filed \|\| !me\) return;/.test(m)], [true, true, true, true, true]);
  check('and keeps nothing of it on the device: no room to rejoin, no dial secret',
    [/if \(view\.room\) \{ if \(!loopback\) rememberRoom\(view\.room\.id\); \}/.test(m), /function dialSecretKey\(\): string \| null \{\n(?:\s*\/\/[^\n]*\n)*\s*if \(soloWanted\) return null;/.test(m)], [true, true]);
  check('the computer waits for a walk to end on the player\'s board', [/walking,\n\s*changed: \(\) => render\(\),/.test(m), /export function walking\(\): boolean \{\n\s*return animatingUid !== null;/.test(src('matchhud.ts'))], [true, true]);
  const hud = src('matchhud.ts');
  check('the result of a game against the computer offers another game and the way back, and no record',
    [/const foot = ctx\.solo\n\s*\? `<button class="bigbtn" data-act="soloagain">Play again<\/button>/.test(hud), /on\('\[data-act="soloagain"\]', \(\) => ctx\.solo\?\.again\(\)\);/.test(hud)], [true, true]);
  // Until M9.4 no Undo was offered against the computer, whose seat answered no
  // ask; now its seat answers, and agrees (seatundo.test).
  check('and the Undo is offered against the computer, whose seat answers the ask',
    [/if \(ctx\.solo\) return '';/.test(hud), /ctx\.solo \? 'The computer answers, and agrees, before anything moves\.'/.test(hud)], [false, true]);
}

// ---------- the pace (decision D7) ----------
{
  const d = (kind) => ({ kind });
  const o = (...tags) => ({ tags });
  const mid = (p) => (p[0] + p[1]) / 2;
  const ready = thinkMs(d('phase.ready'), o('ready'));
  const pick = thinkMs(d('loop.designate.command'), o('designate', 'drone'));
  const stance = thinkMs(d('opp.act'), o('stance'));
  const move = thinkMs(d('opp.act'), o('move', 'maneuver'));
  const shot = thinkMs(d('opp.act'), o('attack', 'firing'));
  const end = thinkMs(d('opp.act'), o('end'));
  check('the computer takes longest before a Movement or an attack is declared, less to pick a unit or a Stance, least over bookkeeping',
    [mid(move) > mid(pick), mid(shot) > mid(stance), mid(pick) > mid(ready), mid(stance) > mid(ready), mid(end) < mid(move)], [true, true, true, true, true]);
  const kinds = ['setup.lock', 'setup.roll', 'setup.accept', 'setup.edge', 'setup.deploy', 'setup.ready', 'planning.dial', 'planning.commit', 'planning.reveal', 'phase.ready',
    'loop.designate.auto', 'opp.reboot', 'opp.act', 'activation.act', 'end.step', 'attack.roll', 'attack.focus', 'attack.reroll', 'attack.apply', 'attack.finish',
    'defence.roll', 'defence.focus', 'contest.roll', 'contest.apply', 'contest.close', 'blast.resolve', 'intercept.attempt', 'reaction.answer', 'smoke.thin', 'reveal.make', 'tactic.after', 'tactic.end', 'something.new'];
  const all = kinds.flatMap((k) => [thinkMs(d(k), o()), thinkMs(d(k), o('move')), thinkMs(d(k), o('end')), thinkMs(d(k), o('attack')), thinkMs(d(k), o('smoke'))]);
  check('a Tactics Card is played over a moment, Hit and Run\'s step as a Movement is, and one let go by sooner',
    [mid(thinkMs(d('tactic.after'), o('move', 'tactic'))) === mid(move), mid(thinkMs(d('tactic.end'), o('tactic', 'card:275'))) === mid(pick), mid(thinkMs(d('tactic.after'), o('tactic', 'pass'))) < mid(pick),
      mid(thinkMs(d('phase.ready'), o('tactic', 'card:274'))) === mid(pick)], [true, true, true, true]);
  check('no decision is ever answered at once, and none takes for ever: every pause is between 0.4 and 2.5 seconds at Normal',
    [all.every((p) => p[0] >= 400 && p[1] <= 2500 && p[0] < p[1]), all.length], [true, kinds.length * 5]);
  check('what is owed above the phase is paused over as the choice it is: a blow struck back or a blast made like an attack declared, Smoke put down like a placement, a Screen given up like a unit picked; none like bookkeeping',
    [mid(thinkMs(d('reaction.answer'), o('reaction', 'riposte', 'attack'))) === mid(shot), mid(thinkMs(d('blast.resolve'), o('detonate', 'attack'))) === mid(shot),
      mid(thinkMs(d('blast.resolve'), o('detonate', 'smoke', 'done'))) > mid(thinkMs(d('blast.resolve'), o('detonate', 'done'))), mid(thinkMs(d('reaction.answer'), o('reaction', 'smoke'))) > mid(thinkMs(d('reaction.answer'), o('reaction', 'decline'))),
      mid(thinkMs(d('reaction.answer'), o('reaction', 'decline'))) > mid(ready), mid(thinkMs(d('smoke.thin'), o('smoke', 'remove'))) > mid(ready)],
    [true, true, true, true, true, true]);
  check('a Reveal, and where the unit appears, is paused over like a Grid chosen to deploy in, and is said to be what it is; the attack behind a won Scan like any attack declared',
    [thinkMs(d('reveal.make'), o('reveal', 'manifest')), mid(thinkMs(d('reaction.answer'), o('reaction', 'scan', 'attack', 'firing'))) === mid(shot), /if \(k === 'reveal\.make'\) return 'revealing a unit';/.test(src('solo.ts'))],
    [thinkMs(d('setup.deploy'), o('deploy')), true, true]);
  check('a Command handed to a Drone in the middle of a Mech\'s turn (Command Coordination) is paused over like a unit picked in the Command Phase, and is said to be what it is',
    [thinkMs(d('opp.act'), o('coordinate')), thinkMs(d('opp.act'), o('coordinate', 'action')), /o\.tags\.includes\('coordinate'\) \? 'commanding a Drone' : 'acting'/.test(src('solo.ts'))], [pick, pick, true]);
  check('places exchanged by Prototype Blink are paused over like a Movement declared', thinkMs(d('opp.act'), o('blink', 'enemy', 'facing:0')), move);
  check('inside an attack each press is a beat, and the result is held longest before the window closes',
    [mid(thinkMs(d('attack.finish'), o())) > mid(thinkMs(d('attack.apply'), o())), mid(thinkMs(d('attack.apply'), o())) > mid(thinkMs(d('attack.roll'), o())), mid(thinkMs(d('defence.focus'), o())) > mid(thinkMs(d('defence.roll'), o()))],
    [true, true, true]);
  check('dice are left on the table to be read: a roll rests longer than anything else',
    [restMs(d('attack.roll'), o()) > restMs(d('attack.apply'), o()), restMs(d('contest.roll'), o()) >= 1000, restMs(d('opp.act'), o('attack')) > restMs(d('phase.ready'), o('ready')), restMs(d('phase.ready'), o('ready')) > 0],
    [true, true, true, true]);
  check('three speeds, Normal being the one the pauses are written for',
    [SPEEDS.map((x) => x.id), SPEEDS.find((x) => x.id === 'normal').scale, SPEEDS[0].scale > 1, SPEEDS[2].scale < 1 && SPEEDS[2].scale >= 0.5],
    [['relaxed', 'normal', 'brisk'], 1, true, true]);
  check('the pause is the host\'s and is never drawn from the computer\'s own stream',
    [/Math\.random\(\)/.test(src('solo.ts')), /setTimeout|Math\.random/.test(src('ai/driver.ts').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n'))], [true, false]);
}

// ---------- the page in miniature ----------
//
// `player` is a driver in the page's own seat, standing in for the person:
// its commands go through perform(), as a press on the page does.
function page(scenario, human, { seed = 1, sleep = tick, opponent = 'brawler', playerPolicy = M.AI.eagerPolicy, status, told, heartbeatMs = 0, watch = false, door = watch, walking = () => false, diceSeed = seed, own = null } = {}) {
  M.L.setLocalSeat(null);
  const state = freshState(M, data);
  // `own` is a game the player put together: the address asks for it by name
  // and the page hands the game in (match.ts startSolo).
  const spec = soloSpec(data, { solo: own ? M.SOLO.SOLO_OWN : scenario.id, side: human, seed: String(seed), ai: opponent, ...(watch ? { watch: '1' } : {}) }, () => seed, own);
  if (typeof spec === 'string') throw new Error(spec);
  const sent = [];
  const refused = [];
  const rolled = [];
  let player = null;
  const hooks = {
    onCommand(cmd, seat) {
      const v = M.C.applyRemote(data, state, cmd);
      sent.push({ seat, kind: cmd.kind, ok: v.ok, via: 'relay' });
      if (!v.ok) { refused.push({ seat, kind: cmd.kind, why: v.why }); return; }
      M.G.glueAfter(data, state, cmd);
      player?.observe(cmd);
    },
    onRolled: (dice, seat, label, mine, kind) => rolled.push({ seat, label, mine, kind, n: dice.length }),
    onChange: (view) => M.L.setLocalSeat(view.room ? view.seat : null),
    onCheckpoint() {}, onCatchUp() {}, onClosed() {}, onNeedCheckpoint() {}, snapshot: () => state,
  };
  const loop = new LoopbackRelay(hooks);
  M.C.onPerformed((cmd) => loop.publish(cmd));
  // The page's one door (match.ts send).
  const send = (cmd) => {
    const v = M.C.perform(data, state, cmd);
    sent.push({ seat: cmd.seat, kind: cmd.kind, ok: v.ok, via: 'page' });
    if (!v.ok) { refused.push({ seat: cmd.seat, kind: cmd.kind, why: v.why }); return v; }
    M.G.glueAfter(data, state, cmd);
    player?.observe(cmd);
    return v;
  };
  // Each squad's Tactics Cards dealt as the page deals them (match.ts startSolo).
  const hands = M.SOLO.soloHands(spec);
  for (const cmd of soloSetup(data, spec.scenario, spec.squads, hands.commands)) send(cmd);
  loop.open({ id: M.SOLO.SOLO_ROOM, seat: spec.human, names: { [spec.human]: 'Player', [spec.bot]: OPPONENTS[spec.opponent].name }, dice: new M.AI.Rng(`${diceSeed}:dice`), sides: sidesOf });
  let changes = 0;
  // The page's own roll, marked on the table (match.ts sealedRoll).
  const sealedRoll = async (pool, label, kind) => { const dice = await loop.rollDice(pool, label, kind ?? 'pool'); send({ kind: 'noteRoll', seat: spec.human, what: label }); return dice; };
  const table = new SoloTable({
    data, state: () => state, loop, walking, changed: () => { changes++; }, status, told, sleep, heartbeatMs,
    ...(door ? { page: { send, roll: sealedRoll } } : {}),
  }, spec, hands.held);
  player = new M.AI.Driver(spec.human, {
    data, state: () => state, send,
    // A player's page marks the table after a roll the room made (match.ts
    // sealedRoll). Its Part Die is its own window's and no room's.
    roll: (pool, label, kind) => ('black' in pool ? loop.roll(spec.human, pool, label, 'pool', true) : sealedRoll(pool, label, kind)),
  }, playerPolicy, new M.AI.Rng(`${seed}:${spec.human}`), { prefer: spec.scenario.edges ? [`edge:${spec.scenario.edges[spec.human]}`] : [] });
  // The person's hand is where the page's Tactics panel finds it: this
  // device's storage, for the solo room.
  player.deal(M.H.recallHand(M.SOLO.SOLO_ROOM, spec.human));
  // Plays the player's seat until the game ends or something goes wrong.
  const play = async ({ until, maxIdle = 3000 } = {}) => {
    let idle = 0;
    for (let i = 0; i < 40000; i++) {
      if (until?.(state)) return { kind: 'paused' };
      if (table.trouble) return { kind: 'trouble', why: table.trouble.why };
      const r = await player.step();
      if (r.kind === 'over') { await tick(); return { kind: 'over', result: r.result }; }
      if (r.kind === 'refused' || r.kind === 'stuck') return { kind: r.kind, why: r.why, decision: r.decision?.kind };
      if (r.kind === 'idle') { idle++; await tick(); if (idle > maxIdle) return { kind: 'stalled', round: state.round.n, phase: state.round.phase }; } else idle = 0;
    }
    return { kind: 'limit' };
  };
  const close = () => { table.stop(); M.C.onPerformed(null); M.L.setLocalSeat(null); loop.leave(); };
  return { state, spec, loop, table, player, sent, refused, rolled, send, play, close, changes: () => changes, hands };
}

// ---------- whole games, the computer on the far side of the relay ----------
const games = [];
for (const [scenario, human] of [[alley, 's1'], [alley, 's2'], [vip, 's1'], [vip, 's2']]) {
  const p = page(scenario, human, { seed: 3 });
  p.table.start();
  const end = await p.play();
  games.push({ scenario: scenario.id, human, p, end, seats: p.loop.state.room.seats });
  const bot = p.spec.bot;
  const viaRelay = p.sent.filter((x) => x.via === 'relay');
  check(`${scenario.id}, the player as ${human}: the game is played to its end with nothing refused on either side and the computer never stuck`,
    [end.kind, p.refused, p.table.trouble, p.table.over, p.state.round.n >= 1 && p.state.round.n <= scenario.rounds], ['over', [], null, true, true]);
  check('  every command of the computer\'s arrived through the relay, and none of the player\'s did',
    [viaRelay.length > 50, viaRelay.every((x) => x.seat === bot), p.sent.filter((x) => x.via === 'page' && x.seat === bot && !['configureTable', 'importSquad', 'startMatch', 'lockMap'].includes(x.kind)).length], [true, true, 0]);
  check('  and the page is told once that anything changed: when the game ended', p.changes(), 1);
  p.close();
}
// ---------- the computer says why (M9.2) ----------
{
  const W = M.SOLO.whyLine;
  const turn = { kind: 'opp.act' };
  const o = (label, tags = []) => ({ id: 'x', label, tags });
  check('a turn\'s answer is told with what it was for, in a player\'s words',
    [W(turn, o('Mire: Sprint to E4, facing east', ['move']), 'take_zone'), W(turn, o('Burst Fire at Wolf', ['attack']), 'attack_value'),
      W({ kind: 'loop.designate.command' }, o('Command Porcupine', ['designate']), 'command_by_value'), W(turn, o('Mire: Maneuver to B6, facing west', ['move']), 'blunder'),
      W({ kind: 'loop.designate.command' }, o('Command Porcupine', ['designate']), 'command_opportunity')],
    ['Mire: Sprint to E4, facing east (for the mission)', 'Burst Fire at Wolf (its best attack)', 'Command Porcupine (the Command that does most)', 'Mire: Maneuver to B6, facing west (a mistake)',
      'Command Porcupine (so no Command goes unspent)']);
  // (2026-10-05: the Drones launched to mend and to call a shot, the Aster pilot's Command for Link and a Command
  // a Tactics Card pays for were told nothing: their reasons had no words.)
  check('a Drone launched to mend an ally or to call in a shot, and a Command for Link or paid for by a card, are told too',
    [W(turn, o('Nest: Nest Guardian Swarm: SU1 to E4', ['launch']), 'patch_value'), W(turn, o('Cobra: Launch Snake Eyes: KK9 to F7', ['launch']), 'spotter_value'),
      W({ kind: 'loop.designate.command' }, o('Command Porcupine', ['designate']), 'aster_link'), W({ kind: 'loop.designate.command' }, o('Command Porcupine', ['designate']), 'tactic_command')],
    ['Nest: Nest Guardian Swarm: SU1 to E4 (to mend an ally next round)', 'Cobra: Launch Snake Eyes: KK9 to F7 (to call in a shot)',
      'Command Porcupine (to turn a spare Command into Link)', 'Command Porcupine (a Command its Tactics Card pays for)']);
  check('the unit whose turn it is is named first where the answer does not name it, and never twice',
    [W(turn, o('Burst Fire at Wolf', ['attack']), 'attack_value', 'Dune'), W(turn, o('Mire: Sprint to E4, facing east', ['move']), 'take_zone', 'Mire'),
      W(turn, o('Mire Reveals where it stands', ['reveal']), 'cloak', 'Mire')],
    ['Dune: Burst Fire at Wolf (its best attack)', 'Mire: Sprint to E4, facing east (for the mission)', 'Mire Reveals where it stands (to be hard to target)']);
  check('nothing is told of a dial, a Tactics Card let go by, the end of a turn, a reason it has no words for, or a name that is not a reason at all',
    [W({ kind: 'planning.dial' }, o('Mire: Melee', ['dial']), 'dial_by_plan'), W({ kind: 'tactic.after' }, o('Let Hit and Run go by', ['tactic', 'pass']), 'tactic_kept'),
      W(turn, o('End this Opportunity', ['end']), 'end_activation'), W(turn, o('Mire: Sprint to E4', ['move']), 'no_such_reason'),
      W(turn, o('Mire: Sprint to E4', ['move']), 'constructor'), W(turn, o('Mire: Sprint to E4', ['move']), undefined)],
    [null, null, null, null, null, null]);
  // A whole game against the Ace: every line it told, with the phase it was told in.
  const lines = [];
  const p = page(alley, 's1', { seed: 5, opponent: 'tactician', told: (seat, line) => lines.push({ seat, line, phase: p.state.round.phase,
    named: line.startsWith('Command ') || p.state.tokens.some((t) => t.side === seat && (line.startsWith(`${t.label}:`) || line.startsWith(`${t.label} `))) }) });
  p.table.start();
  const end = await p.play();
  const phrase = /\((for the mission|to close with the enemy|to close in|to attack from there|to be in reach next turn|out of the enemy's sights|to reach a better target|to find something to attack|to attack|its best attack|at the unit its Scan found|where it does most|to jam the enemy|to keep its squad going|to lend a shot|to mend an ally next round|to call in a shot|for what that Stance lets it do|to open an attack|to charge a Part for its attack|to hide behind it|to be hard to target|for what it can do then|worth more played than kept|to put a Drone to work|for the turn it opens|to get back into the fight|to restore its Link|the Command that does most|so no Command goes unspent|to turn a spare Command into Link|a Command its Tactics Card pays for|a mistake)\)$/;
  check('PLAYED against the Ace: the game ends, and the computer tells why as it goes, only of its own seat, never in the Planning Phase (its dials are its secret), each line one of its phrases, each naming the unit it is about',
    [end.kind, p.refused, lines.length > 10, lines.every((x) => x.seat === p.spec.bot), lines.filter((x) => x.phase === 1).length, lines.filter((x) => !phrase.test(x.line)).map((x) => x.line).slice(0, 3),
      lines.filter((x) => !x.named).map((x) => x.line).slice(0, 3)],
    ['over', [], true, true, 0, [], []]);
  p.close();
}
// ---------- what a report may carry of the computer's decisions (M15) ----------
{
  const P = M.SOLO.publicDecisions;
  const e = (round, phase, kind, option, label = option) => ({ n: 0, round, phase, kind, decision: kind, option, label, why: 'w', reason: 'r', options: 2, ms: 1 });
  const log = [
    e(1, 0, 'setup.secondary', 'secondary:3'), e(1, 0, 'setup.designate.leader', 'leader:4'), e(1, 0, 'setup.deploy', 'deploy:4:3,3'),
    e(1, 1, 'planning.commit', 'commit'), e(1, 1, 'planning.dial', 'dial:firing'), e(1, 2, 'opp.act', 'attack:x', 'Single Shot at Mire'),
    e(1, 5, 'tactic.end', 'forget', 'Keep Battlefield Recovery'), e(1, 5, 'tactic.end', 'tactic:275:4', 'Battlefield Recovery: Wild Cat'),
    e(2, 1, 'planning.dial', 'dial:movement'), e(2, 2, 'defence.roll', 'defense.roll'),
  ];
  const at = (n, phase) => P(log, { round: { n, phase } }).map((x) => x.option);
  check('A REPORT CARRIES WHAT THE COMPUTER DID ON THE TABLE, and nothing still hidden from the player: no Secondary Task, no designation at setup, no commitment, no Tactics Card held, and a dial only once both are revealed',
    [at(2, 1), at(2, 2)],
    [['deploy:4:3,3', 'dial:firing', 'attack:x', 'tactic:275:4', 'defense.roll'], ['deploy:4:3,3', 'dial:firing', 'attack:x', 'tactic:275:4', 'dial:movement', 'defense.roll']]);
  check('a copy of each, not the log itself', P(log, { round: { n: 9, phase: 5 } })[0] !== log[2], true);
  check('THE MATCH CENTRE\'S REPORT puts them in, for a game against the computer and no other',
    /computer: solo\s*\n\s*\? \(\) => \(solo \? \{/.test(src('match.ts')) && /publicDecisions\(solo\.table\.log, state\)/.test(src('match.ts')), true);
}
{
  // A GAME OF THE PLAYER'S OWN, played out: the two shipped starters on the
  // Steelworks, a Black Box Main Task and Secondary Tasks on, the Tactician in
  // the other seat. Nothing of it is one of the shipped games.
  const squads = M.SETUP.soloSquads(data, M.SQ.loadSquads());
  const own = M.SETUP.soloOwnGame({ ...M.SETUP.soloPick(data, null, squads), scenario: M.SOLO.SOLO_OWN, map: 'steelworks', mission: 'blackbox-key-facilities', secondaries: true }, squads);
  const p = page(null, 's1', { seed: 4, opponent: 'tactician', own });
  p.table.start();
  const end = await p.play();
  const vp = M.TK.normaliseTasks(p.state.tasks).vp;
  check('A GAME OF THE PLAYER\'S OWN is played to its end: the starters on the Steelworks, Black Box: Key Facility, Secondary Tasks on, against the Tactician; nothing refused, the computer never stuck',
    [end.kind, p.refused, p.table.trouble, p.table.over, p.state.map, p.state.mission, !!p.state.noSecondary, p.state.sideNames?.s1, vp.s1 + vp.s2 >= 0],
    ['over', [], null, true, 'steelworks', 'blackbox-key-facilities', false, 'RAID-RDL-Starter', true]);
  p.close();
}
{
  // THE HANDS (M8.2q). A game of the player's own whose squads bring Tactics
  // Cards: the person's sealed for the solo room, the salts in this device's
  // storage where the Tactics panel finds them; the computer's sealed with
  // salts its seat alone holds. This device's storage is a real one here.
  const stub = globalThis.localStorage;
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
  try {
    const saved = M.SQ.loadSquads();
    const rdl = saved.find((s) => s.id === 'builtin:squad-raid-rdl');
    const un = saved.find((s) => s.id === 'builtin:squad-raid-un');
    const rows = M.SETUP.soloSquads(data, [...saved,
      { ...rdl, id: 'rdl-cards', name: 'RDL with cards', tactics: ['275', '276', '277', '278', '279'] },
      { ...un, id: 'un-cards', name: 'UN with cards', tactics: ['274', '275', '276', '279'] }]);
    const row = rows.find((r) => r.id === 'rdl-cards');
    check('A SQUAD SAVED WITH TACTICS CARDS BRINGS THEM: its row carries them, costs them (30 each, 1.11) and says so',
      [row.squad.tactics, row.points - rows.find((r) => r.id === rdl.id).points, M.SETUP.soloLists(data, rows).mine.rows.find((r) => r.id === 'rdl-cards').note.endsWith(', 5 Tactics Cards')],
      [['275', '276', '277', '278', '279'], 150, true]);
    const own = M.SETUP.soloOwnGame({ ...M.SETUP.soloPick(data, null, rows), scenario: M.SOLO.SOLO_OWN, mine: 'rdl-cards', theirs: 'un-cards', map: 'alley', mission: 'control-frontal-breakthrough' }, rows);
    const back = (s1) => M.SOLO.ownGame(JSON.parse(JSON.stringify({ ...own, squads: { s1, s2: own.squads.s2 } })));
    check('Start writes them with the game, and storage gives them back: card ids as text, each once',
      [own.squads.s1.tactics, own.squads.s2.tactics, back(own.squads.s1).squads.s1.tactics, back({ ...own.squads.s1, tactics: ['275', '275', 7, ''] }).squads.s1.tactics],
      [['275', '276', '277', '278', '279'], ['274', '275', '276', '279'], ['275', '276', '277', '278', '279'], ['275']]);
    const spec = soloSpec(data, { solo: M.SOLO.SOLO_OWN, side: 's1' }, () => 6, own);
    const salts = ['c', 'd', 'e', 'f'].map((x) => x.repeat(32));
    let n = 0;
    const hands = M.SOLO.soloHands(spec, () => salts[n++]);
    const theirs = hands.held.s2 ?? [];
    check('THE HOST DEALS BOTH HANDS SEALED: the player\'s by the page\'s own hand command, the computer\'s with salts made for it, which only its seat is given',
      [spec.scenario.tactics, hands.commands.map((c) => [c.kind, c.seat, c.sealed?.length, c.cards ?? null]), Object.keys(hands.held), theirs.map((c) => c.id)],
      [true, [['setTactics', 's1', 5, null], ['setTactics', 's2', 4, null]], ['s2'], ['274', '275', '276', '279']]);
    check('the player\'s salts are kept on this device for the solo room, where the Tactics panel reads them; nothing of the computer\'s cards is',
      [M.H.recallHand(M.SOLO.SOLO_ROOM, 's1').map((c) => c.id).sort(), M.H.recallHand(M.SOLO.SOLO_ROOM, 's2'), [...store.values()].some((v) => theirs.some((c) => v.includes(c.salt)))],
      [['275', '276', '277', '278', '279'], [], false]);
    check('the computer\'s commitments are its cards and their salts', hands.commands[1].sealed.every((h) => theirs.some((c) => M.SEC.sealTactic(c.id, c.salt) === h)), true);
    check('the hands go to the table after the squads and before the start',
      soloSetup(data, spec.scenario, spec.squads, hands.commands).map((c) => c.kind),
      ['configureTable', 'configureTable', 'configureTable', 'importSquad', 'importSquad', 'setTactics', 'setTactics', 'startMatch', 'lockMap']);
    const watched = M.SOLO.soloHands({ ...spec, watch: true }, () => 'a'.repeat(32));
    check('a game the player only watches deals both hands as a computer\'s', [Object.keys(watched.held).sort(), watched.commands.length], [['s1', 's2'], 2]);
    // Played out, the Tactician in both seats. (Seed 9: a game in which both
    // hands are played. With the Load lent and the better target weighed,
    // 2026-10-03, seed 6's UN never needed a card; seeds 7 to 10 all play on
    // both sides.)
    const p = page(null, 's1', { seed: 9, opponent: 'tactician', own, playerPolicy: M.AI.tacticianPolicy });
    check('the computer\'s seat holds its hand, and the page\'s stand-in the player\'s',
      [p.table.driver.mind.hand?.map((c) => c.id), [...new Set(p.player.mind.hand?.map((c) => c.id))].sort(), p.state.tacticsSealed?.s1?.length, p.state.tacticsSealed?.s2?.length, p.state.tactics?.s2],
      [['274', '275', '276', '279'], ['275', '276', '277', '278', '279'], 5, 4, []]);
    p.table.start();
    const end = await p.play();
    const plays = p.sent.filter((x) => x.kind === 'playTactic');
    check('A GAME WITH BOTH HANDS is played to its end: nothing refused, the computer never stuck, and cards played on both sides, each proved by its salt',
      [end.kind, p.refused, p.table.trouble, p.table.over, plays.some((x) => x.seat === 's2' && x.via === 'relay' && x.ok), plays.some((x) => x.seat === 's1' && x.ok), plays.every((x) => x.ok)],
      ['over', [], null, true, true, true, true]);
    console.log(`       cards played: ${JSON.stringify(Object.fromEntries(['s1', 's2'].map((s) => [s, (p.state.tacticsPlayed?.[s] ?? [])])))}`);
    p.close();
  } finally {
    globalThis.localStorage = stub;
  }
}
{
  const { p } = games[0];
  const bot = p.spec.bot;
  check('both seats\' dice are shown to the page, each under its own seat, the computer\'s never as the page\'s own',
    [p.rolled.some((r) => r.seat === bot), p.rolled.some((r) => r.seat === p.spec.human), p.rolled.filter((r) => r.seat === bot).every((r) => !r.mine), p.rolled.filter((r) => r.seat === p.spec.human).every((r) => r.mine)],
    [true, true, true, true]);
  check('the roll for First Player is summed by its Hits, a pool by its icons', [[...new Set(p.rolled.filter((r) => r.label === 'rolls for First Player').map((r) => r.kind))], p.rolled.some((r) => r.kind === 'pool')], [['hits'], true]);
  check('the computer\'s Part Die is its own window\'s, announced by nobody, as an attacking page\'s is',
    [games.reduce((n, x) => n + x.p.rolled.filter((r) => r.label === 'Part Die').length, 0),
      games.some((x) => x.p.sent.some((c) => c.seat === x.p.spec.bot && c.kind === 'applyPenetration' && c.via === 'relay'))], [0, true]);
  check('each roll the computer is given marks the table, as a player\'s page marks its own',
    p.sent.filter((x) => x.seat === bot && x.kind === 'noteRoll').length, p.rolled.filter((r) => r.seat === bot).length);
  check('each seat has its name at the table, and the computer is called what it is (these games are played against the Brawler, which says so)',
    [games[0].seats, games[1].seats], [{ s1: 'Player', s2: 'Computer (Brawler)' }, { s1: 'Computer (Brawler)', s2: 'Player' }]);
}
{
  // The same seed is the same game.
  const run = async () => {
    const p = page(vip, 's2', { seed: 11 });
    p.table.start();
    const end = await p.play();
    const out = { end: end.kind, vp: end.result?.vp, sent: p.sent.map((x) => `${x.seat}:${x.kind}`).join(' ') };
    p.close();
    return out;
  };
  const a = await run();
  const b = await run();
  check('the same seed and the same play is the same game, command for command', [a.end, a.vp, a.sent === b.sent, a.sent.length > 2000], ['over', b.vp, true, true]);
}
{
  // THE USUAL OPPONENT, through the page's host. The Tactician's long
  // decisions (a dial, a Command, a deployment) are worked out in steps, and
  // the page has its thread back between them (the host's `breathe`).
  const run = async () => {
    const p = page(alley, 's1', { seed: 3, opponent: 'tactician' });
    let breaths = 0;
    const real = globalThis.setTimeout;
    p.table.start();
    const end = await p.play();
    const out = { end: end.kind, refused: p.refused, trouble: p.table.trouble, name: p.loop.state.room.seats[p.spec.bot], sent: p.sent.map((x) => `${x.seat}:${x.kind}`).join(' '), breaths, real };
    p.close();
    return out;
  };
  const a = await run();
  check('against the usual opponent, the Tactician, a game is played to its end with nothing refused and the computer never stuck; at the table it is the Computer, at its level (the Ace)',
    [a.end, a.refused, a.trouble, a.name], ['over', [], null, 'Computer (Ace)']);
  const b = await run();
  check('and the same seed is the same game against it too, though its thinking is put down and picked up: a pause changes no answer', a.sent === b.sent, true);
  check('the page\'s host offers the pause, handing the thread back once it has been held a frame and not at every step; the suite\'s offers none',
    [/breathe: \(\) => this\.breathe\(seat\),/.test(src('solo.ts'))
      && /if \(performance\.now\(\) - this\.breathed < FRAME_MS\) return Promise\.resolve\(\);\n\s+return new Promise<void>\(\(done\) => \{ setTimeout\(\(\) => \{ this\.breathed = performance\.now\(\); done\(\); \}, 0\); \}\);/.test(src('solo.ts')),
    /const choice = pause && this\.policy\.ponder\n\s+\? await musing\(\(\) => this\.policy\.ponder!\(narrowed, view, this\.rng, pause\)\)\n\s+: pondering\(\(\) => this\.policy\.choose\(narrowed, view, this\.rng\)\);/.test(src('ai/driver.ts'))], [true, true]);
}

// ---------- the pace, on a table ----------
{
  // Every decision of the computer's waits before it answers and rests after.
  const waits = [];
  const doing = [];
  const p = page(alley, 's1', { seed: 5, sleep: async (ms) => { waits.push(ms); await tick(); }, status: (seat, x) => doing.push(seat === 's2' ? x : `wrong seat ${seat}`) });
  p.table.start();
  const end = await p.play({ until: (s) => s.round.n >= 2 });
  const taken = p.table.driver.taken;
  check('the computer waits before every answer and lets the table rest after it',
    [end.kind, taken > 20, waits.length >= taken * 2, waits.every((ms) => ms >= 100 && ms <= 2500 * 1.6)], ['paused', true, true, true]);
  check('and says what it is doing while it does it, and that it is waiting when it is not',
    [doing.includes('deploying'), doing.includes('setting its dials'), doing.includes('thinking'), doing.includes(null)], [true, true, true, true]);
  // A pause holds the computer where it is; the game waits for it.
  p.table.pause();
  const before = p.sent.filter((x) => x.via === 'relay').length;
  const held = await p.play({ maxIdle: 200 });
  const during = p.sent.filter((x) => x.via === 'relay').length;
  check('paused, the computer sends nothing more and the game waits for it', [p.table.paused, held.kind, during - before <= 1], [true, 'stalled', true]);
  p.table.resume();
  const on = await p.play({ until: (s) => s.round.n >= 3 });
  check('resumed, it plays on', [p.table.paused, on.kind, p.sent.filter((x) => x.via === 'relay').length > during, p.refused], [false, 'paused', true, []]);
  // Taken down, it sends nothing, even an answer it had already chosen.
  p.table.stop();
  const n = p.sent.filter((x) => x.via === 'relay').length;
  for (let i = 0; i < 50; i++) await tick();
  check('taken down, it sends nothing more', p.sent.filter((x) => x.via === 'relay').length, n);
  p.close();
}
{
  // A walk on the player's board is watched to its end before anything more.
  const waits = [];
  let steps = 0;
  const p = page(alley, 's1', { seed: 5, sleep: async (ms) => { waits.push(ms); await tick(); }, walking: () => steps-- > 0 });
  p.table.start();
  await p.play({ until: (s) => M.SU.normaliseSetup(s.setup)?.stage === 'done' });
  const before = waits.filter((ms) => ms === 50).length;
  steps = 7;
  await p.play({ until: () => steps <= 0, maxIdle: 400 });
  check('while a unit is walking the computer looks again every twentieth of a second, and does nothing else',
    [before, waits.filter((ms) => ms === 50).length], [0, 7]);
  p.close();
}
{
  // Pause, pressed while the computer is in the middle of its moment: the
  // answer it was about to give waits with it, and Resume lets it go.
  let arm = false;
  let cut = 0;
  const p = page(alley, 's1', { seed: 5, sleep: async (ms) => { if (arm && ms > 60) { arm = false; cut = p.sent.filter((x) => x.via === 'relay').length; p.table.pause(); } await tick(); } });
  p.table.start();
  await p.play({ until: (s) => s.round.n >= 2 });
  arm = true;
  await p.play({ until: () => !arm, maxIdle: 400 });
  const held = await p.play({ maxIdle: 200 });
  check('a pause that cuts into the computer\'s moment holds the answer it was about to give',
    [arm, p.table.paused, held.kind, p.sent.filter((x) => x.via === 'relay').length - cut], [false, true, 'stalled', 0]);
  p.table.resume();
  const on = await p.play({ until: (s) => s.round.n >= 3 });
  check('and Resume lets it go: the game plays on', [on.kind, p.sent.filter((x) => x.via === 'relay').length > cut, p.refused], ['paused', true, []]);
  p.close();
}
{
  // The computer's own door: a command the engine refuses is not delivered.
  const p = page(alley, 's1', { seed: 5 });
  const n = p.sent.length;
  const v = p.table.driver.host.send({ kind: 'endOpportunity', seat: 's2', uid: 424242 });
  check('a command of the computer\'s that the engine refuses is told so and never reaches the table', [v.ok, p.sent.length - n, p.refused], [false, 0, []]);
  check('a page that hands the table its door seats nobody in its own seat unless the game is watched', page(alley, 's1', { seed: 5, door: true }).table.player, null);
  p.close();
}
{
  // A scenario fixes each squad's edge, and the computer takes its own when
  // the choice falls to it.
  const edges = [];
  for (let seed = 1; seed <= 40 && edges.length < 5; seed++) {
    const p = page(alley, 's1', { seed, opponent: 'legal' });
    p.table.start();
    await p.play({ until: (s) => M.SU.normaliseSetup(s.setup)?.stage === 'done' });
    if (p.state.round.firstPlayer === p.spec.bot) edges.push(M.SU.normaliseSetup(p.state.setup).edge[p.spec.bot]);
    p.close();
  }
  check('First Player or not, the computer takes the edge the scenario gives its squad', edges, Array(5).fill(alley.edges.s2));
}
{
  // Its choices are drawn from a stream of the game's own seed: the same dice
  // and another seed is another game.
  const placed = async (seed) => {
    const p = page(alley, 's1', { seed, diceSeed: 77, opponent: 'legal' });
    p.table.start();
    await p.play({ until: (s) => M.SU.normaliseSetup(s.setup)?.stage === 'done' });
    const at = p.state.tokens.filter((t) => t.side === p.spec.bot).map((t) => `${t.label}@${t.col},${t.row}`).join(' ');
    p.close();
    return at;
  };
  const spots = [await placed(1), await placed(2), await placed(3), await placed(1)];
  check('the computer\'s choices come from the game\'s seed: another seed deploys differently, the same seed the same',
    [new Set(spots.slice(0, 3)).size > 1, spots[0] === spots[3]], [true, true]);
}
{
  // Speeds scale every pause.
  const at = async (speed) => {
    const waits = [];
    const p = page(alley, 's1', { seed: 5, sleep: async (ms) => { waits.push(ms); await tick(); } });
    p.table.speed = speed;
    p.table.start();
    await p.play({ until: (s) => M.SU.normaliseSetup(s.setup)?.stage === 'done' });
    p.close();
    return waits.reduce((a, b) => a + b, 0) / waits.length;
  };
  const [slow, normal, fast] = [await at('relaxed'), await at('normal'), await at('brisk')];
  check('Relaxed waits longer than Normal, and Brisk less', [slow > normal * 1.3, fast < normal * 0.75], [true, true]);
}
{
  // ON A SLOW MACHINE (OTTO, 2026-10-05: "a slow laptop might be good to check
  // on the speed in which it calculates"): the thought is part of the moment
  // before an answer, not added to it, and a thought that runs long is said to
  // be one, so the page never shows a computer at work as one waiting.
  const waits = [];
  const said = [];
  const p = page(alley, 's1', { seed: 5, sleep: async (ms) => { waits.push(ms); }, status: (_seat, x) => said.push(x) });
  const host = p.table.driver.host;
  const d = { kind: 'opp.act', id: 'opp.act|x', options: [], fallback: '' };
  const o = { id: 'move:x', label: 'x', tags: ['move'] };
  await host.pace(d, o, 0);
  await host.pace(d, o, 1000);
  await host.pace(d, o, 9000);
  check('THE THOUGHT IS PART OF THE MOMENT: a Movement waits its whole moment when the answer came at once, what is left of it after a second\'s thought, and a beat after a long one',
    [waits[0] >= 1300 && waits[0] <= 2400, waits[1] >= 300 && waits[1] <= 1400, waits[2]], [true, true, 100]);
  const r = p.table.runners.find((x) => x.seat === p.spec.bot);
  r.asked = performance.now();
  r.shown = false;
  await host.breathe();
  const quick = said.includes('thinking');
  r.asked = performance.now() - 400;
  await host.breathe();
  await host.breathe();
  check('a thought that runs past a third of a second is said to be one, once', [quick, said.filter((x) => x === 'thinking').length], [false, 1]);
  p.close();
}

// ---------- a game the player only watches ----------
{
  // ?watch=1: the page's own seat is played by a computer too, through the
  // page's own door, so the whole screen can be watched playing itself.
  const said = new Set();
  const p = page(vip, 's1', { seed: 9, watch: true, status: (seat, x) => { if (x) said.add(seat); } });
  check('asked to watch, the table sits a computer in the page\'s own seat as well', [p.spec.watch, !!p.table.player, p.table.player?.seat, p.table.driver.seat], [true, true, 's1', 's2']);
  p.table.start();
  let end = null;
  for (let i = 0; i < 200000 && !p.table.over && !p.table.trouble; i++) await tick();
  end = M.SEAT.gameOver(data, p.state);
  const play = p.sent.filter((x) => !['configureTable', 'importSquad', 'startMatch', 'lockMap'].includes(x.kind));
  const own = play.filter((x) => x.seat === 's1');
  check('and the game plays itself to its end: the page\'s seat through the page\'s door, the other through the relay, nothing refused',
    [p.table.over, end.over, p.table.trouble, p.refused, own.length > 50, own.every((x) => x.via === 'page'), play.filter((x) => x.seat === 's2').every((x) => x.via === 'relay'), [...said].sort()],
    [true, true, null, [], true, true, true, ['s1', 's2']]);
  check('and neither seat\'s Part Die is announced', p.rolled.filter((r) => r.label === 'Part Die').length, 0);
  check('a game not asked to be watched sits nobody in the page\'s seat', games[0].p.table.player, null);
  p.close();
}

// ---------- the table moves on while the computer thinks ----------
{
  // The ready pair. The computer is asked to be ready while the player is not,
  // so its answer is the ready alone; the player readies during its pause; the
  // answer it sends is the one on offer NOW, which also turns the phase.
  const p = page(alley, 's1', { seed: 2 });
  p.table.start();
  await p.play({ until: (s) => M.SU.normaliseSetup(s.setup)?.stage === 'done' });
  p.table.stop();
  const s = p.state;
  const bot = p.spec.bot;
  // Both squads pass the Command Phase, by hand.
  for (const seat of ['s1', 's2']) {
    const pass = { kind: 'passTurn', seat };
    if (seat === bot) p.loop.deliver(pass, bot); else p.send(pass);
  }
  const mind = M.SEAT.newMind();
  const asked = M.SEAT.owed(data, s, bot, mind);
  let inPause = null;
  const sentByBot = [];
  const driver = new M.AI.Driver(bot, {
    data, state: () => s,
    send: (cmd) => { const v = M.C.check(data, s, cmd); if (v.ok) { p.loop.deliver(cmd, bot); sentByBot.push(cmd.kind); } return v; },
    roll: async () => [],
    pace: async (d) => { inPause = d.kind; if (d.kind === 'phase.ready') p.send({ kind: 'setReady', seat: p.spec.human, ready: true }); },
  }, M.AI.safePolicy, new M.AI.Rng('x'));
  const r = await driver.step();
  check('asked while the player is not ready, the computer\'s answer is the ready alone', [asked.kind, asked.options[0].commands.map((c) => c.kind)], ['phase.ready', ['setReady']]);
  check('the player readies while it thinks: what it sends is the answer as offered NOW, and the phase turns',
    [inPause, r.kind, sentByBot, s.round.phase, p.refused], ['phase.ready', 'acted', ['setReady', 'advancePhase'], 1, []]);
  p.close();
}
{
  // A question that is gone by the time the computer has thought about it.
  const p = page(alley, 's2', { seed: 2 });
  p.table.start();
  await p.play({ until: (s) => M.SU.normaliseSetup(s.setup)?.stage === 'done' });
  p.table.stop();
  const s = p.state;
  const bot = p.spec.bot;
  // The End Phase, with the computer the First Player: its steps are its own.
  s.round.phase = 5; s.script.stage = `${s.round.n}:5`; s.script.opp = null; s.round.firstPlayer = bot; s.ready = {};
  const sentByBot = [];
  const driver = new M.AI.Driver(bot, {
    data, state: () => s,
    send: (cmd) => { const v = M.C.check(data, s, cmd); if (v.ok) { p.loop.deliver(cmd, bot); sentByBot.push(cmd.kind); } return v; },
    roll: async () => [],
    // The player takes the same step while the computer is still thinking.
    pace: async (d) => { if (d.kind === 'end.step' && !sentByBot.length) p.send({ kind: 'markEndStep', seat: p.spec.human, step: 'remove' }); },
  }, M.AI.safePolicy, new M.AI.Rng('x'));
  const first = M.SEAT.owed(data, s, bot, M.SEAT.newMind());
  const r = await driver.step();
  check('a step the player took while the computer was thinking is not sent a second time: the question is asked again',
    [first.options[0].id, r.kind, sentByBot, p.refused], ['remove', 'moot', [], []]);
  const r2 = await driver.step();
  check('and the next answer is to the question that now stands', [r2.kind, r2.option?.id, sentByBot], ['acted', 'tokens', ['markEndStep']]);
  p.close();
}

// ---------- a computer that cannot go on says so ----------
{
  // The computer (s2) is asked to roll for First Player, and its dice fail.
  const p = page(alley, 's1', { seed: 4 });
  const noise = [console.warn, console.error];
  console.warn = () => {}; console.error = () => {};
  p.loop.roll = () => Promise.reject(new Error('the dice are gone'));
  p.table.start();
  for (let i = 0; i < 400 && !p.table.trouble; i++) await tick();
  check('a computer that cannot get past a question stops and says why, and the page is told',
    [p.table.trouble, p.changes() > 0], [{ seat: 's2', kind: 'stuck', why: 'the dice are gone' }, true]);
  const n = p.table.driver.taken;
  p.table.wake();
  for (let i = 0; i < 20; i++) await tick();
  check('and it is not asked again until the player says so', [p.table.driver.taken, p.sent.filter((x) => x.via === 'relay').length], [n, 0]);
  delete p.loop.roll;
  p.table.retry();
  for (let i = 0; i < 400 && !p.sent.some((x) => x.via === 'relay' && x.kind === 'rollSetup'); i++) await tick();
  check('told to try again, it does', [p.table.trouble, p.sent.some((x) => x.via === 'relay' && x.kind === 'rollSetup')], [null, true]);
  p.table.stop();
  p.close();

  // An answer the table refuses is not the end: the computer is asked again
  // (it does not give a refused answer twice), and after three in a row the
  // player is told instead.
  const q = page(alley, 's1', { seed: 4 });
  let asked = 0;
  q.table.driver.step = async () => { asked++; return { kind: 'refused', decision: { kind: 'opp.act' }, option: { id: 'a', label: 'Fire' }, command: null, why: 'Out of Range.' }; };
  q.table.start();
  for (let i = 0; i < 50; i++) await tick();
  [console.warn, console.error] = noise;
  check('an answer the table refuses is asked again, and three refusals in a row stop the computer with the reason',
    [asked, q.table.trouble], [3, { seat: 's2', kind: 'refused', why: 'Out of Range.' }]);
  q.close();
  // A question with every answer tried stops it too, and the page is told.
  const k = page(alley, 's1', { seed: 4 });
  k.table.driver.step = async () => ({ kind: 'stuck', decision: { kind: 'opp.act' }, why: 'every answer has been tried' });
  k.table.start();
  for (let i = 0; i < 20; i++) await tick();
  check('a question it cannot get past stops the computer with the reason, and the page is told',
    [k.table.trouble, k.changes()], [{ seat: 's2', kind: 'stuck', why: 'every answer has been tried' }, 1]);
  k.close();
}

M.C.onPerformed(null);
M.L.setLocalSeat(null);
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
