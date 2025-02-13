const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    runCommand: async (cmd, args = []) => {
        return ipcRenderer.invoke('run-command', cmd, args);
    }
});
