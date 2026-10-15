// THE WAY IN to a game against the computer: the tabletop's "Play the
// computer" row opens this (AI-OPPONENT-PLAN.md, M4.4; OTTO, 2026-10-01: "lets
// focus on building the setting in the freeplay tabletop board"). The player
// picks the game, the squad they play, which computer opponent they play and
// how fast it plays, and Start opens the Match Centre's table on it (match.ts
// startSolo). Nothing of the game itself lives here.
//
// A game is one of the shipped ones, or the player's own (M8.1): any
// battlefield, any Main Task, and a squad for each seat out of the squads this
// device already keeps (squadstore.ts) and the shipped lists.
//
// On the house dialog frame (dialog.ts), each group a pick-one list of the
// rows a dialog already has (.dlg-pick): flat, the chosen row in the accent
// tint (ui.css rules 1 and 2). A row that has more choices than fit shows the
// one chosen and opens the list in a dialog of its own (.dlg-open, with the
// chevron every "way into something" carries).
//
// THE PLAY STYLE (M19; OTTO, 2026-10-13, the canvas "Computer Play Styles",
// version 7, its words; released 2026-10-15): how each computer plays, beside
// its Difficulty, picked in a dialog of its own; Custom opens one more, a row
// for each behaviour. A style the computer's squad has no parts for is shown
// greyed with why, and one picked before the squad changed goes back to
// Default with a line saying so.
import type { GameData, SoloScenario, SoloSquad } from './data';
import { openDialog } from './dialog';
import {
  CUSTOM_ROWS, customFrom, NEED_WORDS, ownChoice, RIVAL, RIVALS, SOLO_OWN, SOLO_OWN_KEY, SPEEDS, STYLE, STYLES, styleFits, soloQuery,
  type SoloOwn, type Speed,
} from './soloask';
import { loadSquads, type SavedSquad } from './squadstore';
import type { MechLoadout, Side } from './types';

export interface SoloPick {
  // A shipped game's id, or SOLO_OWN.
  scenario: string;
  side: Side;
  speed: Speed;
  opponent: string;
  // Two computers play and the player watches (OTTO, 2026-10-05): the one in
  // the player's seat is `opponent2`.
  watch: boolean;
  opponent2: string;
  // A game of the player's own: the battlefield, the Main Task, each seat's
  // squad (a SoloSquadRow's id) and whether Secondary Tasks are played.
  map: string;
  mission: string;
  mine: string;
  theirs: string;
  secondaries: boolean;
  // The Season Rules the game is played with, or '' for the main rules (OTTO,
  // 2026-10-05: "a toggle to turn these seasonal rules on or off").
  season: string;
  // How the computer plays (soloask.ts STYLES), and in a game the player
  // watches the one in their seat (`style2`); the Custom style's picks, kept
  // on this device for whichever computer plays it.
  style: string;
  style2: string;
  custom: Record<string, string>;
}

// The last game set up on this device, so the dialog opens on it again.
const KEY = 'ember-solo-setup';
// The Main Task a game of the player's own opens on, while nothing is kept.
const USUAL_TASK = 'control-frontal-breakthrough';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// ---------- the squads a game of the player's own may be played with ----------

// A squad the player may field, or set the computer to: one this device keeps
// (the shipped starters and every squad saved or imported here) or one of the
// shipped games' lists.
export interface SoloSquadRow {
  id: string;
  squad: SoloSquad;
  points: number;
}

const SLOTS: (keyof MechLoadout)[] = ['torso', 'chasis', 'leftHand', 'rightHand', 'backpack', 'pilot'];

// What a squad costs on the current lists: every Part and Pilot of its Mechs,
// every Drone and the Load a Carrier bears, and its Tactics Cards.
export function soloSquadPoints(data: GameData, sq: SoloSquad): number {
  const cost = (id?: string): number => (id ? data.byId.get(id)?.score ?? 0 : 0);
  return sq.mechs.reduce((n, m) => n + SLOTS.reduce((k, slot) => k + cost(m.loadout[slot]), 0), 0)
    + sq.drones.reduce((n, d) => n + cost(d.cardId) + cost(d.backpack), 0)
    + (sq.tactics ?? []).reduce((n, id) => n + cost(id), 0);
}

