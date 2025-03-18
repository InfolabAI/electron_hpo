const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const unzipper = require('unzipper');
const exec = require('util').promisify(require('child_process').exec);

// statusWindow 모듈 가져오기
const { openStatusWindow, updateStatusWindow, closeStatusWindow } = require('./statusWindow.js');

const isDev = !app.isPackaged;
// python 서버용 전역 변수
let childProcess = null;
// optuna-dashboard 프로세스 전역 변수
let dashboardProcess = null;

async function ensurePythonEnv() {
    // 개발 모드면 압축 해제/빌드 로직 스킵
    if (isDev) {
        console.log('[DEBUG] No decompression in development mode');
        return;
    }

    // 기본 경로들
    const mainPath = process.resourcesPath;
    const zipFilePath = path.join(mainPath, 'hpo_env_win.zip');
    const targetDir = path.join(mainPath, 'py_env');
    const pyScriptPath = path.join(mainPath, 'python_scripts');
    const testLocalServerPath = path.join(pyScriptPath, 'test_local_server.py');
    const localServerExePath = path.join(pyScriptPath, 'test_local_server.exe');
    const pythonPath = path.join(targetDir, 'python.exe');

    // 이미 준비돼 있다면 종료
    if (
        fs.existsSync(targetDir) &&
        fs.existsSync(localServerExePath) &&
        !fs.existsSync(testLocalServerPath)
    ) {
        console.log('[INFO] Python env and local server already exist. No action needed.');
        return;
    }

    // 상태 창 열기
    openStatusWindow('<h3>Initializing Environment</h3>');

    // 로그를 남기고 상태창에 표시하는 헬퍼 함수
    const log = (message) => {
        console.log(message);
        updateStatusWindow(message + '<br>');
    };

    // 1) Python 환경 압축 해제
    log('[INFO] Starting to set up the Python environment...');
    try {
        await fs.createReadStream(zipFilePath)
            .pipe(unzipper.Extract({ path: targetDir }))
            .promise();
        log('[INFO] The Python environment has been successfully set up');
    } catch (err) {
        log('[ERROR] Failed to set up the Python environment');
        console.error(err);
    }

    // 2) PyInstaller 빌드
    try {
        log('[INFO] Building...');
        await exec(
            `"${pythonPath}" -m PyInstaller --onefile --console --distpath "${pyScriptPath}" "${testLocalServerPath}"`
        );
        log('[INFO] Successfully built');

        // 빌드 후 사용했던 파이썬 스크립트 제거
        fs.unlinkSync(testLocalServerPath);
        log('[INFO] File cleanup completed');
    } catch (err) {
        log('[ERROR] Failed to build');
        console.error('[ERROR] Failed to build with PyInstaller or delete files', err);
    }

    // 3) 최종 확인 후 성공 or 실패 로그 + 종료 처리
    if (
        fs.existsSync(targetDir) &&
        fs.existsSync(localServerExePath) &&
        !fs.existsSync(testLocalServerPath)
    ) {
        log('[INFO] (Closing the window in 10 seconds)');
        setTimeout(() => closeStatusWindow(), 10000);
    } else {
        log('[ERROR] Required conditions not met. Exiting the Electron app in 10 seconds.');
        setTimeout(() => {
            closeStatusWindow();
            app.quit();
        }, 10000);
    }
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
            nodeIntegrationInSubFrames: true, // <webview> 내부 스크립트 허용
            webviewTag: true  // ← 이걸 반드시 추가해줘야 <webview> 태그가 동작함!
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

    // optuna-dashboard 실행
    await kill_childs();
    startOptunaDashboard(); // 이걸 종료시키는 kill_childs 다음에 실행되어야 함.

    let template = [
        {
            label: 'File',
            submenu: [
                { role: 'quit' }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'About This App',
                    click: () => {
                        // 여기서 정보 표시 / 새 창 띄우기 등
                        console.log('Show about info with my name here');

                        // 1) 상태 창 열고 초기 메시지
                        //openStatusWindow('검사AI개발Task 임희철');
                    }
                }
            ]
        },
    ];

    try {

        if (isDev) {
            template.push({
                label: 'View',
                submenu: [
                    {
                        label: 'Toggle DevTools',
                        accelerator: 'Ctrl+Shift+P', // 원하는 키로 변경 가능
                        click: (item, focusedWindow) => {
                            if (focusedWindow) {
                                focusedWindow.webContents.toggleDevTools();
                            }
                        },
                    },
                    // 다른 메뉴 항목들
                ],
            });
        }
    } catch (error) {
        console.error('Error adding devtools menu:', error);
    }

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);

});

