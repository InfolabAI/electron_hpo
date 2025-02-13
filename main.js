const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function createWindow() {
    const win = new BrowserWindow({
        width: 1000,
        height: 700,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
        },
    });

    win.loadFile('index.html');
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// IPC 이벤트 핸들러
ipcMain.handle('run-command', async (event, command, args) => {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args);

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('close', (code) => {
            resolve({ code, stdout, stderr });
        });

        child.on('error', (err) => {
            reject(err);
        });
    });
});

// config.json 경로
const configPath = path.join(__dirname, 'config.json');

// config.json 읽기
ipcMain.handle('load-config', async () => {
    if (!fs.existsSync(configPath)) {
        // 파일이 없으면 빈 배열(혹은 원하는 초기값)을 반환
        return [];
    }
    // 파일이 있으면 내용 파싱 후 반환
    const data = fs.readFileSync(configPath, 'utf-8');
    try {
        return JSON.parse(data);
    } catch (err) {
        console.error("config.json 파싱 에러:", err);
        return [];
    }
});

// config.json 저장
ipcMain.handle('save-config', async (event, configData) => {
    try {
        fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf-8');
        return true;
    } catch (err) {
        console.error("config.json 저장 에러:", err);
        throw err;
    }
});
