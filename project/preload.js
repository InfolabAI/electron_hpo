const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    runCommand: (cmd, args, n_trials = []) => ipcRenderer.invoke('run-command', cmd, args, n_trials),
    loadConfig: () => ipcRenderer.invoke('load-config'),
    saveConfig: (data) => ipcRenderer.invoke('save-config', data),
    loadResults: () => ipcRenderer.invoke('load-results'), // 이거 자체가 함수 결과를 바로 리턴하는 것이므로, {} 로 감싸서 여러 줄을 작성하면 return 값이 index.html 로 전달이 안됨
    getDashboardPreloadPath: () => ipcRenderer.invoke('get-dashboard-preload-path'),
    getIQGenPreloadPath: () => ipcRenderer.invoke('getIQGenPreloadPath'),

    // Window control functions
    minimizeWindow: () => ipcRenderer.send('window:minimize'),
    maximizeWindow: () => ipcRenderer.send('window:maximize'),
    closeWindow: () => ipcRenderer.send('window:close'),

    // File system and dialog operations
    openDirectoryDialog: (options) => ipcRenderer.invoke('dialog:openDirectory', options),
    showMessageBox: (options) => ipcRenderer.invoke('dialog:showMessageBox', options),
    readDirectory: (dirPath) => ipcRenderer.invoke('fs:readDirectory', dirPath),
    directoryExists: (dirPath) => ipcRenderer.invoke('fs:directoryExists', dirPath),
    checkFilesExist: (filePaths) => ipcRenderer.invoke('fs:checkFilesExist', filePaths),

    // Model operations
    deployModel: (options) => {
        console.log('preload.js: deployModel called with options:', options);
        if (!options) {
            console.error('deployModel: options is null or undefined');
            return ipcRenderer.invoke('model:deploy', {});
        }

        return ipcRenderer.invoke('model:deploy', options);
    },

    // HPO operations
    checkHpoStatus: () => ipcRenderer.invoke('hpo:checkStatus'),
    killHpoProcess: () => ipcRenderer.invoke('hpo:kill'),

    // Python script execution
    runPythonScript: (options) => ipcRenderer.invoke('python:run', options),

    // Image processing
    processImage: (options) => ipcRenderer.invoke('image:process', options),

    // Alignment operations
    alignImages: (baseLinePath, otherLinePath) => ipcRenderer.invoke('align:images', baseLinePath, otherLinePath),

    // HPO operations
    runHpoOnnx: (baseLinePath, otherLinePath) => ipcRenderer.invoke('hpo:runOnnx', baseLinePath, otherLinePath),

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

    // Progress events
    onAlignmentProgress: (callback) => {
        ipcRenderer.on('alignment:progress', (event, progress) => {
            callback(progress);
        });
    },
    onAlignmentComplete: (callback) => {
        ipcRenderer.on('alignment:complete', (event, result) => {
            callback(result);
        });
    },
    onAugmentationProgress: (callback) => {
        ipcRenderer.on('augmentation:progress', (event, data) => {
            callback(data);
        });
    },

    // Tab events
    onTabEvent: (callback) => {
        ipcRenderer.on('tab:event', (event, eventType) => {
            callback(eventType);
        });
    },

    // For direct IPC communication
    ipcRenderer: ipcRenderer
});