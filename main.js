const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const unzipper = require('unzipper');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const { pathToFileURL } = require('url');

const { openStatusWindow, updateStatusWindow, closeStatusWindow } = require('./statusWindow.js');

const isDev = !app.isPackaged;
let hpoProcess = null;      // Python 서버 프로세스
let dashboardProcess = null;  // optuna-dashboard 프로세스

/** 공통 경로들(개발/배포) 정리 */
function getPaths() {
    const base = isDev ? __dirname : process.resourcesPath;
    const baseAsar = isDev ? __dirname : path.join(process.resourcesPath, 'app.asar');
    const pyScripts = path.join(base, 'python_scripts');
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
        testLocalServerPy: path.join(pyScripts, 'test_local_server.py'),
        testLocalServerExe: path.join(pyScripts, 'test_local_server.exe'),
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
}

/** 앱 초기화 */
app.whenReady().then(async () => {
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    // 배포 환경에서 Python env 구성
    await ensurePythonEnv();

    // 실행중인 잔여 프로세스 정리 후 대시보드 실행
    startOptunaDashboard();

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

/** 자식 프로세스 실행 */
ipcMain.handle('run-command', async (event, _cmd, _args, n_trials) => {
    await kill_pyhpo();

    const { testLocalServerPy, testLocalServerExe, base } = getPaths();
    let command, args;
    if (isDev) {
        // Linux python 경로 예시. (적절히 수정)
        command = 'python';
        args = [testLocalServerPy, '--root', __dirname];
    } else {
        command = testLocalServerExe;
        args = ['--root', base];
    }
    args.push('--n_trials', n_trials);

    console.log('Spawn:', command, args);

    return new Promise((resolve, reject) => {
        try {
            hpoProcess = spawn(command, args);
            hpoProcess.stdout.on('data', (data) => event.sender.send('command-stdout', data.toString()));
            hpoProcess.stderr.on('data', (data) => event.sender.send('command-stderr', data.toString()));
            hpoProcess.on('close', (code) => { event.sender.send('command-close', code); resolve({ code }); });
            hpoProcess.on('error', (err) => { event.sender.send('command-error', err.message); reject(err); });
        } catch (err) {
            reject(err);
        }
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
        await exec('taskkill /F /IM test_local_server.exe');
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
