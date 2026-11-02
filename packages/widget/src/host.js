// Host bridge: one way to get a token and app context, whatever the widget is running in.
//
// Resolution order for the token:
//   1. config.getToken()                     — web apps / SPAs that already hold a token
//   2. window.fisCopilotHost.getToken()      — Electron (exposed from preload via contextBridge)
//   3. WebView2 postMessage round-trip       — .NET desktop (WPF / WinForms) hosting WebView2
//   4. null                                  — gateway falls back to cookie / Windows-integrated auth
//
// The same order applies to getContext() (current screen, fund id, job id, etc.).

const WEBVIEW2_TIMEOUT_MS = 5000;

export function detectHost() {
  if (typeof window === 'undefined') return 'none';
  if (window.fisCopilotHost) return 'electron';
  if (window.chrome && window.chrome.webview) return 'webview2';
  return 'web';
}

export async function resolveToken(config) {
  if (typeof config.getToken === 'function') return (await config.getToken()) || null;
  const host = detectHost();
  if (host === 'electron' && typeof window.fisCopilotHost.getToken === 'function') {
    return (await window.fisCopilotHost.getToken()) || null;
  }
  if (host === 'webview2') return (await webview2Request('getToken')) || null;
  return null;
}

export async function resolveContext(config) {
  const base = { url: safeLocation(), host: detectHost() };
  let extra = {};
  if (typeof config.getContext === 'function') extra = (await config.getContext()) || {};
  else if (detectHost() === 'electron' && typeof window.fisCopilotHost.getContext === 'function') {
    extra = (await window.fisCopilotHost.getContext()) || {};
  } else if (detectHost() === 'webview2') {
    extra = (await webview2Request('getContext')) || {};
  }
  return { ...base, ...extra };
}

// WebView2: the .NET host listens for WebMessageReceived and replies with PostWebMessageAsJson.
// Message shape out: { type: 'fis-copilot:request', id, method }
// Message shape back: { type: 'fis-copilot:response', id, result }
let seq = 0;
function webview2Request(method) {
  const wv = window.chrome.webview;
  const id = `req-${Date.now()}-${++seq}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      wv.removeEventListener('message', onMessage);
      resolve(null);
    }, WEBVIEW2_TIMEOUT_MS);
    function onMessage(e) {
      const msg = e.data;
      if (!msg || msg.type !== 'fis-copilot:response' || msg.id !== id) return;
      clearTimeout(timer);
      wv.removeEventListener('message', onMessage);
      resolve(msg.result);
    }
    wv.addEventListener('message', onMessage);
    wv.postMessage({ type: 'fis-copilot:request', id, method });
  });
}

function safeLocation() {
  try {
    return window.location.href;
  } catch {
    return '';
  }
}
