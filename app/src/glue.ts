// The guide glue: the deterministic turn bookkeeping every client runs between
// commands so all of them derive the same script state without it ever
// crossing the wire - which phase-entry resets to make, whose Action
// Opportunity it is, what a designation opens.
//
// It lived in matchhud.ts (mirrored from playguide.ts, and mirrored again in
// tests/simgame.test.mjs). The pad's guided mode is a fourth client of the
// same script, and a fourth copy is how two phones come to disagree about
// whose turn it is. So the shared half lives here, and matchhud.ts imports it
// and adds only what a board page needs on top (the smoke-dissipation queue).
import type { GameData } from './data';
import type { Command } from './commands';
import { clearDroneCommands, seedCommandTokens } from './commands';
import { type InitLookup, nextActivation } from './loop';
import { normaliseSetup } from './setup';
import { extrasFor } from './units';
import { newOpportunity, newScriptState, type GameState, type Opportunity, type Timing } from './types';

const PKEY: Record<Timing, 'swift' | 'melee' | 'projectile' | 'firing' | 'moving' | 'tactic'> = {
  swift: 'swift', melee: 'melee', projectile: 'projectile', firing: 'firing', movement: 'moving', tactical: 'tactic',
};

export function makeInit(data: GameData): InitLookup {
  return (t, timing) => {
    const p = t.mech?.pilot ? data.byId.get(t.mech.pilot) : undefined;
    const v = p?.[PKEY[timing]];
    return typeof v === 'number' ? v : undefined;
  };
}

export function ensureScript(state: GameState): NonNullable<GameState['script']> {
  if (!state.script) state.script = { ...newScriptState(state.round.firstPlayer), strict: true };
  return state.script;
}

export function enterPhase(data: GameData, s: GameState): void {
  const sc = ensureScript(s);
  if (s.round.phase === 0) {
    seedCommandTokens(data, s);
    sc.commanded = [];
    sc.freeCommand = [];
  } else if (sc.stage.split(':')[1] === '0') {
    // 3.2.3, on the way out of the Command Phase - and ONLY then: the Drones'
    // Command Tokens come off, the Mechs' reserved ones do not. sc.stage still
    // names the phase being left at this point, and the leaving check matters:
    // a token a Drone is handed later through Command Coordination stays on its
    // card until the End Phase sweep (4.15.4), so stripping Drones on every
    // phase entry would delete it one phase early.
    clearDroneCommands(s);
  }
  if (s.round.phase === 0 || s.round.phase === 2) sc.acted = [];
  sc.endDone = sc.endDone.filter((k) => k.startsWith(`${s.round.n}:`));
  // Once-per-round abilities are keyed by round for the same reason, so the
  // ledger is pruned the same way rather than growing all game.
  sc.oncePerRound = (sc.oncePerRound ?? []).filter((k) => k.startsWith(`${s.round.n}:`));
  sc.opp = null;
  sc.passed = [];
  sc.turn = s.round.firstPlayer;
  sc.stage = `${s.round.n}:${s.round.phase}`;
}

// Runs after any command lands, ours or theirs, so both clients derive the
// same turn bookkeeping without it ever crossing the wire.
export function glueAfter(data: GameData, state: GameState, cmd: Command): void {
  if (!normaliseSetup(state.setup) && cmd.kind !== 'startMatch') return;
  if (cmd.kind === 'startMatch' || cmd.kind === 'advancePhase' || cmd.kind === 'setPhase' || cmd.kind === 'finishDeployment') {
    enterPhase(data, state);
  } else if (cmd.kind === 'designate') {
    const sc = ensureScript(state);
    const t = state.tokens.find((x) => x.uid === cmd.uid);
    const opp = newOpportunity(cmd.uid, undefined);
    opp.extras = t ? extrasFor(data, t) : [];
    sc.opp = opp;
  }
  // Whose Action Opportunity it is, derived HERE - off the command, the way
  // every other piece of turn bookkeeping is.
  //
  // It used to be minted inside a panel renderer, which meant it only
  // refreshed on a client that happened to be *drawing* that panel. A player
  // with the combat window or an owed Interception open therefore held a
  // stale `opp`, and every command the other player sent for the active unit
  // was refused - twice inside six seconds and the table announced it would
  // not settle. Both clients run this after every command, ours and theirs,
  // so both reach the same answer.
  if (state.round.phase === 2) opportunity(data, state);
}

export function opportunity(data: GameData, s: GameState): Opportunity | null {
  const sc = ensureScript(s);
  // A nested Extra Action Opportunity (FAQ K21) belongs to whoever was just
  // granted it, NOT to whoever the activation order says is next - the
  // re-derivation below would clobber it on the very next command.
  if (sc.opp?.extra) return sc.opp;
  const next = nextActivation(s, makeInit(data));
  if (!next) return null;
  if (sc.opp && sc.opp.uid === next.uid) return sc.opp;
  const t = s.tokens.find((x) => x.uid === next.uid);
  const fresh = newOpportunity(next.uid, next.timing);
  fresh.extras = t ? extrasFor(data, t) : [];
  sc.opp = fresh;
  return fresh;
}
