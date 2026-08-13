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
import { choiceDialog } from './dialog';
import { commandIssuers, heldCommands, readyCommands } from './commands';
import { cardName } from './data';
import type { GameData } from './data';
import { alive } from './loop';
import type { GameState, Side, Token } from './types';
import { tokenCards } from './units';

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
