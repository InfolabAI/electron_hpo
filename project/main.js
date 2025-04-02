const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const unzipper = require('unzipper');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const { pathToFileURL } = require('url');

const { openStatusWindow, updateStatusWindow, closeStatusWindow } = require('./statusWindow.js');
const { generateLicense, validateLicense } = require('./licenseManager.js');

const isDev = !app.isPackaged;
let hpoProcess = null;      // Python 서버 프로세스
let dashboardProcess = null;  // optuna-dashboard 프로세스

/** 공통 경로들(개발/배포) 정리 */
function getPaths() {
    const base = isDev ? __dirname : process.resourcesPath;
    const baseAsar = isDev ? __dirname : path.join(process.resourcesPath, 'app.asar');
    const pyScripts = path.join(base, 'scripts');
    const zipFile = path.join(base, 'hpo_env_win.zip');
    const pyEnvDir = path.join(base, 'py_env');
    // 문제: EXE 빌드시 optuna의 Alembic 폴더가 누락되어 스키마 체크 시 에러 발생(임베디드 python 으로 실행하면 잘됨)
    // 해결: PyInstaller --add-data 옵션으로 해당 폴더를 포함해줌
    // 구분자인 ; 는 window 에서만 이거고 linux 에서는 : 이다.
    //      --add-data "C:\Users\robert.lim\AppData\Local\Programs\HPOptimizer\resources\py_env\Lib\site-packages\optuna\storages\_rdb\alembic;optuna/storages/_rdb/alembic"
    const alembicDir = path.join(pyEnvDir, 'Lib', 'site-packages', 'optuna', 'storages', '_rdb', 'alembic');
    const alembicRel = path.join('optuna', 'storages', '_rdb', 'alembic');
    const forAddData = `${alembicDir};${alembicRel}`;

    return {
        base,
        baseAsar,
        pyScripts,
        zipFile,
        pyEnvDir,
        testLocalServerPy: path.join(pyScripts, 'tls.dll'),
        testLocalServerExe: path.join(pyScripts, 'tls.exe'),
        pythonExe: path.join(pyEnvDir, 'python.exe'),
        jsonFiles: path.join(base, 'json_files'),
        forAddData
    };
}

/** Python 환경 구성 */
async function ensurePythonEnv() {
    if (isDev) {
        console.log('[DEBUG] 개발 모드 → 압축 해제 스킵');
        return;
    }

    const { zipFile, pyEnvDir, testLocalServerPy, testLocalServerExe, pythonExe, forAddData } = getPaths();

    // 이미 구성되어 있다면 종료
    if (fs.existsSync(pyEnvDir) && fs.existsSync(testLocalServerExe) && !fs.existsSync(testLocalServerPy)) {
        console.log('[INFO] Python env already set up');
        return;
    }

    openStatusWindow('<h3>Initializing Environment</h3>');
    const log = (msg) => { console.log(msg); updateStatusWindow(msg + '<br>'); };

    // 1) Python 압축 해제
    log('[INFO] Setup Python environment...');
    try {
        await fs.createReadStream(zipFile).pipe(unzipper.Extract({ path: pyEnvDir })).promise();
        log('[INFO] Python env decompressed');
    } catch (err) {
        log('[ERROR] Decompression failed'); console.error(err);
    }

    // 2) PyInstaller 빌드
    log('[INFO] Building files...');
    try {
        await exec(`"${pythonExe}" -m PyInstaller --add-data "${forAddData}" --onefile --console --distpath "${path.dirname(testLocalServerExe)}" "${testLocalServerPy}"`);
        fs.unlinkSync(testLocalServerPy); // 빌드 후 사용했던 스크립트 제거
        log('[INFO] Build & cleanup finished');
    } catch (err) {
        log('[ERROR] Build failed'); console.error(err);
    }

    // 3) 최종 확인
    if (fs.existsSync(pyEnvDir) && fs.existsSync(testLocalServerExe) && !fs.existsSync(testLocalServerPy)) {
        log('[INFO] Closing window in 10 seconds');
        setTimeout(closeStatusWindow, 10000);
    } else {
        log('[ERROR] Setup failed → App quits in 10 seconds');
        setTimeout(() => { closeStatusWindow(); app.quit(); }, 10000);
    }
}

/** 메인 윈도우 생성 */
function createWindow() {
    const win = new BrowserWindow({
        width: 1000,
        height: 700,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegrationInSubFrames: true,
            webviewTag: true
        },
    });
    win.loadFile('index.html');

    return win;
}

