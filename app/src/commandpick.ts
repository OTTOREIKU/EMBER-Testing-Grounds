// Step 1 of issuing a Command (rulebook 4.15.2): which Mech pays.
//
// The procedure is select a Mech, select a Drone, then move that Mech's token
// onto the Drone's card face-down. Our drivers only ever asked for the Drone
// and let the command layer pick the Mech, which gets the right arithmetic and
// teaches the wrong thing - on the table you physically take the token off a
// particular Torso, and with a Command Generation 4 Mech beside a plain one
// that choice is the interesting part of the phase.
//
// Both the play guide and the Match Centre ask the same question, so it lives
// here rather than twice. The prompt is skipped when there is nothing to
// decide: one Mech able to pay, or a free Command from Additional Instructions
// (FAQ O14), which spends no token at all.
import { alertDialog, choiceDialog } from './dialog';
import { asterKey, commandIssuers, heldCommands, readyCommands } from './commands';
import { cardName } from './data';
import type { GameData } from './data';
import { alive } from './loop';
import { PHASES } from './types';
import type { GameState, Side, Token } from './types';
import { maxLink, tokenCards } from './units';
import { inContact } from './rules';

// The Torso is what actually carries the tokens (3.2.1), and naming it is how a
// player recognises which Mech generates four - the card is the thing with the
// Command Generation keyword printed on it.
function torsoName(data: GameData, t: Token): string | null {
  const torso = tokenCards(data, t).find((x) => x.slot === 'torso');
  return torso ? cardName(torso.card) : null;
}

export type IssuerChoice = { uid: number } | 'cancelled';

export async function askIssuer(
  data: GameData,
  state: GameState,
  side: Side,
  drone: Token,
  free: boolean,
): Promise<IssuerChoice> {
  // A free Command comes off a card, not off a Torso, so there is no Mech to
  // choose and nothing to take.
  if (free) return { uid: 0 };
  const able = commandIssuers(state, side);
  if (!able.length) return { uid: 0 };
  // Nothing to decide. Asking anyway would turn every Command in an RDL or UN
  // game - one Mech, one token - into an extra click for no information.
  if (able.length === 1) return { uid: able[0].uid };

  const picked = await choiceDialog({
    title: `Which Mech commands ${drone.label}?`,
    body:
      'Take the Command Token from that Mech and lay it on the Drone face-down (4.15.2). '
      + 'Tokens you hold back can be spent later in the round.',
    stacked: true,
    choices: [
      ...able.map((m) => {
        const torso = torsoName(data, m);
        const n = readyCommands(m);
        return {
          id: String(m.uid),
          label: `${m.label} · ${n} Command${n === 1 ? '' : 's'}${torso ? ` · ${torso}` : ''}`,
        };
      }),
      { id: 'cancel', label: 'Back', cancel: true },
    ],
  });
  // Escape and Back both mean "I have not chosen a Mech yet", which must NOT
  // fall through to issuing the Command off whichever Mech the engine likes.
  if (picked === null || picked === 'cancel') return 'cancelled';
  return { uid: Number(picked) };
}

// ZPA-36 Aster: "Once per round, during the Command Phase, may consume 1
// Command Token to restore 1 Link to an Ally Mech." The pilot check, the
// once-per-round ledger and the token spend all live in the asterRestore
// command; this owns the two questions around it — why the button is grey, and
// which Ally takes the Link — so the guide and the Match Centre ask them
// identically.
export function asterBlockers(state: GameState, t: Token): string | null {
  const sc = state.script;
  if (sc?.oncePerRound?.includes(asterKey(state, t.uid))) return 'Aster has already restored Link this round.';
  if (readyCommands(t) <= 0) return `${t.label} has no face-up Command Token to consume.`;
  return null;
}

export async function runAster(
  data: GameData,
  state: GameState,
  mechUid: number,
  send: (targetUid: number) => void,
  note: (to: Token, text: string) => void,
): Promise<void> {
  const from = state.tokens.find((x) => x.uid === mechUid);
  if (!from) return;
  // Any Ally Mech below full Link, Aster's own included — the card says "an
  // Ally Mech" and a squad's own Mech is its ally.
  const able = state.tokens.filter(
    (t) => t.side === from.side && t.kind === 'mech' && alive(t) && (t.link ?? 0) < maxLink(data, t),
  );
  if (!able.length) {
    await alertDialog({
      title: 'Nothing to restore',
      body: 'Every Mech in the squad is already at full Link, so consuming the Command Token would do nothing.',
    });
    return;
  }
  const picked = able.length === 1
    ? String(able[0].uid)
    : await choiceDialog({
      title: `${from.label} restores 1 Link`,
      body: 'Aster consumes 1 Command Token to restore 1 Link to an Ally Mech. Once per round.',
      stacked: true,
      choices: [
        ...able.map((t) => ({ id: String(t.uid), label: `${t.label} · Link ${t.link ?? 0}/${maxLink(data, t)}` })),
        { id: 'cancel', label: 'Back', cancel: true },
      ],
    });
  if (picked === null || picked === 'cancel') return;
  send(Number(picked));
  const to = state.tokens.find((x) => x.uid === Number(picked));
  if (to) note(to, `${from.label} (Aster) consumes a Command Token to restore 1 Link to ${to.label}. Once per round.`);
}