// 창이 모두 닫히면 앱 종료
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// app이 종료되기 직전(모든 윈도우가 닫히거나 quit가 호출되기 직전)
app.on('before-quit', async (event) => {
    await kill_childs();
});


// ----------------------------------------------------------------------------------------
// 1) Renderer가 "run-command"를 invoke하면, 자식 프로세스를 spawn하고
//    stdout/stderr 발생 시마다 메인 → 렌더러로 이벤트("command-stdout", "command-stderr")를 보냄
//    프로세스 종료 시 "command-close" 이벤트 전송
// ----------------------------------------------------------------------------------------
ipcMain.handle('run-command', async (event, command, args, n_trials) => {
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
            process.resourcesPath,
        ];
    }

    args = args.concat(['--n_trials', n_trials]);

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


// IPC로 렌더러에 경로를 알려주는 예시
ipcMain.handle('get-dashboard-preload-path', async () => {
    let PATH = '';
    // isDev는 이미 어디선가 선언되어 있다고 가정
    if (isDev) {
        //path.join(__dirname, 'dashboardPreload.js');
        PATH = path.join(__dirname, 'dashboardPreload.js');
    } else {
        //path.join(process.resourcesPath, 'dashboardPreload.js');
        PATH = path.join(process.resourcesPath, 'dashboardPreload.js');
    }
    PATH = pathToFileURL(PATH).href; // Windows 경로 또는 스페이스 바 있어도 문제없도록 하는 코드. 자동으로 file:// 붙여줌
    console.log("dashboard-preload-path", PATH);
    return PATH;
});


/**
 * optuna-dashboard를 별도 프로세스로 실행하는 함수
 * - 개발모드: 로컬 시스템의 python 사용 (예: 'python' 가정)
 * - 배포모드: resourcesPath 내 임베디드 python 사용
 */
function startOptunaDashboard() {
    // 개발/배포 환경에 따라 파이썬 경로 설정
    const pythonExe = isDev
        ? 'python'  // 개발용 (PATH에 python이 있다고 가정)
        : path.join(process.resourcesPath, 'py_env', 'python.exe'); // 배포용

    const dashboardCommand = [
        '-c',
        `import optuna_dashboard; optuna_dashboard.run_server('sqlite:///./db.sqlite3', host='127.0.0.1', port=8080)`
    ];
    dashboardProcess = spawn(pythonExe, dashboardCommand);

    // 필요한 경우 콘솔 로깅
    dashboardProcess.stdout.on('data', (data) => {
        console.log(`[dashboard][STDOUT] ${data}`);
    });
    dashboardProcess.stderr.on('data', (data) => {
        console.error(`[dashboard][STDERR] ${data}`);
    });
    dashboardProcess.on('close', (code) => {
        console.log(`[dashboard] process exited, code=${code}`);
        dashboardProcess = null;
    });
    dashboardProcess.on('error', (err) => {
        console.error('[dashboard] failed to start:', err);
    });
}

async function kill_childs() {
    if (childProcess) {
        // 자식 프로세스 종료
        childProcess.kill();
        childProcess = null;
        console.log("Child process terminated\n");
    }
    if (dashboardProcess) {
        dashboardProcess.kill();
        dashboardProcess = null;
        console.log("dashboard process terminated\n");
    }

    // 기존에 실행된 서버 모두 종료
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);

    // 1) test_local_server.exe 강제 종료
    const processName1 = 'test_local_server.exe';
    try {
        const { stdout, stderr } = await execPromise(`taskkill /F /IM ${processName1}`);
        console.log(`[INFO] Killed all processes named "${processName1}"\n`);
        if (stdout) console.log('stdout:', stdout);
        if (stderr) console.log('stderr:', stderr);
    } catch (error) {
        console.error('[ERROR] Failed to kill process:', error.message);
    }

    // 2) optuna-dashboard.exe (또는 python.exe) 강제 종료
    //    배포 환경에서 optuna-dashboard가 어떤 이름으로 뜨는지 확인 후 수정
    const processName2 = 'optuna-dashboard.exe';
    try {
        const { stdout, stderr } = await execPromise(`taskkill /F /IM ${processName2}`);
        console.log(`[INFO] Killed all processes named "${processName2}"\n`);
        if (stdout) console.log('stdout:', stdout);
        if (stderr) console.log('stderr:', stderr);
    } catch (error) {
        // 실행 중이 없으면 "not found" 메시지 날 수도 있으니 에러로 봐도 무방
        console.error('[ERROR] Failed to kill process:', error.message);
    }
}