export function soloSquads(data: GameData, saved: SavedSquad[]): SoloSquadRow[] {
  const rows: { id: string; squad: SoloSquad }[] = saved.map((s) => ({
    id: s.id, squad: { name: s.name, mechs: s.mechs, drones: s.drones, ...(s.tactics?.length ? { tactics: [...s.tactics] } : {}) },
  }));
  for (const [key, sq] of Object.entries(data.solo.squads)) rows.push({ id: `solo:${key}`, squad: sq });
  return rows.map((r) => ({ ...r, points: soloSquadPoints(data, r.squad) }));
}

// A squad in a line: what it costs and what it brings.
function squadNote(sq: SoloSquad, points: number): string {
  const mechs = `${sq.mechs.length} Mech${sq.mechs.length === 1 ? '' : 's'}`;
  const drones = sq.drones.length ? `, ${sq.drones.length} Drone${sq.drones.length === 1 ? '' : 's'}` : '';
  const cards = sq.tactics?.length ? `, ${sq.tactics.length} Tactics Card${sq.tactics.length === 1 ? '' : 's'}` : '';
  return `${points} points · ${mechs}${drones}${cards}`;
}

// ---------- the pick ----------

// The pick the dialog opens on: the one kept from last time while it still
// names things this build and this device have, else the first game from its
// first squad at Normal speed against the usual opponent.
export function soloPick(data: GameData, kept: unknown, squads: SoloSquadRow[] = []): SoloPick {
  const games = data.solo.scenarios;
  const k = (kept && typeof kept === 'object' ? kept : {}) as Partial<SoloPick>;
  const game = games.find((g) => g.id === k.scenario) ?? games[0];
  const has = (id: unknown): id is string => typeof id === 'string' && squads.some((s) => s.id === id);
  const usual = (want: string, nth: number): string => (has(want) ? want : squads[nth]?.id ?? squads[0]?.id ?? '');
  const maps = data.terrain.maps;
  const tasks = data.missions.cards;
  return {
    // A game of the player's own needs squads to play it with.
    scenario: k.scenario === SOLO_OWN && squads.length ? SOLO_OWN : game?.id ?? '',
    side: k.side === 's2' ? 's2' : 's1',
    speed: SPEEDS.find((s) => s.id === k.speed)?.id ?? 'normal',
    opponent: RIVALS.find((r) => r.id === k.opponent)?.id ?? RIVAL,
    watch: k.watch === true,
    opponent2: RIVALS.find((r) => r.id === k.opponent2)?.id ?? RIVAL,
    map: maps.find((m) => m.id === k.map)?.id ?? maps[0]?.id ?? '',
    mission: (tasks.find((c) => c.id === k.mission) ?? tasks.find((c) => c.id === USUAL_TASK) ?? tasks[0])?.id ?? '',
    mine: has(k.mine) ? k.mine : usual('builtin:squad-raid-rdl', 0),
    theirs: has(k.theirs) ? k.theirs : usual('builtin:squad-raid-un', 1),
    secondaries: k.secondaries === true,
    season: (data.seasons ?? []).some((s) => s.id === k.season) ? k.season as string : '',
    style: STYLES.find((x) => x.id === k.style)?.id ?? STYLE,
    style2: STYLES.find((x) => x.id === k.style2)?.id ?? STYLE,
    custom: customFrom(Object.entries(k.custom && typeof k.custom === 'object' ? k.custom : {}).map(([r, o]) => `${r}-${String(o).toLowerCase()}`).join('.')),
  };
}

// ---------- the play style ----------