// ZHDR-304 Harpy: "When performing a Command Movement, may consume 1
// additional Command Token and -1 Movement to drag 1 adjacent Ally Unit."
// (GoF 1.021 parts list. This used to read -2 and "Ally Mech or Ally Drone"
// from an English card scan; the list is the newer authority and it prints -1
// and the broader Unit, so any adjacent ally the Harpy touches can be towed.)
//
// WHOSE token: the Harpy is a Drone, and 4.15.4 requires a MECH to bear the
// face-up token, so "1 additional" is read as one more from the squad's Mechs —
// the Harpy is already wearing the face-down one that commanded it, and 4.15.2
// caps a Drone at one. If the publisher rules otherwise this is the line to
// change.
//
// Asked BEFORE the route is drawn, because the -1 comes out of the Movement
// allowance — offering it afterwards would show the player a reach they cannot
// have. The caller subtracts the 1 and executes the drag when the move settles.
export async function offerHarpyDrag(
  data: GameData,
  state: GameState,
  t: Token,
  steps: number,
): Promise<{ allyUid: number; funderUid: number } | null | 'cancelled'> {
  void data;
  if (t.cardId !== 'ZHDR-304' || steps <= 1) return null;
  // "When performing a COMMAND Movement": in a guided game that is the Command
  // Phase's move — an Automatic Phase move is the Drone acting on its own and
  // gets no drag. The freeplay sandbox with no game running stays permissive.
  if (state.script && PHASES[state.round.phase] !== 'Command') return null;
  const funders = state.tokens.filter(
    (m) => m.side === t.side && m.kind === 'mech' && m.deployed !== false && readyCommands(m) > 0,
  );
  // "1 adjacent Ally Unit" — the list does not narrow it to Mechs and Drones,
  // so a deployed Projectile or Deployable in Contact can be towed as well.
  const allies = state.tokens.filter(
    (o) => o.uid !== t.uid && o.side === t.side
      && o.deployed !== false && inContact(t, o),
  );
  if (!funders.length || !allies.length) return null;
  const picked = await choiceDialog({
    title: `${t.label} may drag an Ally`,
    body:
      `Consume 1 additional Command Token from ${funders[0].label} and -1 Movement (${steps} → ${steps - 1}) `
      + 'to drag 1 adjacent Ally Unit along with this move.',
    stacked: true,
    choices: [
      ...allies.map((o) => ({ id: String(o.uid), label: `Drag ${o.label}` })),
      { id: 'no', label: 'Move normally', cancel: true },
    ],
  });
  if (picked === null || picked === 'no') return null;
  return { allyUid: Number(picked), funderUid: funders[0].uid };
}

// Command Coordination X (4.15.3): after the Action carrying the keyword, this
// Mech may hand out up to X of the Command Tokens it held back - one each, to X
// DIFFERENT Drones, face-down - and each of those Drones then performs 1
// Movement Action or 1 Command Action.
//
// Asked one Drone at a time so a player can stop early: X is a ceiling, not a
// cost, and 4.15.2 is explicit that tokens may be kept back for something else.
// Shared by both drivers, which differ only in how a command reaches the board.
export async function offerCoordination(
  data: GameData,
  state: GameState,
  mech: Token,
  upTo: number,
  issue: (mechUid: number, droneUid: number) => void,
  note?: (drone: Token, text: string) => void,
): Promise<void> {
  void data;
  for (let i = 0; i < upTo; i++) {
    const left = readyCommands(mech);
    if (left <= 0) return;
    // A Drone already bearing a token cannot take a second (4.15.2). The
    // Command Phase's tokens were removed when it ended, which is exactly why a
    // Drone that already acted this round is eligible here.
    const able = state.tokens.filter(
      (d) => d.side === mech.side && d.kind === 'drone' && alive(d) && d.deployed !== false && heldCommands(d) === 0,
    );
    if (!able.length) return;
    const rounds = upTo - i;
    const picked = await choiceDialog({
      title: `${mech.label} may command a Drone`,
      body:
        `Command Coordination lets ${mech.label} send ${rounds === 1 ? 'a Command' : `up to ${rounds} more Commands`} now (4.15.3). `
        + 'The Drone that takes one performs 1 Movement Action or 1 Command Action. '
        + `${left} Command Token${left === 1 ? '' : 's'} left on this Mech.`,
      stacked: true,
      choices: [
        ...able.map((d) => ({ id: String(d.uid), label: d.label })),
        { id: 'stop', label: 'Keep the rest', cancel: true },
      ],
    });
    if (picked === null || picked === 'stop') return;
    issue(mech.uid, Number(picked));
    const drone = state.tokens.find((x) => x.uid === Number(picked));
    if (drone && note) {
      note(drone, `${mech.label} commands ${drone.label} (Command Coordination, 4.15.3). It may Move or take 1 Command Action.`);
    }
  }
}
