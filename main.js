const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const unzipper = require('unzipper');

// statusWindow 모듈 가져오기
const { openStatusWindow, updateStatusWindow, closeStatusWindow } = require('./statusWindow.js');


const isDev = !app.isPackaged;

// Python 환경 압축 해제 함수
async function ensurePythonEnv() {
    let zipFilePath, targetDir;
    if (isDev) {
        zipFilePath = path.join(__dirname, 'env_win.zip');
        targetDir = path.join(__dirname, 'py_env');
        console.log('[DEBUG] 개발 모드이므로 env_win.zip을 풀지 않습니다.');
        //return;  // 개발 중에는 압축 해제 X
    } else {
        zipFilePath = path.join(process.resourcesPath, 'env_win.zip');
        targetDir = path.join(process.resourcesPath, 'py_env');
    }

    if (fs.existsSync(targetDir)) {
        console.log('[INFO] Python 환경이 이미 존재합니다:', targetDir);
        return;
    }

    // 1) 상태 창 열고 초기 메시지
    openStatusWindow('<h3>압축 해제 시작</h3>');

    // 로그 출력 함수(콘솔+창 업데이트 같이 쓰고 싶다면 추가로 구현 가능)
    const log = (message) => {
        console.log(message);
        updateStatusWindow(message + '<br>');
    };

    log('[INFO] Python 환경 압축 해제 시작...');
    try {
        await fs.createReadStream(zipFilePath)
            .pipe(unzipper.Extract({ path: targetDir }))
            .promise();
        log('[INFO] Python 환경 압축 해제 완료', targetDir);
    } catch (err) {
        log('[ERROR] Python 환경 압축 해제 실패', err);
    }

    // 작업 끝난 뒤 잠시 후 창 닫기
    setTimeout(() => closeStatusWindow(), 3000);
}

// 앱 창 생성 함수
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

// 앱 실행 시 Python 환경 체크 후 창 띄우기
app.whenReady().then(async () => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });

    await ensurePythonEnv(); // 압축 해제 (배포 환경에서만)
});

// 창이 모두 닫히면 앱 종료
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
            // Python 실행
            const child = spawn(command, args);

            // stdout 실시간 전송
            child.stdout.on('data', (data) => {
                event.sender.send('command-stdout', data.toString());
            });

            // stderr 실시간 전송
            child.stderr.on('data', (data) => {
                event.sender.send('command-stderr', data.toString());
            });

            child.on('close', (code) => {
                event.sender.send('command-close', code);
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

// 공통 리소스 경로 반환 함수
function getPythonScriptsPath() {
    // 개발 모드 vs. 프로덕션 모드 구분
    if (isDev) {
        // 1) 개발 시(__dirname -> 프로젝트 폴더) 
        //    => "python_scripts" 폴더가 프로젝트 루트/main.js 와 같은 위치에 있는 경우
        return path.join(__dirname, 'python_scripts');
    } else {
        // 2) 프로덕션 빌드 시
        //    => "python_scripts" 폴더가 extraResources 설정에 의해 
        //       asar 바깥 (process.resourcesPath/python_scripts)에 배치됨
        return path.join(process.resourcesPath, 'python_scripts');
    }
}


// 공통 리소스 경로 반환 함수
function getJSONPath() {
    // 개발 모드 vs. 프로덕션 모드 구분
    if (isDev) {
        // 1) 개발 시(__dirname -> 프로젝트 폴더) 
        //    => "python_scripts" 폴더가 프로젝트 루트/main.js 와 같은 위치에 있는 경우
        return path.join(__dirname, 'json_files');
    } else {
        // 2) 프로덕션 빌드 시
        //    => "python_scripts" 폴더가 extraResources 설정에 의해 
        //       asar 바깥 (process.resourcesPath/python_scripts)에 배치됨
        return path.join(process.resourcesPath, 'json_files');
    }
}

// config.json 경로
const configPath = path.join(getJSONPath(), 'config.json');
console.log("configPath:", configPath);

// results.json 경로
const resultsMetricPath = path.join(getJSONPath(), 'best_metric.json');
const resultsParamsPath = path.join(getJSONPath(), 'best_params.json');

// config.json 읽기
ipcMain.handle('load-config', async () => {
    if (!fs.existsSync(configPath)) {
        return [];
    }
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

// results.json 읽기
ipcMain.handle('load-results', async () => {
    console.error("load-results 실행");
    if (!fs.existsSync(resultsMetricPath) || !fs.existsSync(resultsParamsPath)) {
        return [];
    }
    const dataMetric = JSON.parse(fs.readFileSync(resultsMetricPath, 'utf-8'));
    const dataParams = JSON.parse(fs.readFileSync(resultsParamsPath, 'utf-8'));

    try {
        return [
            "Best metric:\n" + JSON.stringify(dataMetric, null, 4),
            "\n",
            "Best params:\n" + JSON.stringify(dataParams, null, 4)
        ];
    } catch (err) {
        console.log("json 파싱 에러:", err);
        return [];
    }
});
