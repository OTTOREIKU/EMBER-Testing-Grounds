// What a player sends when something is wrong.
//
// The design principle, from the draft: THE FORM IS THE LEAST VALUABLE HALF.
// A player who hits a deadlock cannot describe it -- they can say "I couldn't
// end my turn", which narrows nothing. What makes a report worth having is the
// board itself, 2KB of JSON that migrateState reads straight back, so the exact
// stuck position can be opened and driven. Everything here exists to get that
// across intact, with enough context to say which build and which move.
//
// Local only for now: the report is a file the player saves and hands over.
// Nothing here talks to a server, which is also why it works offline.
import { diagErrors, diagRefusals, type DiagEntry } from './diagnostics';
import { historyEntries, snapshotBack } from './history';
import type { GameState } from './types';

declare const __BUILD_ID__: string;

// How far back the "before it broke" board comes from. Five, so a report on a
// deadlock carries the position a few moves BEFORE the deadlock and the moves
// since -- which turns "here is a stuck board" into "here is how it got stuck".
export const SNAPSHOT_BACK = 5;

// Labels only. The history ring holds 160 WHOLE BOARDS; serialising those would
// turn an 8KB report into several megabytes.
const RECENT = 20;

export type ReportKind = 'stuck' | 'rule' | 'display' | 'other';

// What a reference report is ABOUT. Cards were the first case and for a while
// the only one, which made the report useless for a keyword, a Box, a faction
// or -- the one with no detail sheet at all to open -- a rule.
export type ReportCategory = 'card' | 'keyword' | 'rules' | 'mission' | 'box' | 'faction' | 'other';

export interface ReportEnvelope {
  v: 1;
  type: 'board' | 'reference';
  at: string;
  build: string;
  page: string;
  viewport: string;
  browser: string;
}

export interface BoardReport extends ReportEnvelope {
  type: 'board';
  kind: ReportKind;
  said: string;
  where: { round: number; phase: number; seat: string | null; inPlay: boolean };
  state: unknown;
  before?: { movesBack: number; seq: number; state: unknown } | null;
  recent: ReturnType<typeof historyEntries>;
  errors: DiagEntry[];
  refusals: DiagEntry[];
  net?: unknown;
  boardSvg?: string;
}

// Whatever the reference had open. `kind` is the detail sheet's own vocabulary,
// so a report names the same thing the page does.
export interface ReportSubject {
  kind: string;
  key: string;
  name: string;
}

export interface ReferenceReport extends ReportEnvelope {
  type: 'reference';
  category: ReportCategory;
  said: string;
  printed: string;
  edition: string;
  // Filled in when the page had something open. Null for a rule, which has no
  // sheet to open, and then `names` carries what the player typed instead.
  subject: ReportSubject | null;
  names: string;
  // The tab and the search box. A rules report has no subject, so this is often
  // the only thing narrowing it down -- and somebody who searched "Overwatch"
  // and then reported a rule has told us more than they realise.
  looking: { tab: string; search: string };
  shown: Record<string, string>;
}

function envelope(type: 'board' | 'reference'): ReportEnvelope {
  return {
    v: 1,
    type,
    at: new Date().toISOString(),
    build: typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev',
    page: location.pathname + location.hash,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    // The UA string and nothing else. No fingerprinting, no plugin list -- the
    // only question a report needs to answer is "which browser was this".
    browser: navigator.userAgent,
  };
}

export function buildBoardReport(o: {
  kind: ReportKind;
  said: string;
  state: GameState;
  seat: string | null;
  net?: unknown;
  boardSvg?: string;
  includeBefore: boolean;
}): BoardReport {
  const back = o.includeBefore ? snapshotBack(SNAPSHOT_BACK - 1) : null;
  return {
    ...envelope('board'),
    type: 'board',
    kind: o.kind,
    said: o.said,
    where: {
      round: o.state.round?.n ?? 0,
      phase: o.state.round?.phase ?? 0,
      seat: o.seat,
      inPlay: (o.state.setup?.stage ?? 'done') === 'done',
    },
    // Parsed rather than passed by reference, so the report is a frozen copy
    // and cannot be changed by the board carrying on underneath it.
    state: JSON.parse(JSON.stringify(o.state)),
    before: back ? { movesBack: SNAPSHOT_BACK, seq: back.seq, state: JSON.parse(back.json) } : null,
    recent: historyEntries().slice(-RECENT),
    errors: diagErrors(),
    refusals: diagRefusals(),
    net: o.net ?? null,
    boardSvg: o.boardSvg,
  };
}

