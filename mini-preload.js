const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mini', {
  onState: (cb) => ipcRenderer.on('mini-state', (_e, data) => cb(data)),
  command: (cmd) => ipcRenderer.send('mini-command', cmd)
});