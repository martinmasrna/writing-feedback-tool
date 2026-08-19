/**
 * One dialog serving two jobs:
 *
 *  - the deliberate annotation forms behind the floating toolbar, and
 *  - the "why did you do that?" prompt that appears once a typed edit settles.
 *
 * The reason field comes first and holds focus in every variant: reasons are the
 * point of the tool, so they are never the afterthought field at the bottom.
 */

import { KINDS } from '../criticmarkup.js';

const FORMS = {
  sub: { title: 'Replace', textLabel: 'Replacement text', reasonLabel: 'Reason', needsText: true },
  del: { title: 'Delete', textLabel: null, reasonLabel: 'Reason' },
  hl: { title: 'Comment', textLabel: null, reasonLabel: 'Comment' },
};

const truncate = (s, n) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export function createDialog(refs, { onAnnotate, onReason, onDismiss }) {
  let mode = null;      // 'sub' | 'del' | 'hl' | 'reason'
  let context = null;   // {selection} for forms, {annotation, returnCaret} for the prompt

  function place(rect) {
    const w = refs.dialog.offsetWidth;
    const h = refs.dialog.offsetHeight;
    let x = rect.left + rect.width / 2 - w / 2;
    let y = rect.bottom + 10;
    if (y + h > window.innerHeight - 12) y = Math.max(56, rect.top - h - 10);
    if (y + h > window.innerHeight - 12) y = Math.max(56, (window.innerHeight - h) / 2);
    x = Math.max(12, Math.min(x, window.innerWidth - w - 12));
    refs.dialog.style.left = `${Math.round(x)}px`;
    refs.dialog.style.top = `${Math.round(y)}px`;
  }

  function open(rect, bare) {
    refs.scrim.hidden = false;
    refs.scrim.classList.toggle('bare', !!bare);
    refs.dialog.hidden = false;
    place(rect || { left: window.innerWidth / 2, top: 200, bottom: 220, width: 0, height: 0 });
    refs.reason.focus();
  }

  function close() {
    mode = null;
    context = null;
    refs.dialog.hidden = true;
    refs.scrim.hidden = true;
  }

  function submit() {
    if (mode === 'reason') {
      const { annotation, returnCaret } = context;
      const value = refs.reason.value;
      close();
      onReason(annotation, value, returnCaret);
      return;
    }
    if (!mode) return;
    const form = FORMS[mode];
    const text = refs.text.value;
    if (form.needsText && !text.trim()) {
      refs.text.focus();
      onAnnotate(null, 'Enter replacement text — or use Delete to remove the selection.');
      return;
    }
    const kind = mode;
    const { selection } = context;
    const reason = refs.reason.value;
    close();
    onAnnotate({ kind, selection, text, reason });
  }

  function dismiss() {
    const wasReason = mode === 'reason';
    const returnCaret = context && context.returnCaret;
    close();
    onDismiss(wasReason ? returnCaret : null);
  }

  refs.apply.addEventListener('click', submit);
  refs.close.addEventListener('click', dismiss);
  refs.scrim.addEventListener('mousedown', dismiss);
  refs.dialog.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); dismiss(); }
    else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });

  return {
    get open() { return mode !== null; },
    close,

    /** The deliberate annotation forms. */
    openForm(kind, selection, sourceText, rect) {
      const form = FORMS[kind];
      if (!form) return;
      mode = kind;
      context = { selection };

      refs.title.textContent = form.title;
      refs.reasonLabel.textContent = form.reasonLabel;
      refs.reasonOpt.textContent = kind === 'hl' ? '' : 'optional';
      refs.hint.textContent = 'Enter applies · ⇧Enter newline';
      refs.apply.textContent = 'Apply';
      refs.ctx.className = 'dlg-ctx';
      refs.ctx.textContent = truncate(sourceText.slice(selection.start, selection.end), 260);
      refs.textRow.style.display = form.textLabel ? 'block' : 'none';
      if (form.textLabel) refs.textLabel.textContent = form.textLabel;
      refs.text.value = '';
      refs.reason.value = '';
      refs.reason.placeholder = kind === 'hl' ? 'What should the author know?' : 'Why this edit?';
      open(rect, false);
    },

    /** The prompt that fires once a typed edit settles. */
    openReasonPrompt(annotation, returnCaret, rect) {
      mode = 'reason';
      context = { annotation, returnCaret };

      refs.title.textContent = `Why this ${KINDS[annotation.type].label.toLowerCase()}?`;
      refs.reasonLabel.textContent = 'Reason';
      refs.reasonOpt.textContent = '';
      refs.hint.textContent = 'Enter attaches · Esc skips';
      refs.apply.textContent = 'Attach reason';
      refs.textRow.style.display = 'none';
      refs.text.value = '';
      refs.reason.value = annotation.reason ? annotation.reason.trim() : '';
      refs.reason.placeholder = 'Why this edit?';

      refs.ctx.className = 'dlg-ctx';
      refs.ctx.textContent = '';
      const add = (tag, text) => {
        const n = document.createElement(tag);
        n.textContent = text;
        refs.ctx.append(n);
      };
      if (annotation.type === 'sub') {
        add('del', truncate(annotation.a, 70));
        add('span', ' → ');
        add('ins', truncate(annotation.b, 70));
      } else if (annotation.type === 'ins') add('ins', truncate(annotation.a, 140));
      else if (annotation.type === 'del') add('del', truncate(annotation.a, 140));
      else refs.ctx.textContent = truncate(annotation.a, 140);

      open(rect, true);
    },
  };
}
