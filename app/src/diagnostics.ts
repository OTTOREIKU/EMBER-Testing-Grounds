// The app's black box.
//
// Before this, NOTHING caught an uncaught error. An exception thrown partway
// through a command went to the console and nowhere else, so the player saw a
// board that had stopped responding and could report only that it froze --
// which is exactly the report nobody can act on.
//
// Two short rings, each entry stamped with the command that was in flight when
// it landed. That is the whole trick: "TypeError in resolveAttack, while
// applying maneuver" is a bug report; "it froze" is not.
//
// This file imports NOTHING. Installing the net that catches failures must not
// itself be able to fail, and a ring with no dependencies cannot be broken by
// anything it is watching.

const LIMIT = 20;

// A stack trace can run to tens of kilobytes through a bundler's frames, and
// the top of one is where the answer lives. The rest is the framework.
const STACK_CAP = 1500;

export interface DiagEntry {
  // Wall clock, because a report is read by a person days later.
  at: string;
  what: string;
  stack?: string;
  where?: string;
  // The command being applied when this landed, if any. The single most useful
  // field in the ring.
  during?: string;
}

let errors: DiagEntry[] = [];
let refusals: DiagEntry[] = [];
let inFlight: string | null = null;
let installed = false;

function push(ring: DiagEntry[], entry: DiagEntry): void {
  ring.push(entry);
  if (ring.length > LIMIT) ring.shift();
}

function trim(stack: unknown): string | undefined {
  if (typeof stack !== 'string' || !stack) return undefined;
  return stack.length > STACK_CAP ? `${stack.slice(0, STACK_CAP)}\n… truncated` : stack;
}

// What perform() is currently applying. Set from the onBeforeApply seam the
// history already uses, and SELF-EXPIRING: apply() runs synchronously in the
// same task, and an exception it throws reaches the window's error event
// before that task's microtasks run -- so clearing in a microtask attributes
// exactly the errors the command caused and nothing later. Nobody has to
// remember a matching clear call, which is how the first version ended up
// blaming idle-time errors on whatever command happened to run last.
//
// Async work a command starts loses attribution on purpose. A rejection that
// lands minutes later MIGHT be the command's fault, and "might" written into
// a bug report reads as "is".
export function noteCommand(kind: string | null): void {
  inFlight = kind;
  if (kind === null) return;
  queueMicrotask(() => {
    if (inFlight === kind) inFlight = null;
  });
}

export function noteRefusal(why: string): void {
  push(refusals, { at: new Date().toISOString(), what: why, during: inFlight ?? undefined });
}

export function noteError(what: string, o: { stack?: unknown; where?: string } = {}): void {
  push(errors, {
    at: new Date().toISOString(),
    what,
    stack: trim(o.stack),
    where: o.where,
    during: inFlight ?? undefined,
  });
}

// Declared as a METHOD rather than a property so its parameters compare
// bivariantly, which is what lets the real `window` and a test double satisfy
// the same shape.
export interface DiagTarget {
  addEventListener(type: string, listener: EventListener, options?: boolean): void;
}

export function installDiagnostics(target: DiagTarget): void {
  // Idempotent: a second install would double every entry, and both board
  // pages plus the reference each call it on load.
  if (installed) return;
  installed = true;

  // Capture phase, or an error inside a listener that stops propagation never
  // reaches us.
  target.addEventListener('error', (ev) => {
    try {
      const e = ev as ErrorEvent;
      // A failed <img> fires 'error' at the window too, and carries NO message.
      // Those are missing art, not broken code -- the app already handles them
      // at each <img>, and on a page of card portraits they would flush a ring
      // of twenty in seconds and bury the real failure.
      if (!e.message) return;
      noteError(e.message, {
        stack: e.error?.stack,
        where: e.filename ? `${e.filename}:${e.lineno ?? 0}:${e.colno ?? 0}` : undefined,
      });
    } catch { /* the black box must never be the thing that breaks */ }
  }, true);

  target.addEventListener('unhandledrejection', (ev) => {
    try {
      const r = (ev as PromiseRejectionEvent).reason as { message?: string; stack?: string } | string | undefined;
      const what = typeof r === 'string' ? r : r?.message;
      noteError(what ? `Unhandled: ${what}` : 'Unhandled promise rejection', {
        stack: typeof r === 'object' ? r?.stack : undefined,
      });
    } catch { /* as above */ }
  });
}

export function diagErrors(): DiagEntry[] {
  return errors.slice();
}

export function diagRefusals(): DiagEntry[] {
  return refusals.slice();
}

export function diagInFlight(): string | null {
  return inFlight;
}

// Tests only. The rings are deliberately process-wide otherwise: a report wants
// what happened across the whole session, not since the dialog opened.
export function clearDiagnostics(): void {
  errors = [];
  refusals = [];
  inFlight = null;
  installed = false;
}
