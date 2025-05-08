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
    const DevPyScripts = path.join(base, 'python_scripts', 'test_local_server.py');
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
        DevPyScripts,
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
        // 작업 디렉토리를 testLocalServerPy가 있는 디렉토리로 설정
        const workingDirectory = path.dirname(testLocalServerPy);

        await exec(
            `"${pythonExe}" -m PyInstaller --add-data "${forAddData}" --onefile --console --distpath "${path.dirname(testLocalServerExe)}" "${testLocalServerPy}"`,
            { cwd: workingDirectory }
        );

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
// startLocalServer 함수를 비동기 함수로 변경
async function startLocalServer() {
    // 기존 프로세스 종료 - await를 사용하여 완전히 종료될 때까지 대기
    await kill_pyhpo();

    // 프로세스 종료 후 추가 안전 대기 시간 (ms)
    await new Promise(resolve => setTimeout(resolve, 1000));

    const { DevPyScripts, testLocalServerExe, base } = getPaths();
    let command, args;

    if (isDev) {
        // 개발 모드 - Python 스크립트 직접 실행
        command = 'python';
        args = [DevPyScripts, '--root', __dirname];
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
            cwd: path.dirname(command), // 실행 파일이 있는 디렉토리로 변경
            windowsHide: true,
            stdio: 'pipe'
        };

        // 프로세스 생성
        hpoProcess = spawn(command, args, options);

        // 재시도 횟수를 프로세스 객체가 아닌 외부 변수로 관리
        if (!global.serverRetryCount) {
            global.serverRetryCount = 0;
        }

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
            if (code !== 0 && !isDev) {
                global.serverRetryCount++;
                console.log(`[INFO] Server retry count: ${global.serverRetryCount}`);

                if (global.serverRetryCount <= 3) {
                    console.log(`[INFO] Retrying server start (attempt ${global.serverRetryCount})...`);
                    setTimeout(() => startLocalServer(), 1000);
                } else {
                    console.error('[ERROR] Failed to start server after multiple attempts');
                    // 사용자에게 오류 알림
                    dialog.showErrorBox('Server Error',
                        'Failed to start the local server after multiple attempts. The application may not function correctly.');
                    global.serverRetryCount = 0; // 재설정
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

        // 배포 환경에서 Python env 구성
        await ensurePythonEnv();

        // 실행중인 잔여 프로세스 정리 및 서버 시작
        startLocalServer();  // 로컬 서버 시작 (추가)
        startOptunaDashboard();  // 대시보드 시작

        const mainWindow = createWindow();
        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });

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

    // 정렬 프로세스 종료
    if (alignmentProcess) {
        alignmentProcess.kill();
        alignmentProcess = null;
        console.log('[INFO] Alignment process terminated');
    }
});