// The squad a computer plays: in a game the player plays, the other seat's;
// in one the player watches, `which` says whose ('bot' the other squad,
// 'human' the one watched from). A game of the player's own seats them first.
export function computerSquad(data: GameData, pick: SoloPick, squads: SoloSquadRow[], which: 'bot' | 'human'): SoloSquad | null {
  if (pick.scenario === SOLO_OWN && squads.length) return squads.find((s) => s.id === (which === 'bot' ? pick.theirs : pick.mine))?.squad ?? null;
  const game = data.solo.scenarios.find((g) => g.id === pick.scenario) ?? data.solo.scenarios[0];
  const seat: Side = which === 'human' ? pick.side : pick.side === 's1' ? 's2' : 's1';
  return game ? data.solo.squads[game.seats[seat]] ?? null : null;
}

// THE FALLBACK (the canvas's "Fallback"): a style the computer's squad has no
// parts for goes back to Default, in a line the dialog shows once.
export function settleStyles(data: GameData, pick: SoloPick, squads: SoloSquadRow[]): string[] {
  const said: string[] = [];
  const settle = (key: 'style' | 'style2', which: 'bot' | 'human'): void => {
    const sq = computerSquad(data, pick, squads, which);
    if (styleFits(data, sq, pick[key])) return;
    const st = STYLES.find((x) => x.id === pick[key]);
    pick[key] = STYLE;
    if (st?.needs) said.push(`${st.name} needs ${NEED_WORDS[st.needs]}. The computer now plays ${sq?.name ?? 'a squad'}, which has none, so its style is back to Default.`);
  };
  settle('style', 'bot');
  if (pick.watch) settle('style2', 'human');
  return said;
}

// A game in a player's words: its Main Task, and where it is played.
export function soloGameLabel(data: GameData, g: SoloScenario): { name: string; note: string } {
  const task = data.missions.cards.find((c) => c.id === g.mission)?.name ?? g.mission;
  const map = data.terrain.maps.find((m) => m.id === g.map)?.name.en ?? g.map;
  return { name: task, note: `${map} · ${g.rounds} rounds` };
}

// A squad in a player's words: what it is called, what it costs and brings.
export function soloSquadLabel(data: GameData, g: SoloScenario, seat: Side): { name: string; note: string } {
  const sq = data.solo.squads[g.seats[seat]];
  const mechs = `${sq.mechs.length} Mech${sq.mechs.length === 1 ? '' : 's'}`;
  const drones = sq.drones.length ? `, ${sq.drones.length} Drone${sq.drones.length === 1 ? '' : 's'}` : '';
  return { name: sq.name, note: `${sq.points !== undefined ? `${sq.points} points · ` : ''}${mechs}${drones}` };
}

// What each of a game's own lists offers, as rows: the battlefields, the Main
// Tasks (each with when it pays), the squads.
type Listed = { id: string; name: string; note: string };
export function soloLists(data: GameData, squads: SoloSquadRow[]): Record<'map' | 'mission' | 'mine' | 'theirs', { title: string; rows: Listed[] }> {
  const fielded: Listed[] = squads.map((s) => ({ id: s.id, name: s.squad.name, note: squadNote(s.squad, s.points) }));
  return {
    map: { title: 'The battlefield', rows: data.terrain.maps.map((m) => ({ id: m.id, name: m.name.en ?? m.id, note: '' })) },
    mission: {
      title: 'The Main Task',
      rows: data.missions.cards.map((c) => ({ id: c.id, name: c.name, note: c.cadence === 'at-end' ? 'paid as the game ends' : c.family === 'vip' ? 'the Commanders' : 'paid every round' })),
    },
    mine: { title: 'Your squad', rows: fielded },
    theirs: { title: 'The computer\'s squad', rows: fielded },
  };
}

