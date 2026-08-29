// The report form.
//
// Shared by freeplay and the Match Centre, and by the reference in its card
// shape. It brings its OWN shell rather than borrowing the app's, because the
// three pages do not load the same stylesheets: two of them link none at all
// and take their CSS through the bundle, and the reference imports only its own
// file. Borrowing left the reference with an unstyled dialog in the bottom-left
// corner. See report.css.
//
// The lead line is passed IN rather than derived here: both board pages already
// know how to name a seat and a phase, and duplicating that would give the two
// pages two different vocabularies for the same board.
import {
  buildBoardReport, buildReferenceReport, CATEGORY_LABEL, copyReport, manifestOf,
  reportFilename, saveReport,
  type BoardReport, type ReferenceReport, type ReportCategory, type ReportKind, type ReportSubject,
} from './report';
import './report.css';
import type { GameState } from './types';

const KINDS: { id: ReportKind; label: string }[] = [
  { id: 'stuck', label: "I'm stuck" },
  { id: 'rule', label: 'Wrong rule' },
  { id: 'display', label: 'Looks wrong' },
  { id: 'other', label: 'Something else' },
];

// Not modelled anywhere in the data, so a short honest list. The printings
// really do disagree on rules, and a "wrong stat" report without this can send
// us chasing a difference that is genuine.
const EDITIONS = ['Not sure', 'English printing', 'Chinese printing'];

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function shell(title: string, lead: string, body: string): HTMLElement {
  const dlg = document.createElement('div');
  dlg.id = 'report-dialog';
  dlg.innerHTML = `<div class="rp-panel">
    <button class="rp-close" data-rp="close" title="Close" aria-label="Close">✕</button>
    <div class="rp-title">${esc(title)}</div>
    <p class="rp-lead">${esc(lead)}</p>
    <div class="rp-body">${body}</div>
    <div class="rp-foot">
      <button data-rp="cancel">Cancel</button>
      <span class="rp-spacer"></span>
      <span class="rp-said" data-rp="said"></span>
      <button data-rp="copy">Copy</button>
      <button class="rp-primary" data-rp="save">Save report</button>
    </div>
  </div>`;
  document.body.appendChild(dlg);
  return dlg;
}

function manifestHtml(r: BoardReport | ReferenceReport): string {
  return `<div class="rp-man-head">Included with this report</div>
    <ul class="rp-man-list">${
      manifestOf(r).map((l) => `<li><span>${esc(l.what)}</span><b>${esc(l.detail)}</b></li>`).join('')
    }</ul>
    <p class="rp-man-note">Saved as <code>${esc(reportFilename(r))}</code></p>`;
}

// Both dialogs share their tail: build the report on demand, show what is in
// it, and hand it over. `make` is called fresh on every render and every click
// so the manifest can never describe a report different from the one that gets
// saved.
function wire(dlg: HTMLElement, make: () => BoardReport | ReferenceReport): void {
  const man = dlg.querySelector<HTMLElement>('.rp-manifest')!;
  const said = dlg.querySelector<HTMLElement>('[data-rp="said"]')!;
  const close = (): void => dlg.remove();

  const refresh = (): void => { man.innerHTML = manifestHtml(make()); };

  dlg.addEventListener('click', (ev) => {
    const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-rp]');
    if (!t) {
      // The backdrop, not the panel. Closing on a stray click inside a form
      // somebody has been typing into would throw the report away.
      if (ev.target === dlg) close();
      return;
    }
    const act = t.dataset.rp;
    if (act === 'close' || act === 'cancel') close();
    else if (act === 'save') { saveReport(make()); said.textContent = 'Saved.'; }
    else if (act === 'copy') {
      void copyReport(make()).then((ok) => {
        said.textContent = ok ? 'Copied.' : 'Could not copy. Use Save instead.';
      });
    }
  });

  dlg.addEventListener('input', refresh);
  dlg.addEventListener('change', refresh);
  refresh();
}

