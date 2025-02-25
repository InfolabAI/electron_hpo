const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const unzipper = require('unzipper');
const exec = require('util').promisify(require('child_process').exec);


// statusWindow 모듈 가져오기
const { openStatusWindow, updateStatusWindow, closeStatusWindow } = require('./statusWindow.js');

const isDev = !app.isPackaged;
let childProcess = null;

// Python 환경 압축 해제 함수
async function ensurePythonEnv() {

    let mainPath;
    if (isDev) {
        mainPath = __dirname;
        console.log('[DEBUG] no decompression in development mode');
        return;  // 개발 중에는 압축 해제 X
    } else {
        mainPath = process.resourcesPath;
    }

    // 1) 상태 창 열고 초기 메시지
    openStatusWindow('<h3>Initializing Environment</h3>');

    // 로그 출력 함수
    const log = (message) => {
        console.log(message);
        updateStatusWindow(message + '<br>');
    };

    let zipFilePath, targetDir;

    zipFilePath = path.join(mainPath, 'hpo_env_win.zip');
    targetDir = path.join(mainPath, 'py_env');

    if (fs.existsSync(targetDir)) {
        console.log('[INFO] Python environment already exists', targetDir);
    }
    else {
        log('[INFO] Starting to unzip the Python environment...');
        try {
            await fs.createReadStream(zipFilePath)
                .pipe(unzipper.Extract({ path: targetDir }))
                .promise();
            log('[INFO] Python environment unzipping complete');
        } catch (err) {
            log('[ERROR] Failed to unzip the Python environment');
            console.error(err);
        }

    }

    const pyScriptPath = path.join(process.resourcesPath, 'python_scripts');

    // PyInstaller 실행 경로 (py_env/Scripts/pyinstaller.exe)
    const pyInstallerPath = path.join(process.resourcesPath, 'py_env', 'Scripts', 'pyinstaller.exe');
    // 빌드 대상 스크립트 경로
    const testLocalServerPath = path.join(pyScriptPath, 'test_local_server.py');
    if (fs.existsSync(path.join(pyScriptPath, 'test_local_server.exe'))) {
        console.log('[INFO] The local server already exists', path.join(pyScriptPath, 'test_local_server.exe'));
        return;
    }
    // =========================
    // 아래 부분에 PyInstaller 빌드 및 파일 삭제 코드 추가
    // =========================
    try {
        log('[INFO] Building the local server...');

        // PyInstaller로 exe 빌드 (onefile 모드)
        await exec(`"${pyInstallerPath}" --onefile --distpath "${pyScriptPath}" "${testLocalServerPath}"`);
        log('[INFO] Local server build completed');

        // 빌드 후 사용했던 test_local_server.py, test.py 삭제
        fs.unlinkSync(testLocalServerPath);
        fs.unlinkSync(path.join(pyScriptPath, 'test.py'));
        log('[INFO] File cleanup completed');
    } catch (err) {
        log('[ERROR] Failed to build with PyInstaller or delete files');
        console.error(err);
    }

    log('[INFO] (Closing the window in 5 seconds)');
    // 작업 끝난 뒤 잠시 후 창 닫기
    setTimeout(() => closeStatusWindow(), 5000);
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

// app이 종료되기 직전(모든 윈도우가 닫히거나 quit가 호출되기 직전)
app.on('before-quit', (event) => {
    if (childProcess) {
        // 자식 프로세스 종료
        childProcess.kill();
        childProcess = null;
        console.log("Child process terminated");
    }
});

// ----------------------------------------------------------------------------------------
// 1) Renderer가 "run-command"를 invoke하면, 자식 프로세스를 spawn하고
//    stdout/stderr 발생 시마다 메인 → 렌더러로 이벤트("command-stdout", "command-stderr")를 보냄
//    프로세스 종료 시 "command-close" 이벤트 전송
// ----------------------------------------------------------------------------------------
ipcMain.handle('run-command', async (event, command, args) => {
    console.log("cmd:", command, "args:", args);
    if (isDev) {
        command = path.resolve(__dirname, '..', 'hpo_env_linux', 'bin', 'python');
        args = [
            path.resolve(__dirname, 'python_scripts', 'test_local_server.py'),
            '--root',
            __dirname
        ];
    }
    else {
        //command = path.resolve(process.resourcesPath, 'py_env', 'Scripts', 'python.exe');
        command = path.resolve(process.resourcesPath, 'python_scripts', 'test_local_server.exe')
        args = [
            '--root',
            process.resourcesPath
        ];
    }
    console.log("command", command);
    console.log("args", args);
    // if (isDev) {
    // }
    // else {
    //     args.push('--path', 'resources');
    //     console.log("배포 모드에서는 args에 --path resources 추가");
    // }
    return new Promise((resolve, reject) => {
        try {
            // Python 실행
            const child = spawn(command, args);
            childProcess = child;

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
        console.log("Error parsing json", err);
        return [];
    }
});

// config.json 저장
ipcMain.handle('save-config', async (event, configData) => {
    try {
        fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf-8');
        return true;
    } catch (err) {
        console.error("Error saving config.json", err);
        throw err;
    }
});

// results.json 읽기
ipcMain.handle('load-results', async () => {
    console.error("Executing load-results");
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
        console.log("Error parsing json", err);
        return [];
    }
});