export function soloSetupHtml(data: GameData, pick: SoloPick, squads: SoloSquadRow[] = [], said: string[] = []): string {
  const games = data.solo.scenarios;
  const own = pick.scenario === SOLO_OWN && squads.length > 0;
  const game = games.find((g) => g.id === pick.scenario) ?? games[0];
  // `long`: a note that is a line of its own (what a Season changes), set under the name and wrapping.
  const row = (group: string, id: string, label: { name: string; note: string }, on: boolean, long = false): string =>
    `<button type="button" class="dlg-pick${long ? ' dlg-pick-long' : ''}" data-${group}="${esc(id)}" aria-pressed="${on}"><span>${esc(label.name)}</span><em>${esc(label.note)}</em></button>`;
  // A row that shows what is chosen and opens the list it was chosen from.
  const opens = (what: string, label: string, value: string): string =>
    `<button type="button" class="dlg-pick dlg-open" data-open="${esc(what)}"><span>${esc(label)}</span><span class="dlg-pick-end"><em>${esc(value)}</em><span class="ui-go" aria-hidden="true">›</span></span></button>`;
  const lists = soloLists(data, squads);
  const named = (what: 'map' | 'mission' | 'mine' | 'theirs', id: string): Listed => lists[what].rows.find((r) => r.id === id) ?? { id, name: id, note: '' };
  const offered = [
    ...games.map((g) => row('game', g.id, soloGameLabel(data, g), !own && g.id === game.id)),
    ...(squads.length ? [row('game', SOLO_OWN, { name: 'Custom Game', note: 'any map, mission and squads' }, own)] : []),
  ];
  // In a game the player watches, the squad on their side of the table is the
  // one the page shows the game from, and a computer is picked for each.
  const watch = pick.watch;
  const yours = watch ? 'Watch from' : 'Your squad';
  const table = own
    ? `<p class="dlg-eyebrow">The table</p>
    <div class="dlg-picks">${opens('map', 'Battlefield', named('map', pick.map).name)}${opens('mission', 'Main Task', named('mission', pick.mission).name)}</div>
    <p class="dlg-eyebrow">${yours}</p>
    <div class="dlg-picks">${opens('mine', named('mine', pick.mine).name, named('mine', pick.mine).note)}</div>
    <p class="dlg-eyebrow">${watch ? 'The other squad' : 'The computer\'s squad'}</p>
    <div class="dlg-picks">${opens('theirs', named('theirs', pick.theirs).name, named('theirs', pick.theirs).note)}</div>
    <p class="dlg-eyebrow">Secondary Tasks</p>
    <div class="dlg-picks">${row('secondary', 'off', { name: 'Off', note: 'the Main Task alone' }, !pick.secondaries)}${row('secondary', 'on', { name: 'On', note: 'each squad takes one' }, pick.secondaries)}</div>`
    : `<p class="dlg-eyebrow">${yours}</p>
    <div class="dlg-picks">${(['s1', 's2'] as Side[]).map((seat) => row('side', seat, soloSquadLabel(data, game, seat), seat === pick.side)).join('')}</div>`;
  const levels = (group: string, chosen: string): string =>
    // Each computer by its name and how hard it is, at the row's end where a note goes (OTTO, 2026-10-10: "the
    // buttons would just have the name and then difficulty, ie. [Recruit -------------- EASY]").
    `<div class="dlg-picks">${RIVALS.map((r) => row(group, r.id, { name: r.name, note: r.level.toUpperCase() }, r.id === chosen)).join('')}</div>`;
  const nameOf = (seat: Side): string => (own ? named(seat === 's1' ? 'mine' : 'theirs', seat === 's1' ? pick.mine : pick.theirs).name : soloSquadLabel(data, game, seat).name);
  const near: Side = own ? 's1' : pick.side;
  const far: Side = near === 's1' ? 's2' : 's1';
  // Each computer's style: the row that opens the styles, and what the style
  // does in a line under it (the canvas's "Main" and "Watch").
  const styled = (key: 'style' | 'style2', which: 'bot' | 'human'): string => {
    const st = STYLES.find((x) => x.id === pick[key]) ?? STYLES[0];
    const line = st.id === 'custom' ? 'Your own settings for each behaviour.' : `${st.line.charAt(0).toUpperCase()}${st.line.slice(1)}.`;
    const practice = !watch && st.id !== STYLE ? ' Styles are for practice and can play weaker than Default.' : '';
    return `<div class="dlg-picks"><button type="button" class="dlg-pick dlg-open" data-style="${which}"><span>Style</span><span class="dlg-pick-end"><em>${esc(st.name)}</em><span class="ui-go" aria-hidden="true">›</span></span></button></div>
    <p class="dlg-note">${esc(line + practice)}</p>`;
  };
  const notice = said.map((t) => `<p class="dlg-note dlg-notice" role="status">${esc(t)}</p>`).join('');
  const computers = watch
    ? `<p class="dlg-eyebrow">${esc(nameOf(near))} · Difficulty</p>${levels('rival2', pick.opponent2)}
    <p class="dlg-eyebrow">${esc(nameOf(near))} · Play style</p>${styled('style2', 'human')}
    <p class="dlg-eyebrow">${esc(nameOf(far))} · Difficulty</p>${levels('rival', pick.opponent)}
    <p class="dlg-eyebrow">${esc(nameOf(far))} · Play style</p>${styled('style', 'bot')}${notice}`
    : `<p class="dlg-eyebrow">Difficulty</p>${levels('rival', pick.opponent)}
    <p class="dlg-eyebrow">Play style</p>${styled('style', 'bot')}${notice}`;
  // THE RULES PLAYED: the main rules, or a Season the publisher trials beside
  // them (Supplementary Rules 1.04, section 8), each in a line of what it
  // changes. The pad's setup offers the same choice in the same words.
  const seasons = data.seasons ?? [];
  const rules = seasons.length
    ? `<p class="dlg-eyebrow">Rules</p>
    <div class="dlg-picks">${row('season', '', { name: 'Standard', note: 'core rules and FAQ' }, !pick.season)}${
      seasons.map((s) => row('season', s.id, { name: s.label, note: 'season rule changes' }, pick.season === s.id)).join('')}</div>`
    : '';
  // The opening names both ways in, whichever is picked (OTTO, 2026-10-10: the watched game's line alone read as if
  // a game could only be watched).
  return `<h3 class="dlg-title">Play the computer</h3>
    <p class="dlg-body">Play against the computer, or watch two computers play. No account or connection needed.${watch
    ? ' The Thinking tab shows what each one chose and why.'
    : own ? ' The computer plays any squad you give it; it does not yet use every special Action a card prints.' : ''}</p>
    <p class="dlg-eyebrow">Game</p>
    <div class="dlg-picks">${offered.join('')}</div>
    <p class="dlg-eyebrow">Mode</p>
    <div class="dlg-picks">${row('who', 'you', { name: 'Play', note: 'you vs. the computer' }, !watch)}${row('who', 'watch', { name: 'Watch', note: 'computer vs. computer' }, watch)}</div>
    ${table}
    ${computers}
    ${rules}
    <p class="dlg-eyebrow">Speed</p>
    <div class="dlg-picks">${SPEEDS.map((s) => row('speed', s.id, { name: s.name, note: s.note }, s.id === pick.speed)).join('')}</div>
    <div class="dlg-actions">
      <button class="dlg-primary" data-ok data-autofocus>Start</button>
      <button data-cancel>Cancel</button>
    </div>`;
}