/** 로컬 서버 시작 */
function startLocalServer() {
    // 기존 프로세스 종료
    kill_pyhpo();

    const { testLocalServerPy, testLocalServerExe, base } = getPaths();
    let command, args;

    if (isDev) {
        // 개발 모드 - Python 스크립트 직접 실행
        command = 'python';
        args = [testLocalServerPy, '--root', __dirname];
    } else {
        // 배포 모드 - EXE 파일 실행
        command = testLocalServerExe;
        args = ['--root', base];

        // 실행 파일 존재 여부 확인
        if (!fs.existsSync(command)) {
            console.error(`[ERROR] Server executable not found at: ${command}`);
            return false;
        }
    }

    console.log('Starting local server:', command, args);

    try {
        // 환경 변수 설정
        const env = { ...process.env };

        // 실행 옵션 설정
        const options = {
            env,
            cwd: base,  // 작업 디렉토리를 base로 설정
            windowsHide: true,
            stdio: 'pipe'
        };

        // 프로세스 생성
        hpoProcess = spawn(command, args, options);

        // stdout
        hpoProcess.stdout.on('data', (data) => {
            console.log('[local-server]', data.toString());
        });

        // stderr (자세한 로그 출력)
        hpoProcess.stderr.on('data', (data) => {
            const errorMsg = data.toString();
            console.error('[local-server-error]', errorMsg);

            // 필요한 경우 여기서 오류 내용을 분석하고 대응할 수 있음
            if (errorMsg.includes('ImportError') || errorMsg.includes('ModuleNotFoundError')) {
                console.error('[ERROR] Python module import error - check dependencies');
            } else if (errorMsg.includes('Permission denied')) {
                console.error('[ERROR] Permission denied - check file permissions');
            }
        });

        // close
        hpoProcess.on('close', (code) => {
            console.log(`[local-server] process exited with code=${code}`);

            // 비정상 종료 시 재시도 (최대 3회)
            if (code !== 0 && !isDev && !hpoProcess._retryCount) {
                hpoProcess._retryCount = (hpoProcess._retryCount || 0) + 1;

                if (hpoProcess._retryCount <= 3) {
                    console.log(`[INFO] Retrying server start (attempt ${hpoProcess._retryCount})...`);
                    setTimeout(() => startLocalServer(), 1000);
                } else {
                    console.error('[ERROR] Failed to start server after multiple attempts');
                }
            }
        });

        // error
        hpoProcess.on('error', (err) => {
            console.error('[local-server] failed to start:', err);
        });

        return true;
    } catch (err) {
        console.error('[ERROR] Failed to start local server:', err);
        return false;
    }
}

