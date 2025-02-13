const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    runCommand: (cmd, args = []) => ipcRenderer.invoke('run-command', cmd, args),
    loadConfig: () => ipcRenderer.invoke('load-config'),
    saveConfig: (data) => ipcRenderer.invoke('save-config', data),
    loadResults: () => ipcRenderer.invoke('load-results'), // 이거 자체가 함수 결과를 바로 리턴하는 것이므로, {} 로 감싸서 여러 줄을 작성하면 return 값이 index.html 로 전달이 안됨

    // stdout/stderr/close/error 이벤트 실시간 수신
    onCommandStdout: (callback) => {
        ipcRenderer.on('command-stdout', (event, data) => {
            callback(data);
        });
    },
    onCommandStderr: (callback) => {
        ipcRenderer.on('command-stderr', (event, data) => {
            callback(data);
        });
    },
    onCommandClose: (callback) => {
        ipcRenderer.on('command-close', (event, code) => {
            callback(code);
        });
    },
    onCommandError: (callback) => {
        ipcRenderer.on('command-error', (event, errMsg) => {
            callback(errMsg);
        });
    },
});