// A game of the player's own as the Match Centre's page is handed it: the
// table, and each seat's squad as the table imports one. The player sits
// first. Null while a squad picked is not one this device has.
export function soloOwnGame(pick: SoloPick, squads: SoloSquadRow[]): SoloOwn | null {
  const of = (id: string): SoloSquad | null => {
    const sq = squads.find((s) => s.id === id)?.squad;
    return sq ? { name: sq.name, ...(sq.faction ? { faction: sq.faction } : {}), mechs: sq.mechs, drones: sq.drones, ...(sq.tactics?.length ? { tactics: [...sq.tactics] } : {}) } : null;
  };
  const s1 = of(pick.mine);
  const s2 = of(pick.theirs);
  return s1 && s2 ? { map: pick.map, mission: pick.mission, rounds: 5, secondaries: pick.secondaries, squads: { s1, s2 } } : null;
}

// Where Start goes: the Match Centre's page, asked for this game.
export function soloAddress(pick: SoloPick): string {
  const own = pick.scenario === SOLO_OWN;
  return `match/${soloQuery({
    scenario: pick.scenario, side: own ? 's1' : pick.side, speed: pick.speed, opponent: pick.opponent, watch: pick.watch, opponent2: pick.opponent2,
    season: pick.season || undefined, style: pick.style, style2: pick.style2, custom: pick.custom,
  })}`;
}