export function buildReferenceReport(o: {
  category: ReportCategory;
  said: string;
  printed: string;
  edition: string;
  names: string;
  subject: ReportSubject | null;
  looking: { tab: string; search: string };
  shown: Record<string, string>;
}): ReferenceReport {
  return {
    ...envelope('reference'),
    type: 'reference',
    category: o.category,
    said: o.said,
    printed: o.printed,
    edition: o.edition,
    names: o.names,
    subject: o.subject,
    looking: o.looking,
    shown: o.shown,
  };
}

// ---------- what a person is told is in the box ----------

export interface ManifestLine { what: string; detail: string }

const kb = (v: unknown): string => {
  const n = JSON.stringify(v ?? null).length;
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
};

// Plain words, not field names. Somebody deciding whether to send this should
// be able to read the list without knowing how the app is built.
export function manifestOf(r: BoardReport | ReferenceReport): ManifestLine[] {
  const out: ManifestLine[] = [];
  if (r.type === 'board') {
    out.push({ what: 'The board right now', detail: kb(r.state) });
    if (r.before) out.push({ what: `The board ${r.before.movesBack} moves ago`, detail: kb(r.before.state) });
    out.push({ what: 'Your recent moves', detail: `${r.recent.length} listed` });
    out.push({ what: 'Errors the app hit', detail: r.errors.length ? `${r.errors.length} found` : 'none' });
    out.push({ what: 'Things the rules refused', detail: r.refusals.length ? `${r.refusals.length} found` : 'none' });
    const net = r.net as { room?: string | null; desynced?: boolean } | null;
    out.push({
      what: 'Multiplayer room',
      detail: net?.room ? `${net.room} · ${net.desynced ? 'out of sync' : 'in sync'}` : 'not in a room',
    });
    if (r.boardSvg) out.push({ what: 'A picture of the board', detail: kb(r.boardSvg) });
  } else {
    out.push({ what: 'About', detail: CATEGORY_LABEL[r.category] });
    out.push({
      what: 'Which one',
      detail: r.subject ? r.subject.name : (r.names.trim() || 'you have not said yet'),
    });
    if (Object.keys(r.shown).length) {
      out.push({ what: 'What we show for it', detail: `${Object.keys(r.shown).length} fields` });
    }
    out.push({ what: 'Where you were', detail: r.looking.search
      ? `${r.looking.tab}, searching "${r.looking.search}"`
      : r.looking.tab });
  }
  out.push({ what: 'App version', detail: r.build });
  return out;
}

// ---------- getting it out ----------

export const CATEGORY_LABEL: Record<ReportCategory, string> = {
  card: 'A card',
  keyword: 'A keyword',
  rules: 'A rule',
  mission: 'A mission',
  box: 'A box',
  faction: 'A faction',
  other: 'Something else',
};

export function reportFilename(r: BoardReport | ReferenceReport): string {
  // Colons are illegal in a Windows filename, and the ISO stamp is full of
  // them. Seconds are plenty for telling two reports apart.
  const stamp = r.at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `ember-report-${r.type}-${stamp}.json`;
}

export function reportText(r: BoardReport | ReferenceReport): string {
  return JSON.stringify(r, null, 2);
}

export function saveReport(r: BoardReport | ReferenceReport): void {
  const blob = new Blob([reportText(r)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = reportFilename(r);
  a.click();
  // Revoked on the next tick rather than immediately: Safari has not finished
  // reading the blob when click() returns, and a revoked URL saves nothing.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function copyReport(r: BoardReport | ReferenceReport): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(reportText(r));
    return true;
  } catch {
    return false;
  }
}