export function openBoardReport(o: {
  lead: string;
  state: GameState;
  seat: string | null;
  net?: unknown;
  boardSvg?: () => string;
}): void {
  const dlg = shell('Report a problem', o.lead, `
    <label class="rp-label">What went wrong?</label>
    <div class="rp-chips">${
      KINDS.map((k, i) => `<button class="rp-chip${i === 0 ? ' on' : ''}" data-kind="${k.id}">${esc(k.label)}</button>`).join('')
    }</div>
    <label class="rp-label" for="rp-said">Tell me what happened</label>
    <textarea id="rp-said" class="rp-area" rows="3"
      placeholder="Tried to end my turn and nothing happens."></textarea>
    ${o.boardSvg ? `<label class="rp-check"><input type="checkbox" id="rp-svg" checked> Include a picture of the board</label>` : ''}
    <div class="rp-manifest"></div>`);

  let kind: ReportKind = 'stuck';
  const chips = [...dlg.querySelectorAll<HTMLElement>('.rp-chip')];
  for (const chip of chips) {
    chip.addEventListener('click', () => {
      kind = chip.dataset.kind as ReportKind;
      for (const c of chips) c.classList.toggle('on', c === chip);
      dlg.dispatchEvent(new Event('change'));
    });
  }

  const svgBox = dlg.querySelector<HTMLInputElement>('#rp-svg');
  const area = dlg.querySelector<HTMLTextAreaElement>('#rp-said')!;

  wire(dlg, () => buildBoardReport({
    kind,
    said: area.value.trim(),
    state: o.state,
    seat: o.seat,
    net: o.net,
    boardSvg: svgBox?.checked ? o.boardSvg?.() : undefined,
    // The board from five moves back rides along only on the stuck path. That
    // is the case where the PATH is the bug and a single frozen position says
    // almost nothing; everywhere else it is 10KB nobody reads.
    includeBefore: kind === 'stuck',
  }));

  area.focus();
}

// Ordered as a reader would look for them, with the catch-all last.
const CATEGORIES: ReportCategory[] = ['card', 'keyword', 'rules', 'mission', 'box', 'faction', 'other'];

// What each category asks for instead of "what does your card say". A rule is
// not printed on a card, and asking as though it were gets a blank field.
const PRINTED_LABEL: Record<ReportCategory, string> = {
  card: 'What does your card say?',
  keyword: 'What does the printed keyword say?',
  rules: 'What does the rulebook say?',
  mission: 'What does the mission card say?',
  box: 'What does the box say?',
  faction: 'What should it say?',
  other: 'What should it say?',
};

export function openReferenceReport(o: {
  subject: ReportSubject | null;
  category: ReportCategory;
  looking: { tab: string; search: string };
  shown: Record<string, string>;
}): void {
  const dlg = shell('Something looks wrong', o.subject ? o.subject.name : `Reference · ${o.looking.tab}`, `
    <label class="rp-label" for="rp-cat">What is wrong?</label>
    <select id="rp-cat" class="rp-input">${
      CATEGORIES.map((c) => `<option value="${c}"${c === o.category ? ' selected' : ''}>${esc(CATEGORY_LABEL[c])}</option>`).join('')
    }</select>
    <div id="rp-names-row">
      <label class="rp-label" for="rp-names">Which one?</label>
      <input id="rp-names" class="rp-input" type="text" placeholder="Rule 4.15, or the name of the entry">
    </div>
    <label class="rp-label" for="rp-said">What's wrong?</label>
    <textarea id="rp-said" class="rp-area" rows="2"
      placeholder="Armour shows 4 but my card says 5."></textarea>
    <label class="rp-label" for="rp-printed"><span id="rp-printed-label"></span></label>
    <input id="rp-printed" class="rp-input" type="text" placeholder="Armour 5">
    <label class="rp-label" for="rp-edition">Which printing?</label>
    <select id="rp-edition" class="rp-input">${
      EDITIONS.map((e) => `<option>${esc(e)}</option>`).join('')
    }</select>
    <div class="rp-manifest"></div>`);

  const cat = dlg.querySelector<HTMLSelectElement>('#rp-cat')!;
  const namesRow = dlg.querySelector<HTMLElement>('#rp-names-row')!;
  const names = dlg.querySelector<HTMLInputElement>('#rp-names')!;
  const printedLabel = dlg.querySelector<HTMLElement>('#rp-printed-label')!;
  const area = dlg.querySelector<HTMLTextAreaElement>('#rp-said')!;
  const printed = dlg.querySelector<HTMLInputElement>('#rp-printed')!;
  const edition = dlg.querySelector<HTMLSelectElement>('#rp-edition')!;

  // The page already knows what it has open, so asking would be rude. But the
  // moment somebody picks a DIFFERENT category the open subject stops being the
  // thing they mean, and they have to be able to say what is.
  const chosen = (): ReportCategory => cat.value as ReportCategory;
  const subjectFits = (): boolean => !!o.subject && chosen() === o.category;
  const sync = (): void => {
    namesRow.hidden = subjectFits();
    printedLabel.textContent = PRINTED_LABEL[chosen()];
  };
  cat.addEventListener('change', sync);
  sync();

  wire(dlg, () => buildReferenceReport({
    category: chosen(),
    said: area.value.trim(),
    printed: printed.value.trim(),
    edition: edition.value,
    names: names.value.trim(),
    subject: subjectFits() ? o.subject : null,
    looking: o.looking,
    shown: subjectFits() ? o.shown : {},
  }));

  area.focus();
}