/** 라이센스 관리 함수 */
async function manageLicense() {
    const { base } = getPaths();
    const licensePath = path.join(base, 'license.key');

    // 개발 모드일 경우 라이센스 생성
    if (isDev) {
        // 라이센스가 없거나 강제 갱신 원할 경우
        if (!fs.existsSync(licensePath)) {
            console.log('[INFO] Development mode: Generating license...');
            generateLicense(licensePath, 365); // 1년 유효기간의 개발 라이센스 생성
        } else {
            console.log('[INFO] Development mode: Using existing license');
        }
        //return true; // 개발 모드에서는 항상 실행 허용
    }

    // 배포 모드일 경우 라이센스 검증
    const result = validateLicense(licensePath);

    if (!result.valid) {
        // 라이센스가 유효하지 않은 경우 에러 창 표시
        const licenseWindow = new BrowserWindow({
            width: 450,
            height: 300,
            alwaysOnTop: true,
            resizable: false,
            frame: false,  // true에서 false로 변경
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true
            }
        });

        // HTML 콘텐츠 생성
        const reason = result.reason || 'Unknown error';
        const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>License Error</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    padding: 20px;
                    text-align: center;
                    background-color: #f8f8f8;
                }
                .error-box {
                    background-color: #fff;
                    border: 1px solid #ddd;
                    border-radius: 5px;
                    padding: 20px;
                    margin-top: 20px;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.1);
                }
                h2 {
                    color: #d9534f;
                    margin-top: 0;
                }
                p {
                    color: #333;
                }
                .countdown {
                    font-weight: bold;
                    margin-top: 15px;
                }
            </style>
        </head>
        <body>
            <div class="error-box">
                <h2>License Error</h2>
                <p>${reason}</p>
                <p>Application will close in <span id="countdown">10</span> seconds</p>
            </div>
            <script>
                let seconds = 10;
                const countdownElement = document.getElementById('countdown');
                
                const timer = setInterval(() => {
                    seconds--;
                    countdownElement.textContent = seconds;
                    if (seconds <= 0) {
                        clearInterval(timer);
                    }
                }, 1000);
            </script>
        </body>
        </html>
        `;

        // 데이터 URL로 HTML 콘텐츠 로드
        licenseWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

        // 10초 후 앱 종료
        setTimeout(() => {
            app.quit();
        }, 10000);

        return false;
    }

    // 라이센스가 유효한 경우, 남은 일수 계산 및 정보 창 표시
    const now = new Date();
    const expirationDate = result.expiration;
    const daysRemaining = Math.ceil((expirationDate - now) / (1000 * 60 * 60 * 24));

    // 라이센스 정보 창 생성
    return new Promise((resolve) => {
        const licenseInfoWindow = new BrowserWindow({
            width: 450,
            height: 300,
            alwaysOnTop: true,
            resizable: false,
            frame: false,  // true에서 false로 변경
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true
            }
        });

        // HTML 콘텐츠 생성
        const customer = result.licenseData?.customer || 'Licensed User';
        const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>License Information</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    padding: 20px;
                    text-align: center;
                    background-color: #f8f8f8;
                }
                .info-box {
                    background-color: #fff;
                    border: 1px solid #ddd;
                    border-radius: 5px;
                    padding: 20px;
                    margin-top: 20px;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.1);
                }
                h2 {
                    color: #28a745;
                    margin-top: 0;
                }
                p {
                    color: #333;
                }
                .daysRemaining {
                    font-size: 1.2em;
                    font-weight: bold;
                    color: ${daysRemaining <= 30 ? '#dc3545' : '#28a745'};
                }
                .countdown {
                    margin-top: 15px;
                    color: #6c757d;
                }
            </style>
        </head>
        <body>
            <div class="info-box">
                <h2>License Valid</h2>
                <p>Licensed to: ${customer}</p>
                <p>Expires on: ${expirationDate.toLocaleDateString()}</p>
                <p class="daysRemaining">Days remaining: ${daysRemaining}</p>
                <p class="countdown">This window will close in <span id="countdown">5</span> seconds</p>
            </div>
            <script>
                let seconds = 5;
                const countdownElement = document.getElementById('countdown');
                
                const timer = setInterval(() => {
                    seconds--;
                    countdownElement.textContent = seconds;
                    if (seconds <= 0) {
                        clearInterval(timer);
                    }
                }, 1000);
            </script>
        </body>
        </html>
        `;

        // 데이터 URL로 HTML 콘텐츠 로드
        licenseInfoWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

        // 5초 후 창 닫기 및 메인 창으로 진행
        setTimeout(() => {
            licenseInfoWindow.close();
            console.log(`[INFO] Valid license found, expires on: ${expirationDate.toLocaleDateString()} (${daysRemaining} days remaining)`);
            resolve(true);
        }, 5000);
    });
}

/** 앱 초기화 */
app.whenReady().then(async () => {
    try {
        // 라이센스 관리 (개발모드: 생성, 배포모드: 검증)
        const licenseValid = await manageLicense();
        if (!licenseValid) {
            return; // 라이센스가 유효하지 않으면 여기서 종료
        }

        const mainWindow = createWindow();
        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });

        // 배포 환경에서 Python env 구성
        await ensurePythonEnv();

        // 실행중인 잔여 프로세스 정리 및 서버 시작
        startLocalServer();  // 로컬 서버 시작 (추가)
        startOptunaDashboard();  // 대시보드 시작
    } catch (error) {
        console.error('Initialization error:', error);
        dialog.showErrorBox('Initialization Error',
            'An error occurred during application initialization. The application will close.');
        app.quit();
    }

    // 메뉴 템플릿
    let template = [
        { label: 'File', submenu: [{ role: 'quit' }] },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'About This App',
                    click: () => { console.log('Show about info here'); }
                }
            ]
        },
    ];
    // 개발 모드에서만 DevTools 메뉴
    if (isDev) {
        template.push({
            label: 'View',
            submenu: [
                {
                    label: 'Toggle DevTools',
                    accelerator: 'Ctrl+Shift+P',
                    click: (item, focusedWindow) => {
                        if (focusedWindow) focusedWindow.webContents.toggleDevTools();
                    },
                },
            ],
        });
    }
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
});

/** 모든 윈도우 닫히면 앱 종료 */
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