/** XFeat 이미지 정렬 실행 */
let alignmentProcess = null;
async function runXFeatAligner(baseLinePath, otherLinePath, event) {
    // 기존 프로세스 종료
    if (alignmentProcess) {
        alignmentProcess.kill();
        alignmentProcess = null;
    }

    const { base, pyScripts, pythonExe } = getPaths();
    const alignerScript = path.join(base, 'python_scripts', 'xfeat_aligner.py');

    // 명령어 및 인수 설정
    let command, args;
    if (isDev) {
        // 개발 모드 - Python 스크립트 직접 실행
        command = 'python';
    } else {
        // 배포 모드
        command = pythonExe;
    }
    args = [alignerScript, baseLinePath, otherLinePath, '--root', path.join(base, 'python_scripts')];

    console.log('Starting XFeat alignment:', command, args);

    try {
        // 환경 변수 설정
        const env = { ...process.env };

        // 실행 옵션 설정
        const options = {
            env,
            cwd: path.dirname(command),
            windowsHide: true,
            stdio: 'pipe'
        };

        // 프로세스 생성
        alignmentProcess = spawn(command, args, options);

        // stdout - 진행 상황 처리
        alignmentProcess.stdout.on('data', (data) => {
            const output = data.toString().trim();
            console.log('[xfeat-aligner]', output);

            // JSON 형식의 진행 상황 파싱 및 전달
            try {
                const progressData = JSON.parse(output);
                if (progressData.progress !== undefined) {
                    // 진행 상황을 렌더러 프로세스로 전송
                    if (event && event.sender) {
                        event.sender.send('alignment:progress', progressData.progress);
                    }
                }
            } catch (e) {
                // JSON이 아닌 일반 출력은 무시
            }
        });

        // stderr
        alignmentProcess.stderr.on('data', (data) => {
            const errorMsg = data.toString();
            console.error('[xfeat-aligner-error]', errorMsg);
        });

        // close
        alignmentProcess.on('close', (code) => {
            console.log(`[xfeat-aligner] process exited with code=${code}`);
            alignmentProcess = null;

            // 완료 또는 오류 상태를 렌더러 프로세스로 전송
            if (event && event.sender) {
                event.sender.send('alignment:complete', {
                    success: code === 0,
                    error: code !== 0 ? `Process exited with code ${code}` : null
                });
            }
        });

        // error
        alignmentProcess.on('error', (err) => {
            console.error('[xfeat-aligner] failed to start:', err);
            if (event && event.sender) {
                event.sender.send('alignment:complete', {
                    success: false,
                    error: err.message
                });
            }
        });

        return true;
    } catch (err) {
        console.error('[ERROR] Failed to start XFeat aligner:', err);
        if (event && event.sender) {
            event.sender.send('alignment:complete', {
                success: false,
                error: err.message
            });
        }
        return false;
    }
}

/** 자식 프로세스 재시작 (기존 run-command를 수정) */
ipcMain.handle('run-command', async () => {
    try {
        const success = await startLocalServer(); // await 추가
        return { code: success ? 0 : 1 };
    } catch (error) {
        console.error('[ERROR] run-command handler error:', error);
        return { code: 1, error: error.message };
    }
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
    let killPromises = [];

    // 1. 내부적으로 관리하는 프로세스 종료
    if (hpoProcess) {
        const killPromise = new Promise((resolve) => {
            hpoProcess.on('close', () => {
                console.log('[INFO] Child process terminated via kill()');
                resolve();
            });

            hpoProcess.kill();
            hpoProcess = null;
        });

        // 최대 2초까지만 대기 (무한정 대기하지 않도록)
        const timeoutPromise = new Promise(resolve => setTimeout(resolve, 2000));
        killPromises.push(Promise.race([killPromise, timeoutPromise]));
    }

    // 2. 외부 실행 중인 tls.exe 프로세스 종료
    try {
        // taskkill 명령이 완료될 때까지 대기
        const { stdout, stderr } = await exec('taskkill /F /IM tls.exe');
        console.log('[INFO] taskkill result:', stdout);
        if (stderr) console.error('[INFO] taskkill stderr:', stderr);
    } catch (error) {
        // 프로세스가 없는 경우에도 에러가 발생하지만 무시해도 됨
        if (error.message.includes('not found')) {
            console.log('[INFO] No tls.exe process found to kill');
        } else {
            console.error('[ERROR] kill process:', error.message);
        }
    }

    // 모든 종료 작업 완료 대기
    await Promise.all(killPromises);

    // 추가 안전 대기
    await new Promise(resolve => setTimeout(resolve, 500));

    return true;
}

/** HPO 대시보드 종료 */
async function kill_dashboard() {
    if (dashboardProcess) {
        dashboardProcess.kill();
        dashboardProcess = null;
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    return true;
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

// IPC handlers for IQGen features
ipcMain.handle('dialog:openDirectory', async (event, options) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        ...options
    });
    return { canceled, filePaths };
});

// XFeat 이미지 정렬 실행 핸들러
ipcMain.on('image:align', (event, { baseLinePath, otherLinePath }) => {
    runXFeatAligner(baseLinePath, otherLinePath, event);
});

