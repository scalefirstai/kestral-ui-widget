// Electron main process: wires the token and context handlers the preload exposes.
// The renderer page just includes the widget script and calls FisCopilot.init (no getToken needed:
// the widget detects window.fisCopilotHost automatically).
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');

const GATEWAY = process.env.COPILOT_GATEWAY_URL || 'http://localhost:8787';

async function getAccessToken() {
  // Replace with your IdP flow (MSAL Node, keytar-cached refresh token, etc.).
  return process.env.COPILOT_DEV_TOKEN || null;
}

let currentContext = { screen: 'Home' };

app.whenReady().then(() => {
  ipcMain.handle('fis-copilot:getToken', () => getAccessToken());
  ipcMain.handle('fis-copilot:getContext', () => currentContext);

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Citations open in the system browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Demo only: a data: (or file://) page sends "Origin: null", which a strict gateway allowlist
  // should reject. In the real app, serve the UI from a privileged custom scheme
  // (protocol.registerSchemesAsPrivileged, e.g. app://eaglestar) and add that origin to ALLOWED_ORIGINS.
  win.loadURL(
    'data:text/html,' +
      encodeURIComponent(`<!doctype html><meta charset="utf-8"><h1>Desktop app</h1>
<script src="${GATEWAY}/widget/fis-copilot.js"></script>
<script>FisCopilot.init({ gatewayUrl: '${GATEWAY}', appId: 'eagle-star', title: 'Eagle STAR Support' });</script>`),
  );
});