// One of a game's own lists, in a dialog of its own over the setup: the row
// chosen is in the accent tint, a press picks and closes. Null when it is
// closed with nothing picked.
function pickFrom(title: string, rows: Listed[], current: string): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (id: string | null, close?: () => void): void => {
      if (settled) return;
      settled = true;
      close?.();
      resolve(id);
    };
    openDialog(
      `<h3 class="dlg-title">${esc(title)}</h3>
      <div class="dlg-picks">${rows.map((r) => `<button type="button" class="dlg-pick" data-pick="${esc(r.id)}" aria-pressed="${r.id === current}"${r.id === current ? ' data-autofocus' : ''}><span>${esc(r.name)}</span><em>${esc(r.note)}</em></button>`).join('')}</div>
      <div class="dlg-actions"><button data-cancel>Cancel</button></div>`,
      (panel, close) => {
        panel.addEventListener('click', (ev) => {
          const b = (ev.target as HTMLElement).closest<HTMLElement>('button');
          if (!b || !panel.contains(b)) return;
          if (b.dataset.pick !== undefined) done(b.dataset.pick, close);
          else if ('cancel' in b.dataset) done(null, close);
        });
      },
      () => done(null),
    );
  });
}

// THE STYLES, in a dialog of their own over the setup (the canvas's "Styles"):
// a press on one picks it and closes; one the squad has no parts for is shown
// and cannot be picked (aria-disabled, with why). Custom answers 'custom', and
// the setup opens its rows. Null when it is closed with nothing picked.
export function styleListHtml(data: GameData, current: string, squad: SoloSquad | null): string {
  const name = squad?.name ?? 'Its squad';
  const rows = STYLES.map((st) => {
    if (!styleFits(data, squad, st.id) && st.needs) {
      return `<button type="button" class="dlg-pick dlg-pick-long" aria-disabled="true" data-why="${esc(`needs ${NEED_WORDS[st.needs]}; ${name} has none`)}"><span>${esc(st.name)}</span><em>${esc(`needs ${NEED_WORDS[st.needs]} · ${name} has none`)}</em></button>`;
    }
    const on = st.id === current;
    if (st.id === 'custom') {
      return `<button type="button" class="dlg-pick dlg-open" data-pick="custom" aria-pressed="${on}"${on ? ' data-autofocus' : ''}><span>${esc(st.name)}</span><span class="dlg-pick-end"><em>${esc(st.line)}</em><span class="ui-go" aria-hidden="true">›</span></span></button>`;
    }
    return `<button type="button" class="dlg-pick" data-pick="${esc(st.id)}" aria-pressed="${on}"${on ? ' data-autofocus' : ''}><span>${esc(st.name)}</span><em>${esc(st.line)}</em></button>`;
  });
  return `<h3 class="dlg-title">Play style</h3>
    <p class="dlg-body">Changes how the computer plays, not its difficulty.</p>
    <div class="dlg-picks">${rows.join('')}</div>
    <p class="dlg-note">The computer plays ${esc(name)}. A style its squad has no parts for is shown but cannot be picked.</p>
    <div class="dlg-actions"><button data-cancel>Cancel</button></div>`;
}

