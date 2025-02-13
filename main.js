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


// ----------------------------------------------------------------------------------------
// 1) Renderer가 "run-command"를 invoke하면, 자식 프로세스를 spawn하고
//    stdout/stderr 발생 시마다 메인 → 렌더러로 이벤트("command-stdout", "command-stderr")를 보냄
//    프로세스 종료 시 "command-close" 이벤트 전송
// ----------------------------------------------------------------------------------------
ipcMain.handle('run-command', async (event, command, args) => {
    return new Promise((resolve, reject) => {
        try {
            // 예: Python -u 옵션 등으로 실행하면 stdout 버퍼링이 줄어듦
            const child = spawn(command, args);

            // stdout 실시간 전송
            child.stdout.on('data', (data) => {
                // 이벤트 이름 "command-stdout"은 임의로 정한 것
                event.sender.send('command-stdout', data.toString());
            });

            // stderr 실시간 전송
            child.stderr.on('data', (data) => {
                event.sender.send('command-stderr', data.toString());
            });

            child.on('close', (code) => {
                event.sender.send('command-close', code);
                // 프로세스가 끝난 시점에 Promise resolve
                // -- 만약 종료되기 전까지는 invoke의 결과가 필요 없으면, 
                //    여기서 resolve({ code }) 해주거나, 그냥 간단히 resolve()만 해도 됨.
                resolve({ code });
            });

            child.on('error', (err) => {
                event.sender.send('command-error', err.message);
                reject(err);
            });
        } catch (err) {
            reject(err);
        }
    });
});


// config.json 경로
const configPath = path.join(__dirname, 'json_files/config.json');

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

// results.json 경로
const resultsMetricPath = path.join(__dirname, 'json_files/best_metric.json');
const resultsParamsPath = path.join(__dirname, 'json_files/best_params.json');

// results.json 읽기
ipcMain.handle('load-results', async () => {
    console.error("load-results 실행");
    if (!fs.existsSync(resultsMetricPath)) {
        // 파일이 없으면 빈 객체를 반환
        return [];
    }
    if (!fs.existsSync(resultsParamsPath)) {
        // 파일이 없으면 빈 객체를 반환
        return [];
    }
    // 파일이 있으면 내용 파싱 후 반환
    const dataMetric = JSON.parse(fs.readFileSync(resultsMetricPath, 'utf-8'));
    const dataParams = JSON.parse(fs.readFileSync(resultsParamsPath, 'utf-8'));
    console.error("dataMetric:", dataMetric);
    console.error("dataParams:", dataParams);
    try {
        return [
            "Best metric:\n" + JSON.stringify(dataMetric, null, 4),
            "\n",
            "Best params:\n" + JSON.stringify(dataParams, null, 4)
        ];
    } catch (err) {
        console.log("json 파싱 에러:", err);
        //return { metrics: {}, params: {} };
        return [];
    }
});
