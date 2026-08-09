const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lyricApi', {
  onLine: (cb) => ipcRenderer.on('lyric-line', (_e, data) => cb(data)),
  onVisibility: (cb) => ipcRenderer.on('lyric-visible', (_e, visible) => cb(visible)),
  close: () => ipcRenderer.send('lyric-window-close')
});