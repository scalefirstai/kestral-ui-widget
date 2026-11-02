// Electron preload: exposes a narrow, read-only bridge the widget looks for at
// window.fisCopilotHost. The renderer never sees ipcRenderer itself.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fisCopilotHost', {
  getToken: () => ipcRenderer.invoke('fis-copilot:getToken'),
  getContext: () => ipcRenderer.invoke('fis-copilot:getContext'),
});
