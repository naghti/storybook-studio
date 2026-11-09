const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('studio', {
  call: (action, payload) => ipcRenderer.invoke('studio:call', action, payload),
  onChange: callback => { const listener=()=>callback();ipcRenderer.on('studio:change',listener);return ()=>ipcRenderer.removeListener('studio:change',listener); },
});