/** 종료 직전(자식 프로세스 종료) */
app.on('before-quit', async () => {
    await kill_pyhpo();
    await kill_dashboard();
});

/** 자식 프로세스 재시작 (기존 run-command를 수정) */
ipcMain.handle('run-command', async () => {
    return new Promise((resolve) => {
        const success = startLocalServer();
        resolve({ code: success ? 0 : 1 });
    });
});

/** 대시보드 preload 경로 */
ipcMain.handle('get-dashboard-preload-path', async () => {
    const { baseAsar } = getPaths();
    const p = path.join(baseAsar, 'dashboardPreload.js');

    const resolved = pathToFileURL(p).href;
    console.log('dashboard-preload-path:', resolved);
    return resolved;
});

/** optuna-dashboard 실행 */
function startOptunaDashboard() {
    const { base, pythonExe } = getPaths();
    const pythonCmd = isDev ? 'python' : pythonExe;

    // 1) DB 파일의 절대 경로를 만든 뒤, 경로 구분자를 슬래시로 치환
    let dbPath = path.join(base, 'db.sqlite3');
    dbPath = dbPath.replace(/\\/g, '/');  // Windows 역슬래시 → 슬래시

    // 2) 최종적인 SQLite 커넥션 문자열
    const dbUrl = `sqlite:///${dbPath}`;

    // 3) optuna_dashboard 스크립트 작성 (여기 indent 주면 안됨)
    const dashboardCode = `
import optuna_dashboard
optuna_dashboard.run_server('${dbUrl}', host='127.0.0.1', port=8080)
`;

    // 4) 대시보드 프로세스 스폰
    dashboardProcess = spawn(pythonCmd, ['-c', dashboardCode]);

    // 콘솔 로깅 (선택)
    dashboardProcess.stdout.on('data', (data) => console.log('[dashboard]', data.toString()));
    dashboardProcess.stderr.on('data', (data) => console.error('[dashboard]', data.toString()));
    dashboardProcess.on('close', (code) => {
        console.log(`[dashboard] process exited with code=${code}`);
        dashboardProcess = null;
    });
    dashboardProcess.on('error', (err) => {
        console.error('[dashboard] failed to start:', err);
    });
}


/** 기존 프로세스(서버/대시보드) 종료 */
async function kill_pyhpo() {
    if (hpoProcess) {
        hpoProcess.kill(); hpoProcess = null;
        console.log('[INFO] Child process terminated');
    }
    // 필요하다면 Windows에서 taskkill
    try {
        await exec('taskkill /F /IM tls.exe');
    } catch (error) {
        console.error('[ERROR] kill process:', error.message);
    }
}

/** 기존 프로세스(서버/대시보드) 종료 */
async function kill_dashboard() {
    if (dashboardProcess) {
        dashboardProcess.kill(); dashboardProcess = null;
        console.log('[INFO] Dashboard process terminated');
    }
}

/** JSON 관련 함수들 */
function getJSONPaths() {
    const p = getPaths().jsonFiles;
    return {
        config: path.join(p, 'config.json'),
        bestMetric: path.join(p, 'best_metric.json'),
        bestParams: path.join(p, 'best_params.json')
    };
}

// config.json 읽기
ipcMain.handle('load-config', async () => {
    const { config } = getJSONPaths();
    if (!fs.existsSync(config)) return [];
    try { return JSON.parse(fs.readFileSync(config, 'utf-8')); }
    catch (err) { console.error('Parsing config error:', err); return []; }
});

// config.json 저장
ipcMain.handle('save-config', async (e, data) => {
    const { config } = getJSONPaths();
    try {
        fs.writeFileSync(config, JSON.stringify(data, null, 2), 'utf-8');
        return true;
    } catch (err) {
        console.error('Saving config.json error:', err);
        throw err;
    }
});

// results.json 읽기
ipcMain.handle('load-results', async () => {
    console.error('[INFO] load-results called');
    const { bestMetric, bestParams } = getJSONPaths();
    if (!fs.existsSync(bestMetric) || !fs.existsSync(bestParams)) return [];
    try {
        const dataMetric = JSON.parse(fs.readFileSync(bestMetric, 'utf-8'));
        const dataParams = JSON.parse(fs.readFileSync(bestParams, 'utf-8'));
        return [
            "Best metric:\n" + JSON.stringify(dataMetric, null, 4),
            "\n",
            "Best params:\n" + JSON.stringify(dataParams, null, 4)
        ];
    } catch (err) {
        console.error('Parsing results error:', err);
        return [];
    }
});