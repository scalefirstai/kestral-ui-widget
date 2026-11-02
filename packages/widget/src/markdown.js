// Small, safe Markdown renderer for assistant replies.
// Everything is HTML-escaped FIRST, then a limited set of constructs is re-introduced.
// No raw HTML from the model ever reaches the DOM. Links are restricted to http(s).

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderMarkdown(src) {
  const codeBlocks = [];
  // Pull fenced code blocks out first so their contents are never transformed.
  let text = String(src).replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    codeBlocks.push(`<pre><code${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`);
    return `\u0000${codeBlocks.length - 1}\u0000`;
  });

  text = escapeHtml(text);

  const lines = text.split('\n');
  const out = [];
  let list = null; // 'ul' | 'ol'
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };

  for (const line of lines) {
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (ul || ol) {
      const want = ul ? 'ul' : 'ol';
      if (list !== want) {
        closeList();
        out.push(`<${want}>`);
        list = want;
      }
      out.push(`<li>${inline((ul || ol)[1])}</li>`);
      continue;
    }
    closeList();
    if (h) out.push(`<p class="h">${inline(h[2])}</p>`);
    else if (/^\u0000\d+\u0000$/.test(line.trim())) out.push(line.trim());
    else if (line.trim() === '') out.push('');
    else out.push(`<p>${inline(line)}</p>`);
  }
  closeList();

  return out
    .join('\n')
    .replace(/\u0000(\d+)\u0000/g, (_, i) => codeBlocks[Number(i)])
    .replace(/\n{2,}/g, '\n');
}

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_([^_]+)_(?=[^\w]|$)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}
