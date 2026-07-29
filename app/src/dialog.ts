export interface DialogChoice {
  id: string;
  label: string;
  primary?: boolean;
  danger?: boolean;
  image?: string;
  disabled?: boolean;
  note?: string;
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

function open(inner: string, wire: (panel: HTMLElement, close: () => void) => void): void {
  const back = document.createElement('div');
  back.className = 'dlg-back';
  back.innerHTML = `<div class="dlg-panel" role="dialog" aria-modal="true">${inner}</div>`;
  const panel = back.querySelector<HTMLElement>('.dlg-panel')!;
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    back.remove();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return;
    ev.stopPropagation();
    ev.preventDefault();
    panel.querySelector<HTMLButtonElement>('[data-cancel]')?.click();
  };
  back.addEventListener('pointerdown', (ev) => {
    if (ev.target === back) panel.querySelector<HTMLButtonElement>('[data-cancel]')?.click();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(back);
  wire(panel, close);
  (panel.querySelector<HTMLElement>('[data-autofocus]') ?? panel.querySelector<HTMLElement>('button'))?.focus();
}

export function choiceDialog(o: ChoiceOpts): Promise<string | null> {
  return new Promise((resolve) => {
    const buttons = o.choices
      .map(
        (c, i) =>
          `<button data-id="${esc(c.id)}"${c.primary ? ' class="dlg-primary" data-autofocus' : c.danger ? ' class="dlg-danger"' : ''}${
            i === o.choices.length - 1 ? ' data-cancel' : ''
          }${c.image ? ` data-tip-img="${esc(c.image)}"` : ''}${
            c.disabled ? ` disabled title="${esc(c.note ?? '')}"` : ''
          }>${esc(c.label)}</button>`,
      )
      .join('');
    open(
      `<h3 class="dlg-title">${esc(o.title)}</h3>${bodyHtml(o)}<div class="dlg-actions${o.stacked ? ' dlg-stacked' : ''}">${buttons}</div>`,
      (panel, close) => {
        let settled = false;
        panel.querySelectorAll<HTMLButtonElement>('.dlg-actions button').forEach((b) =>
          b.addEventListener('click', () => {
            if (settled) return;
            settled = true;
            close();
            resolve(b.dataset.id ?? null);
          }),
        );
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
      { id: 'cancel', label: o.cancelLabel ?? 'Cancel' },
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
