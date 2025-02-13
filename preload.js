const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    runCommand: (cmd, args = []) => ipcRenderer.invoke('run-command', cmd, args),
    loadConfig: () => ipcRenderer.invoke('load-config'),
    saveConfig: (data) => ipcRenderer.invoke('save-config', data),
});
