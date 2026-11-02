// DOM layer. Builds the widget inside a closed-off Shadow DOM and exposes a small
// imperative API to the controller in index.js. No framework, no innerHTML from user input.
import { buildStyles } from './styles.js';
import { renderMarkdown, escapeHtml } from './markdown.js';

const CHAT_ICON =
  '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5h16v10H8l-4 4V5z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';

export function createUi(config, handlers) {
  const hostEl = document.createElement('div');
  hostEl.setAttribute('data-fis-copilot', '');
  const mount = config.container ? resolveEl(config.container) : document.body;
  mount.appendChild(hostEl);

  const shadow = hostEl.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = buildStyles(config.theme);
  shadow.appendChild(style);

  const root = el('div', { class: `root pos-${config.position === 'bottom-left' ? 'bl' : 'br'}` });
  if (config.container) root.classList.add('inline', 'open');
  if (config.colorScheme && config.colorScheme !== 'auto') root.setAttribute('data-theme', config.colorScheme);
  shadow.appendChild(root);

  const launcher = el('button', { class: 'launcher', type: 'button', 'aria-label': `Open ${config.title}`, 'aria-expanded': 'false' });
  launcher.innerHTML = CHAT_ICON;
  root.appendChild(launcher);

  const panel = el('section', { class: 'panel', role: 'dialog', 'aria-label': config.title });
  root.appendChild(panel);

  const header = el('header');
  const titleWrap = el('div', { style: 'flex:1' });
  titleWrap.appendChild(el('div', { class: 'title' }, config.title));
  if (config.subtitle) titleWrap.appendChild(el('div', { class: 'sub' }, config.subtitle));
  header.appendChild(titleWrap);
  const resetBtn = el('button', { class: 'icon-btn', type: 'button', title: 'New conversation', 'aria-label': 'New conversation' }, '↻');
  header.appendChild(resetBtn);
  const closeBtn = el('button', { class: 'icon-btn', type: 'button', title: 'Close', 'aria-label': 'Close' }, '✕');
  if (!config.container) header.appendChild(closeBtn);
  panel.appendChild(header);

  const messages = el('div', { class: 'messages', role: 'log', 'aria-live': 'polite' });
  panel.appendChild(messages);

  const suggestions = el('div', { class: 'suggestions' });
  panel.appendChild(suggestions);

  const form = el('form');
  const label = el('label', { class: 'sr', for: 'fis-q' }, 'Ask a question');
  const input = el('textarea', { id: 'fis-q', rows: '1', placeholder: config.placeholder, maxlength: String(config.maxInputChars) });
  const send = el('button', { class: 'send', type: 'submit' }, 'Send');
  form.append(label, input, send);
  panel.appendChild(form);
  if (config.footer) panel.appendChild(el('div', { class: 'foot' }, config.footer));

  // --- events -------------------------------------------------------------
  launcher.addEventListener('click', () => setOpen(!root.classList.contains('open')));
  closeBtn.addEventListener('click', () => setOpen(false));
  resetBtn.addEventListener('click', () => handlers.onReset());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
    if (e.key === 'Escape' && !config.container) setOpen(false);
  });
  input.addEventListener('input', autosize);

  function submit() {
    const text = input.value.trim();
    if (!text || send.disabled) return;
    input.value = '';
    autosize();
    handlers.onSend(text);
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  }

  function setOpen(open) {
    root.classList.toggle('open', open);
    launcher.setAttribute('aria-expanded', String(open));
    if (open) setTimeout(() => input.focus(), 0);
    handlers.onToggle && handlers.onToggle(open);
  }

  function scroll() {
    messages.scrollTop = messages.scrollHeight;
  }

  // --- API used by the controller ----------------------------------------
  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    setBusy(busy) {
      send.disabled = busy;
      input.setAttribute('aria-busy', String(busy));
    },
    clear() {
      messages.textContent = '';
    },
    setSuggestions(list) {
      suggestions.textContent = '';
      (list || []).forEach((q) => {
        const b = el('button', { type: 'button' }, q);
        b.addEventListener('click', () => handlers.onSend(q));
        suggestions.appendChild(b);
      });
    },
    addUser(text) {
      messages.appendChild(el('div', { class: 'msg user' }, text));
      scroll();
    },
    addError(text) {
      messages.appendChild(el('div', { class: 'msg error', role: 'alert' }, text));
      scroll();
    },
    addBotMessage(initialHtml) {
      const bubble = el('div', { class: 'msg bot' });
      const body = el('div');
      body.innerHTML = initialHtml != null ? renderMarkdown(initialHtml) : '<span class="typing">Thinking…</span>';
      bubble.appendChild(body);
      messages.appendChild(bubble);
      scroll();
      let raw = '';
      const cites = [];
      return {
        append(text) {
          raw += text;
          body.innerHTML = renderMarkdown(raw);
          scroll();
        },
        addCitation(c) {
          if (!c || !c.url || !/^https?:\/\//.test(c.url)) return;
          if (cites.some((x) => x.url === c.url)) return;
          cites.push(c);
        },
        finish({ onFeedback } = {}) {
          if (!raw) body.innerHTML = renderMarkdown('_No answer returned._');
          if (cites.length) {
            const wrap = el('div', { class: 'cites' });
            cites.slice(0, 6).forEach((c) => {
              const a = el('a', { class: 'cite', href: c.url, target: '_blank', rel: 'noopener noreferrer', title: c.source || '' });
              a.innerHTML = escapeHtml(c.title || c.url);
              wrap.appendChild(a);
            });
            bubble.appendChild(wrap);
          }
          if (onFeedback) {
            const fb = el('div', { class: 'fb' });
            const up = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Helpful', 'aria-pressed': 'false' }, '👍');
            const down = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Not helpful', 'aria-pressed': 'false' }, '👎');
            const pick = (btn, other, rating) => {
              btn.setAttribute('aria-pressed', 'true');
              other.setAttribute('aria-pressed', 'false');
              onFeedback(rating);
            };
            up.addEventListener('click', () => pick(up, down, 'up'));
            down.addEventListener('click', () => pick(down, up, 'down'));
            fb.append(up, down);
            bubble.appendChild(fb);
          }
          scroll();
          return raw;
        },
      };
    },
    destroy() {
      hostEl.remove();
    },
  };
}

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
}

function resolveEl(c) {
  if (typeof c === 'string') {
    const found = document.querySelector(c);
    if (!found) throw new Error(`FisCopilot: container "${c}" not found`);
    return found;
  }
  return c;
}
