// Minimal, incremental Server-Sent Events parser.
// Feed it text chunks as they arrive; it returns complete events and keeps the remainder buffered.
// Spec: https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation

export function createSseParser() {
  let buffer = '';

  return function push(chunk) {
    buffer += chunk.replace(/\r\n?/g, '\n');
    const events = [];
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const evt = parseBlock(raw);
      if (evt) events.push(evt);
    }
    return events;
  };
}

function parseBlock(raw) {
  let event = 'message';
  const data = [];
  for (const line of raw.split('\n')) {
    if (!line || line.startsWith(':')) continue; // comment / keep-alive
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (!data.length) return null;
  const text = data.join('\n');
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { text };
  }
  return { event, data: payload };
}