// HPO ONNX 실행 핸들러
ipcMain.on('hpo:run', (event, { baseLinePath, otherLinePath }) => {
    runHpoOnnx(baseLinePath, otherLinePath, event);
});

// HPO 상태 확인 핸들러
ipcMain.handle('hpo:checkStatus', () => {
    return {
        isRunning: hpoOnnxProcess !== null
    };
});

// HPO 프로세스 강제 종료 핸들러
ipcMain.handle('hpo:kill', async () => {
    try {
        if (hpoOnnxProcess) {
            console.log('[INFO] Killing HPO process by user request');

            // 프로세스 종료
            const killPromise = new Promise((resolve) => {
                hpoOnnxProcess.on('close', () => {
                    console.log('[INFO] HPO process terminated via kill()');
                    resolve(true);
                });

                hpoOnnxProcess.kill();
            });

            // 최대 3초 타임아웃
            const timeoutPromise = new Promise(resolve =>
                setTimeout(() => {
                    console.log('[INFO] HPO process kill timeout');
                    resolve(false);
                }, 3000)
            );

            // 종료 결과
            const killResult = await Promise.race([killPromise, timeoutPromise]);

            // 프로세스 참조 해제
            hpoOnnxProcess = null;

            return { success: true, timeout: !killResult };
        } else {
            console.log('[INFO] No HPO process to kill');
            return { success: true, notRunning: true };
        }
    } catch (error) {
        console.error('[ERROR] Failed to kill HPO process:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('dialog:showMessageBox', async (event, options) => {
    return await dialog.showMessageBox(options);
});

ipcMain.handle('fs:readDirectory', async (event, dirPath) => {
    try {
        return await fs.promises.readdir(dirPath);
    } catch (error) {
        console.error('Error reading directory:', error);
        throw error;
    }
});

// Check if a directory exists
ipcMain.handle('fs:directoryExists', async (event, dirPath) => {
    try {
        const stats = await fs.promises.stat(dirPath);
        return stats.isDirectory();
    } catch (error) {
        return false;
    }
});

// 이미지 처리 핸들러
ipcMain.handle('image:process', async (event, { sourcePath, targetPath }) => {
    try {
        // 여기에 이미지 처리 로직 구현
        // 예: 이미지 복사, 변환 등
        console.log(`이미지 처리: ${sourcePath} -> ${targetPath}`);
        return { success: true, message: '이미지 처리 완료' };
    } catch (error) {
        console.error('이미지 처리 오류:', error);
        return { success: false, message: error.message };
    }
});

// 모델 배포 핸들러
ipcMain.handle('model:deploy', async (event, ...args) => {
    try {
        console.log('model:deploy 핸들러 호출됨, 인자 개수:', args.length);
        console.log('인자 타입들:', args.map(arg => typeof arg));

        // 첫 번째 인자를 options로 사용
        let options = args[0];

        // 디버깅을 위해 전체 options 객체 로깅
        console.log('모델 배포 요청 받음, 옵션 타입:', typeof options);
        console.log('옵션 내용:', options);

        // options가 null 또는 undefined인 경우 빈 객체로 초기화
        if (!options) {
            options = {};
            console.error('옵션 객체가 null 또는 undefined입니다.');
        }

        // 중첩된 구조 처리 (sourcePath 내부에 실제 옵션이 있는 경우)
        if (options.sourcePath && typeof options.sourcePath === 'object') {
            console.log('중첩된 옵션 구조 발견, sourcePath 내부 값을 사용합니다.');
            options = options.sourcePath;
        }

        // options 객체에서 필요한 값 추출
        const sourceFiles = options.sourceFiles || [];
        const destinationPath = options.destinationPath || '';
        const bestParams = options.bestParams;

        console.log('모델 배포 시작:', {
            sourceFilesCount: Array.isArray(sourceFiles) ? sourceFiles.length : 'not an array',
            destinationPath: destinationPath || 'not provided',
            hasBestParams: !!bestParams
        });

        // 필수 매개변수 검증
        if (!destinationPath) {
            throw new Error('대상 경로가 지정되지 않았습니다.');
        }

        if (!sourceFiles || !Array.isArray(sourceFiles) || sourceFiles.length === 0) {
            throw new Error('복사할 소스 파일이 지정되지 않았습니다.');
        }

        // 대상 디렉토리가 존재하는지 확인
        if (!fs.existsSync(destinationPath)) {
            console.log(`디렉토리 생성: ${destinationPath}`);
            fs.mkdirSync(destinationPath, { recursive: true });
        }

        // 애플리케이션 기본 경로 가져오기
        const { base } = getPaths();
        console.log('애플리케이션 기본 경로:', base);

        // 파일 복사 함수
        const copyFile = async (sourcePath, destPath) => {
            return new Promise((resolve, reject) => {
                // 소스 파일이 존재하는지 확인
                if (!fs.existsSync(sourcePath)) {
                    reject(new Error(`소스 파일이 존재하지 않습니다: ${sourcePath}`));
                    return;
                }

                // 파일 복사
                const readStream = fs.createReadStream(sourcePath);
                const writeStream = fs.createWriteStream(destPath);

                readStream.on('error', (err) => {
                    reject(new Error(`파일 읽기 오류: ${err.message}`));
                });

                writeStream.on('error', (err) => {
                    reject(new Error(`파일 쓰기 오류: ${err.message}`));
                });

                writeStream.on('finish', () => {
                    resolve();
                });

                readStream.pipe(writeStream);
            });
        };

        // 1. 소스 파일들 복사
        for (const sourceFile of sourceFiles) {
            // 상대 경로를 절대 경로로 변환
            const absoluteSourcePath = path.join(base, sourceFile);
            const fileName = path.basename(sourceFile);
            const destPath = path.join(destinationPath, fileName);

            console.log(`파일 복사: ${absoluteSourcePath} -> ${destPath}`);
            await copyFile(absoluteSourcePath, destPath);
        }

        // 2. Best parameters를 JSON 파일로 저장
        if (bestParams) {
            const bestParamsPath = path.join(destinationPath, 'best_params.json');
            fs.writeFileSync(bestParamsPath, bestParams);
            console.log(`최적 파라미터 저장: ${bestParamsPath}`);
        }

        return { success: true, message: '모델 배포 완료' };
    } catch (error) {
        console.error('모델 배포 오류:', error);
        return { success: false, error: error.message };
    }
});

// 로그 메시지 수신 핸들러
ipcMain.on('log:message', (event, message) => {
    console.log(`IQGen 로그: ${message}`);
});

// Get path to IQGen preload script
ipcMain.handle('getIQGenPreloadPath', () => {
    return path.join(__dirname, 'preload-iqgen.js');
});

/** HPO ONNX 스크립트 실행 함수 */
let hpoOnnxProcess = null;
async function runHpoOnnx(baseLinePath, otherLinePath, event) {
    // 기존 프로세스 종료
    if (hpoOnnxProcess) {
        hpoOnnxProcess.kill();
        hpoOnnxProcess = null;
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    const { base } = getPaths();
    // 개발 모드에서는 테스트 스크립트 사용, 그렇지 않으면 실제 스크립트 사용
    const scriptPath = isDev
        ? path.join(base, 'python_scripts', 'hpo_client.py')
        : path.join(base, 'python_scripts', 'hpo_client.py');

    // 명령어 및 인수 설정
    let command, args;
    if (isDev) {
        // 개발 모드 - Python 스크립트 직접 실행
        command = 'python';
    } else {
        // 배포 모드
        const { pythonExe } = getPaths();
        command = pythonExe;
    }
    args = [scriptPath, baseLinePath, otherLinePath, '--root', path.join(base, 'python_scripts')];

    console.log('Starting HPO ONNX process:', command, args);

    try {
        // 환경 변수 설정
        const env = { ...process.env };

        // 실행 옵션 설정
        const options = {
            env,
            cwd: path.dirname(command),
            windowsHide: true,
            stdio: 'pipe'
        };

        // 프로세스 생성
        hpoOnnxProcess = spawn(command, args, options);

        // stdout - 진행 상황 처리
        hpoOnnxProcess.stdout.on('data', (data) => {
            const output = data.toString().trim();
            console.log('[hpo-onnx]', output);

            // JSON 형식의 진행 상황 파싱 및 전달
            try {
                // 한 줄에 여러 JSON 객체가 있을 수 있으므로 분리하여 처리
                const lines = output.split('\n');

                for (const line of lines) {
                    if (!line.trim()) continue;

                    try {
                        const progressData = JSON.parse(line.trim());

                        // 진행 상황, study_id 등 처리
                        if (event && event.sender && !event.sender.isDestroyed()) {
                            console.log('Sending progress data to renderer:', progressData);
                            event.sender.send('hpo:progress', progressData);
                        }
                    } catch (parseError) {
                        console.log('Non-JSON output:', line);
                    }
                }
            } catch (e) {
                console.error('Error processing HPO output:', e);
            }
        });

        // stderr
        hpoOnnxProcess.stderr.on('data', (data) => {
            const errorMsg = data.toString();
            console.error('[hpo-onnx-error]', errorMsg);

            // stdout에서 처리하지 못한 study_id 정보가 stderr에 있는지 확인
            try {
                // study_id를 찾기 위한 정규식
                const studyIdMatch = errorMsg.match(/Study\s+ID:\s+(\d+)/i);
                if (studyIdMatch && studyIdMatch[1]) {
                    const studyId = studyIdMatch[1];
                    console.log('Found study_id in stderr:', studyId);

                    if (event && event.sender && !event.sender.isDestroyed()) {
                        event.sender.send('hpo:progress', {
                            study_id: studyId
                        });
                    }
                }
            } catch (e) {
                // 에러 처리 무시
            }
        });

        // close
        hpoOnnxProcess.on('close', (code) => {
            console.log(`[hpo-onnx] process exited with code=${code}`);

            // 완료 메시지 전송 (100% 진행율)
            if (event && event.sender && !event.sender.isDestroyed()) {
                event.sender.send('hpo:progress', {
                    progress: 100,
                    status: 'complete',
                    success: code === 0,
                    error: code !== 0 ? `Process exited with code ${code}` : null
                });
            }

            hpoOnnxProcess = null;
        });

        // error
        hpoOnnxProcess.on('error', (err) => {
            console.error('[hpo-onnx] failed to start:', err);
            if (event && event.sender && !event.sender.isDestroyed()) {
                event.sender.send('hpo:progress', {
                    progress: 0,
                    status: 'error',
                    success: false,
                    error: err.message
                });
            }
        });

        return true;
    } catch (err) {
        console.error('[ERROR] Failed to start HPO ONNX:', err);
        if (event && event.sender && !event.sender.isDestroyed()) {
            event.sender.send('hpo:progress', {
                progress: 0,
                status: 'error',
                success: false,
                error: err.message
            });
        }
        return false;
    }
}

/** 일반 Python 스크립트 실행 (dist_onnx.py 등) */
async function runPythonScript(options) {
    const { scriptName, args = [] } = options;
    const { base } = getPaths();

    // Python 스크립트 경로 설정
    const scriptPath = path.join(base, 'python_scripts', scriptName);

    // 명령어 및 인수 설정
    let command, scriptArgs;
    if (isDev) {
        // 개발 모드 - Python 스크립트 직접 실행
        command = 'python';
    } else {
        // 배포 모드
        const { pythonExe } = getPaths();
        command = pythonExe;
    }

    // 스크립트 인수 구성 - args 배열에 --root 인수 추가
    scriptArgs = [scriptPath, ...args, '--root', path.join(base, 'python_scripts')];
    console.log(`Running Python script: ${command} ${scriptArgs.join(' ')}`);

    // 환경 변수를 Promise 밖에서 미리 추출
    const processEnv = Object.assign({}, process.env);

    // 실행 옵션 설정을 Promise 밖에서 미리 준비
    const spawnOptions = {
        env: processEnv,
        cwd: path.dirname(command),
        windowsHide: true
    };

    return new Promise((resolve, reject) => {
        try {
            // 프로세스 생성 및 실행 - 미리 준비된 환경 변수와 옵션 사용
            const childProcess = spawn(command, scriptArgs, spawnOptions);

            let stdoutData = '';
            let stderrData = '';

            // stdout 데이터 수집
            childProcess.stdout.on('data', (data) => {
                const output = data.toString();
                console.log(`[${scriptName}]`, output);
                stdoutData += output;

                // 진행 상황 데이터 파싱 시도
                try {
                    // 각 줄을 분리하여 JSON 형식의 진행 상황 데이터 찾기
                    const lines = output.trim().split('\n');
                    for (const line of lines) {
                        try {
                            if (!line.trim()) continue;

                            const jsonData = JSON.parse(line.trim());
                            // progress 필드가 있으면 진행 상황 데이터로 간주
                            if (jsonData && jsonData.progress !== undefined) {
                                // 요청한 윈도우에 직접 진행 상황 이벤트 전송
                                if (options.event && options.event.sender && !options.event.sender.isDestroyed()) {
                                    options.event.sender.send('python:progress', line.trim());
                                } else {
                                    // 모든 창에 진행 상황 이벤트 전송
                                    const windows = BrowserWindow.getAllWindows();
                                    for (const win of windows) {
                                        if (!win.isDestroyed() && win.webContents) {
                                            console.log(`[${scriptName}] Sending progress: ${jsonData.progress}% to window`);
                                            try {
                                                win.webContents.send('python:progress', line.trim());
                                            } catch (sendError) {
                                                console.error('Error sending progress event:', sendError);
                                            }
                                        }
                                    }
                                }
                            }
                        } catch (e) {
                            // JSON 파싱 오류는 무시 (일반 텍스트 출력일 수 있음)
                        }
                    }
                } catch (e) {
                    console.error('Error parsing progress data:', e);
                }
            });

            // stderr 데이터 수집
            childProcess.stderr.on('data', (data) => {
                const errorOutput = data.toString();
                console.error(`[${scriptName}-error]`, errorOutput);
                stderrData += errorOutput;
            });

            // 프로세스 완료 처리
            childProcess.on('close', (code) => {
                console.log(`[${scriptName}] process exited with code ${code}`);

                if (code === 0) {
                    resolve({
                        success: true,
                        stdout: stdoutData,
                        stderr: stderrData
                    });
                } else {
                    resolve({
                        success: false,
                        error: `Process exited with code ${code}`,
                        stdout: stdoutData,
                        stderr: stderrData
                    });
                }
            });

            // 프로세스 시작 오류 처리
            childProcess.on('error', (err) => {
                console.error(`[${scriptName}] failed to start:`, err);
                resolve({
                    success: false,
                    error: err.message
                });
            });
        } catch (error) {
            console.error(`[ERROR] Failed to run ${scriptName}:`, error);
            resolve({
                success: false,
                error: error.message
            });
        }
    });
}

/** Python 스크립트 실행 핸들러 */
ipcMain.handle('python:run', async (event, options) => {
    try {
        // 이벤트 객체 전달하여 진행 상황을 해당 윈도우로 직접 전송할 수 있도록 함
        options.event = event;
        return await runPythonScript(options);
    } catch (error) {
        console.error('[ERROR] python:run handler error:', error);
        return { success: false, error: error.message };
    }
});