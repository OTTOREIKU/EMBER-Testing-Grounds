// Sending a problem report to the site's server (POST /reports).
//
// OTTO, 2026-11-05: "People probably assume it logs it automatically and have
// never sent me any reports. We should set this reporting system up to auto
// log and store for me." Before this the dialog could only save a file.
//
// Its own module so report.ts, which builds what is sent, never reaches for
// anything on the credential path (tests/report.test.mjs holds it to that).
// The only thing taken from here is the CSRF token, and only so the server can
// put the signed-in account's name on the report for a follow-up question.
import { apiBaseFor } from './api';
import { reportText, type BoardReport, type ReferenceReport } from './report';

// The API refuses a body over 256kb. A board report is about 8KB, but its
// picture of the board can be most of that ceiling on its own, so a report
// that will not fit sheds the picture first and then the board from before.
const SEND_LIMIT = 240_000;

export function fitForSending(r: BoardReport | ReferenceReport): BoardReport | ReferenceReport {
  if (reportText(r).length <= SEND_LIMIT || r.type !== 'board') return r;
  const slim: BoardReport = { ...r, boardSvg: undefined };
  if (reportText(slim).length <= SEND_LIMIT) return slim;
  return { ...slim, before: null };
}

// The CSRF cookie is there only when someone is signed in. Sending it lets the
// server put the account on the report, so a follow-up can be asked; without
// it the report still goes, unnamed.
function csrfToken(): string | null {
  for (const part of document.cookie.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === 'ember_csrf') return rest.join('=');
  }
  return null;
}

export type SendResult = { ok: true; id: number } | { ok: false; why: string };

export async function sendReport(r: BoardReport | ReferenceReport): Promise<SendResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = csrfToken();
  if (token) headers['X-CSRF-Token'] = token;
  let res: Response;
  try {
    res = await fetch(`${apiBaseFor(location.hostname, location.protocol)}/reports`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: reportText(fitForSending(r)),
    });
  } catch {
    return { ok: false, why: 'Could not reach the server. Save it as a file instead.' };
  }
  let body: { id?: number; error?: string } = {};
  try { body = await res.json(); } catch { /* not json */ }
  if (!res.ok) return { ok: false, why: body.error ?? 'The server did not take it. Save it as a file instead.' };
  return { ok: true, id: Number(body.id) };
}