function pickStyle(data: GameData, current: string, squad: SoloSquad | null): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (id: string | null, close?: () => void): void => {
      if (settled) return;
      settled = true;
      close?.();
      resolve(id);
    };
    openDialog(styleListHtml(data, current, squad), (panel, close) => {
      panel.addEventListener('click', (ev) => {
        const b = (ev.target as HTMLElement).closest<HTMLElement>('button');
        if (!b || !panel.contains(b) || b.getAttribute('aria-disabled') === 'true') return;
        if (b.dataset.pick !== undefined) done(STYLES.some((x) => x.id === b.dataset.pick) ? b.dataset.pick : null, close);
        else if ('cancel' in b.dataset) done(null, close);
      });
    }, () => done(null));
  });
}

// THE CUSTOM STYLE'S ROWS (the canvas's "Customize"), each behaviour with its
// choices, the one in play in the accent tint: the player's pick, else the
// level's own ("Normal matches Default").
export function customHtml(level: string, picks: Readonly<Record<string, string>>): string {
  const groups: string[] = [];
  for (const row of CUSTOM_ROWS) if (!groups.includes(row.group)) groups.push(row.group);
  const body = groups.map((g) => `<p class="dlg-eyebrow">${esc(g)}</p>
    <div class="dlg-picks">${CUSTOM_ROWS.filter((r) => r.group === g).map((r) => {
      const now = picks[r.id] ?? ownChoice(level, r.id);
      return `<div class="dlg-row"><span>${esc(r.label)}</span><span class="dlg-seg" role="group" aria-label="${esc(r.label)}">${
        r.opts.map((o) => `<button type="button" data-row="${esc(r.id)}" data-opt="${esc(o)}" aria-pressed="${o === now}">${esc(o)}</button>`).join('')}</span></div>`;
    }).join('')}</div>`).join('');
  return `<h3 class="dlg-title">Custom style</h3>
    <p class="dlg-body">Set each behaviour. Normal matches Default. Saved on this device.</p>
    ${body}
    <div class="dlg-actions">
      <button class="dlg-primary" data-ok>Done</button>
      <button data-reset>Reset to Default</button>
      <button data-cancel>Cancel</button>
    </div>`;
}

function customize(level: string, kept: Readonly<Record<string, string>>): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    let settled = false;
    const picks: Record<string, string> = { ...kept };
    const done = (out: Record<string, string> | null, close?: () => void): void => {
      if (settled) return;
      settled = true;
      close?.();
      resolve(out);
    };
    openDialog(customHtml(level, picks), (panel, close) => {
      panel.addEventListener('click', (ev) => {
        const b = (ev.target as HTMLElement).closest<HTMLElement>('button');
        if (!b || !panel.contains(b)) return;
        if (b.dataset.row && b.dataset.opt) {
          const row = CUSTOM_ROWS.find((r) => r.id === b.dataset.row);
          if (!row || !row.opts.includes(b.dataset.opt)) return;
          picks[row.id] = b.dataset.opt;
          panel.innerHTML = customHtml(level, picks);
          panel.querySelector<HTMLElement>(`[data-row="${row.id}"][data-opt="${b.dataset.opt}"]`)?.focus();
        } else if ('reset' in b.dataset) {
          for (const k of Object.keys(picks)) delete picks[k];
          panel.innerHTML = customHtml(level, picks);
          panel.querySelector<HTMLElement>('[data-reset]')?.focus();
        } else if ('ok' in b.dataset) {
          // Only what differs from the level's own is kept: a row left as it was follows the level.
          done(Object.fromEntries(Object.entries(picks).filter(([r, o]) => o !== ownChoice(level, r))), close);
        } else if ('cancel' in b.dataset) done(null, close);
      });
    }, () => done(null));
  });
}

