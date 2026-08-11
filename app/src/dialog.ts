export interface DialogChoice {
  id: string;
  label: string;
  primary?: boolean;
  danger?: boolean;
  image?: string;
  disabled?: boolean;
  note?: string;
  // What Escape and a backdrop click select. Without one they select NOTHING
  // and the dialog resolves null - see the note on `open`.
  cancel?: boolean;
}

interface BaseOpts {
  title: string;
  body?: string;
  list?: string[];
  image?: string;
}

interface ChoiceOpts extends BaseOpts {
  choices: DialogChoice[];
  stacked?: boolean;
}

interface PromptOpts extends BaseOpts {
  value?: string;
  placeholder?: string;
  confirmLabel?: string;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function bodyHtml(o: BaseOpts): string {
  const text = o.body ? `<p class="dlg-body">${esc(o.body).replace(/\n/g, '<br>')}</p>` : '';
  const list = o.list?.length
    ? `<ul class="dlg-list">${o.list.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`
    : '';
  const art = o.image ? `<img class="dlg-art" src="${esc(o.image)}" alt="">` : '';
  return art + text + list;
}

// Escape and a backdrop click both select the `[data-cancel]` button, and that
// marker is now DELIBERATE rather than positional. It used to be stamped on the
// last choice whatever that was, so every picker built as a bare list of
// targets carried a silent "choose the last one" hotkey - press Escape over a
// Prototype Blink target list and the Taurus teleported into whichever unit
// happened to sort last. A dialog with nothing marked closes and resolves null,
// which every caller already treats as "no choice made".
function open(inner: string, wire: (panel: HTMLElement, close: () => void) => void, bail?: () => void): void {
  const back = document.createElement('div');
  back.className = 'dlg-back';
  back.innerHTML = `<div class="dlg-panel" role="dialog" aria-modal="true">${inner}</div>`;
  const panel = back.querySelector<HTMLElement>('.dlg-panel')!;
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    back.remove();
  };
  const dismiss = () => {
    const btn = panel.querySelector<HTMLButtonElement>('[data-cancel]');
    if (btn) { btn.click(); return; }
    close();
    bail?.();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return;
    ev.stopPropagation();
    ev.preventDefault();
    dismiss();
  };
  back.addEventListener('pointerdown', (ev) => {
    if (ev.target === back) dismiss();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(back);
  wire(panel, close);
  (panel.querySelector<HTMLElement>('[data-autofocus]') ?? panel.querySelector<HTMLElement>('button'))?.focus();
}

export function choiceDialog(o: ChoiceOpts): Promise<string | null> {
  return new Promise((resolve) => {
    // A single choice IS its own dismissal - an alert's "Got it" has nothing
    // else it could mean - so it is marked automatically. Anything longer must
    // say which choice is the safe one, or Escape simply resolves null.
    const soleChoice = o.choices.length === 1;
    const buttons = o.choices
      .map(
        (c) =>
          `<button data-id="${esc(c.id)}"${c.primary ? ' class="dlg-primary" data-autofocus' : c.danger ? ' class="dlg-danger"' : ''}${
            c.cancel || soleChoice ? ' data-cancel' : ''
          }${c.image ? ` data-tip-img="${esc(c.image)}"` : ''}${
            c.disabled ? ` disabled title="${esc(c.note ?? '')}"` : ''
          }>${esc(c.label)}</button>`,
      )
      .join('');
    let settled = false;
    open(
      `<h3 class="dlg-title">${esc(o.title)}</h3>${bodyHtml(o)}<div class="dlg-actions${o.stacked ? ' dlg-stacked' : ''}">${buttons}</div>`,
      (panel, close) => {
        panel.querySelectorAll<HTMLButtonElement>('.dlg-actions button').forEach((b) =>
          b.addEventListener('click', () => {
            if (settled) return;
            settled = true;
            close();
            resolve(b.dataset.id ?? null);
          }),
        );
      },
      () => {
        if (settled) return;
        settled = true;
        resolve(null);
      },
    );
  });
}

export async function confirmDialog(o: BaseOpts & {
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  const id = await choiceDialog({
    ...o,
    choices: [
      { id: 'ok', label: o.confirmLabel ?? 'OK', primary: !o.danger, danger: o.danger },
      // Escape on a confirmation means "no", which is what it always meant -
      // now said outright rather than inherited from being last.
      { id: 'cancel', label: o.cancelLabel ?? 'Cancel', cancel: true },
    ],
  });
  return id === 'ok';
}

export function alertDialog(o: BaseOpts & { closeLabel?: string }): Promise<void> {
  return choiceDialog({ ...o, choices: [{ id: 'ok', label: o.closeLabel ?? 'Got it', primary: true }] }).then(
    () => undefined,
  );
}

export function promptDialog(o: PromptOpts): Promise<string | null> {
  return new Promise((resolve) => {
    open(
      `<h3 class="dlg-title">${esc(o.title)}</h3>${bodyHtml(o)}
       <input class="dlg-input" type="text" data-autofocus value="${esc(o.value ?? '')}"
              placeholder="${esc(o.placeholder ?? '')}" />
       <div class="dlg-actions">
         <button class="dlg-primary" data-ok>${esc(o.confirmLabel ?? 'Save')}</button>
         <button data-cancel>Cancel</button>
       </div>`,
      (panel, close) => {
        const input = panel.querySelector<HTMLInputElement>('.dlg-input')!;
        let settled = false;
        const done = (val: string | null) => {
          if (settled) return;
          settled = true;
          close();
          resolve(val);
        };
        const submit = () => done(input.value.trim());
        panel.querySelector<HTMLButtonElement>('[data-ok]')!.addEventListener('click', submit);
        panel.querySelector<HTMLButtonElement>('[data-cancel]')!.addEventListener('click', () => done(null));
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') submit();
        });
        input.select();
      },
    );
  });
}