export function openSoloSetup(data: GameData, go: (address: string) => void): void {
  let kept: unknown = null;
  try { kept = JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { /* unreadable is the same as absent */ }
  const squads = soloSquads(data, loadSquads());
  const pick = soloPick(data, kept, squads);
  if (!pick.scenario) return;
  // A style kept from last time that this squad cannot play is said at once.
  let said = settleStyles(data, pick, squads);
  openDialog(soloSetupHtml(data, pick, squads, said), (panel, close) => {
    const draw = (pressed: string): void => {
      // Drawn again with the pick, a style the squads now in play cannot play
      // put back to Default and said, and the focus put back on the row pressed.
      said = settleStyles(data, pick, squads);
      panel.innerHTML = soloSetupHtml(data, pick, squads, said);
      panel.querySelector<HTMLElement>(pressed)?.focus();
    };
    // The panel is drawn again after every pick, so the presses are heard on
    // the panel itself and outlive the rows.
    panel.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>('button');
      if (!b || !panel.contains(b)) return;
      let pressed = '';
      if (b.dataset.game) { pick.scenario = b.dataset.game; pressed = `[data-game="${pick.scenario}"]`; }
      else if (b.dataset.side) { pick.side = b.dataset.side === 's2' ? 's2' : 's1'; pressed = `[data-side="${pick.side}"]`; }
      else if (b.dataset.speed) { pick.speed = SPEEDS.find((s) => s.id === b.dataset.speed)?.id ?? pick.speed; pressed = `[data-speed="${pick.speed}"]`; }
      else if (b.dataset.rival) { pick.opponent = RIVALS.find((r) => r.id === b.dataset.rival)?.id ?? pick.opponent; pressed = `[data-rival="${pick.opponent}"]`; }
      else if (b.dataset.rival2) { pick.opponent2 = RIVALS.find((r) => r.id === b.dataset.rival2)?.id ?? pick.opponent2; pressed = `[data-rival2="${pick.opponent2}"]`; }
      else if (b.dataset.who) { pick.watch = b.dataset.who === 'watch'; pressed = `[data-who="${pick.watch ? 'watch' : 'you'}"]`; }
      else if (b.dataset.secondary) { pick.secondaries = b.dataset.secondary === 'on'; pressed = `[data-secondary="${pick.secondaries ? 'on' : 'off'}"]`; }
      else if (b.dataset.season !== undefined) {
        pick.season = (data.seasons ?? []).some((s) => s.id === b.dataset.season) ? b.dataset.season : '';
        pressed = `[data-season="${pick.season}"]`;
      }
      else if (b.dataset.style) {
        // The computer whose style it is: in a game the player watches, the
        // one in their seat ('human') or the other.
        const which = b.dataset.style === 'human' && pick.watch ? 'human' : 'bot';
        const key = which === 'human' ? 'style2' : 'style';
        const level = which === 'human' ? pick.opponent2 : pick.opponent;
        void pickStyle(data, pick[key], computerSquad(data, pick, squads, which)).then(async (id) => {
          if (id === 'custom') {
            const picks = await customize(level, pick.custom);
            if (picks) {
              pick.custom = picks;
              pick[key] = 'custom';
              // Saved on this device as the dialog says, with the rest of the pick as it stands.
              try { localStorage.setItem(KEY, JSON.stringify(pick)); } catch { /* kept until Start, then */ }
            }
          } else if (id !== null) pick[key] = id;
          draw(`[data-style="${which}"]`);
        });
        return;
      } else if (b.dataset.open) {
        const what = b.dataset.open as 'map' | 'mission' | 'mine' | 'theirs';
        const list = soloLists(data, squads)[what];
        if (!list) return;
        void pickFrom(list.title, list.rows, pick[what]).then((id) => {
          if (id !== null && list.rows.some((r) => r.id === id)) pick[what] = id;
          draw(`[data-open="${what}"]`);
        });
        return;
      } else if ('ok' in b.dataset) {
        try {
          localStorage.setItem(KEY, JSON.stringify(pick));
          if (pick.scenario === SOLO_OWN) {
            const own = soloOwnGame(pick, squads);
            if (!own) return;
            localStorage.setItem(SOLO_OWN_KEY, JSON.stringify(own));
          }
        } catch {
          // A full store costs only the memory of the pick for a shipped game.
          // A game of the player's own travels in it, so there is none to go to.
          if (pick.scenario === SOLO_OWN) return;
        }
        close();
        go(soloAddress(pick));
        return;
      } else if ('cancel' in b.dataset) { close(); return; } else return;
      draw(pressed);
    });
  });
}
