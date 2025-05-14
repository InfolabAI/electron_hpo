const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Seven = require('node-7z');
const sevenBin = require('7zip-bin');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const { pathToFileURL } = require('url');
const events = require('events');

// 최대 이벤트 리스너 수 증가 (기본값 10 → 20)
events.EventEmitter.defaultMaxListeners = 20;

// 전역 변수로 statusWindow 선언 (모듈에서 import 하더라도 같은 객체 참조)
global.statusWindow = null;
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

    const { zipFile, pyEnvDir, testLocalServerPy, pythonExe } = getPaths();

    // 환경 설정 상태 확인
    const envExists = fs.existsSync(pyEnvDir);
    const pyExists = fs.existsSync(testLocalServerPy);

    // 이미 완전히 설정되어 있는 경우 (환경 존재 + Python 스크립트 존재)
    if (envExists && pyExists) {
        console.log('[INFO] Python environment already configured');
        return;
    }

    // Python 환경 디렉토리가 없는 경우 압축 해제 필요
    if (!envExists) {
        console.log('[INFO] Python env not found');

        // 상태창 초기화 (오류 방지를 위해 시작 시 상태창이 없는 경우 생성)
        if (!global.statusWindow) {
            openStatusWindow('환경 초기화 중...');
        } else {
            updateStatusWindow('환경 초기화 중...');
        }

        // 1) Python 압축 해제 - 직접 7z 명령어 실행
        updateStatusWindow('Python 환경 구성 중...');
        try {
            // 7-Zip 바이너리 경로 확인 - OS별 처리
            let zipPath;
            if (process.platform === 'linux') {
                // Linux 환경
                if (isDev) {
                    // 개발 모드에서는 node_modules 내부 경로 사용
                    zipPath = path.join(process.cwd(), 'node_modules/7zip-bin/linux/x64/7za');
                } else {
                    // 배포 모드에서는 리소스 내에 포함된 7za 사용
                    zipPath = path.join(process.resourcesPath, '7zip', 'linux', 'x64', '7za');
                }
            } else if (process.platform === 'win32') {
                // Windows 환경
                if (isDev) {
                    // 개발 모드에서는 node_modules 내부 경로 사용
                    zipPath = path.join(process.cwd(), 'node_modules/7zip-bin/win/x64/7z.exe');
                } else {
                    // 배포 모드에서는 리소스 내에 포함된 7za.exe 사용
                    zipPath = path.join(process.resourcesPath, '7zip', 'win', 'x64', '7za.exe');
                    // 추가 대체 경로 설정 - 파일이 존재하지 않으면 app.asar 내부 검색
                    if (!fs.existsSync(zipPath)) {
                        const appPath = app.getAppPath();
                        zipPath = path.join(path.dirname(appPath), '7zip', 'win', 'x64', '7za.exe');
                    }
                }
            } else if (process.platform === 'darwin') {
                // macOS 환경
                if (isDev) {
                    // 개발 모드에서는 node_modules 내부 경로 사용
                    zipPath = path.join(process.cwd(), 'node_modules/7zip-bin/mac/x64/7za');
                } else {
                    // 배포 모드에서는 리소스 내에 포함된 7za 사용
                    zipPath = path.join(process.resourcesPath, '7zip', 'mac', 'x64', '7za');
                }
            } else {
                // 기타 OS는 path7 사용 시도 (개발 모드에서만 가능)
                zipPath = sevenBin.path7;
            }

            console.log(`[INFO] Using 7-Zip at: ${zipPath}`);
            updateStatusWindow(`7-Zip 경로: ${zipPath}`);

            // 7z 실행 파일이 존재하는지 확인 (없으면 오류)
            if (!fs.existsSync(zipPath)) {
                // 추가 대체 검색 - resources 폴더 내 다른 위치 확인
                const resourcesDir = process.resourcesPath;
                let found = false;

                // resources 디렉토리가 있는지 먼저 확인
                if (fs.existsSync(resourcesDir)) {
                    console.log(`[INFO] Searching for 7z in: ${resourcesDir}`);

                    // 첫 번째 대체 경로: resources 루트에 직접 복사한 경우
                    const alternativePath1 = path.join(resourcesDir, '7z.exe');
                    if (fs.existsSync(alternativePath1)) {
                        zipPath = alternativePath1;
                        found = true;
                        console.log(`[INFO] Found 7z at alternative location: ${zipPath}`);
                    }

                    // 두 번째 대체 경로: resources/7zip 폴더
                    if (!found) {
                        const alternativePath2 = path.join(resourcesDir, '7zip', '7z.exe');
                        if (fs.existsSync(alternativePath2)) {
                            zipPath = alternativePath2;
                            found = true;
                            console.log(`[INFO] Found 7z at alternative location: ${zipPath}`);
                        }
                    }
                }

                // 여전히 찾지 못했다면 오류 발생
                if (!found) {
                    throw new Error(`7-Zip executable not found at: ${zipPath}. Please ensure 7z.exe is included in the resources folder.`);
                }
            }

            // 압축 풀기 경로가 없으면 생성
            fs.mkdirSync(pyEnvDir, { recursive: true });
            updateStatusWindow('압축 해제를 시작합니다...');

            // 압축 파일 크기 확인
            const zipStat = fs.statSync(zipFile);
            const zipSizeInMB = zipStat.size / (1024 * 1024);
            console.log(`[INFO] Zip file size: ${zipSizeInMB.toFixed(2)} MB`);

            // 시작 시간 기록
            const startTime = Date.now();

            // node-7z 대신 직접 7z 명령어 실행하여 폴더 구조 유지
            const { spawn } = require('child_process');

            // 명령어 구성 (OS에 따라 달라짐)
            const args = ['x', zipFile, `-o${pyEnvDir}`, '-y', '-bsp1'];  // -bsp1 옵션 추가: 진행 상황 표시 활성화
            console.log(`[INFO] Executing command: ${zipPath} ${args.join(' ')}`);
            updateStatusWindow(`7z 명령어 실행: ${zipPath} ${args.join(' ')}`);

            // 프로세스 생성 및 실행
            const extractProcess = spawn(zipPath, args);

            // 파일 추출 카운트
            let extractedFiles = 0;
            let totalFiles = 0;

            // 진행 상황 업데이트를 위한 타이머 설정
            const updateInterval = 500; // 0.5초마다 업데이트
            let lastUpdate = 0;
            let manualProgressTimer = null;

            // 수동 진행률 업데이트 함수
            const updateManualProgress = () => {
                const elapsedTime = Date.now() - startTime;
                const elapsedSec = elapsedTime / 1000;

                // 시간 기반 진행률 추정 (최대 99%)
                // 압축 해제 예상 소요 시간 기반 (약 2GB 압축 파일 = 약 3분)
                const estimatedTotalTime = zipSizeInMB * 0.09; // 예상 시간(초) = 파일 크기(MB) * 계수
                let timeBasedPercentage = Math.min(Math.floor((elapsedSec / estimatedTotalTime) * 100), 99);

                // 추출된 파일 기반 진행률 (만약 totalFiles이 알려진 경우)
                let fileBasedPercentage = 0;
                if (totalFiles > 0) {
                    fileBasedPercentage = Math.min(Math.floor((extractedFiles / totalFiles) * 100), 99);
                }

                // 두 진행률 중 큰 값 사용
                const progressPercentage = Math.max(timeBasedPercentage, fileBasedPercentage);

                // 프로그레스 바 생성 (30칸 길이)
                const barLength = 30;
                const completeLength = Math.floor(progressPercentage / 100 * barLength);
                const remainingLength = barLength - completeLength;
                const bar = '█'.repeat(completeLength) + '░'.repeat(remainingLength);

                // 콘솔에 프로그레스 바 표시
                process.stdout.write(`\r[INFO] 압축 해제 진행률(추정): [${bar}] ${progressPercentage}% (${extractedFiles}/${totalFiles || '?'} 파일, ${elapsedSec.toFixed(1)}초)`);

                // 상태창에 진행 상황 표시
                updateStatusWindow({
                    progress: progressPercentage,
                    message: `압축 해제 진행 중: ${progressPercentage}% (${extractedFiles}/${totalFiles || '?'} 파일)`
                });
            };

            // 주기적으로 진행률 업데이트
            manualProgressTimer = setInterval(updateManualProgress, updateInterval);

            // 압축 해제 진행 상황 처리
            extractProcess.stdout.on('data', (data) => {
                const output = data.toString().trim();

                // - "Extracting  xxxx.dll" 형식으로 출력되므로, 파일 카운트하기
                if (output.includes('Extracting')) {
                    extractedFiles++;

                    // 줄바꿈 문자로 분리하고 각 라인이 파일 추출을 나타내는지 확인
                    const lines = output.split('\n');
                    for (const line of lines) {
                        if (line.trim().startsWith('Extracting')) {
                            extractedFiles++;
                        }
                    }
                }

                // 전체 파일 수를 찾기 위한 패턴: "x files"
                const filesMatch = output.match(/(\d+)\s+files/i);
                if (filesMatch && filesMatch[1]) {
                    totalFiles = parseInt(filesMatch[1], 10);
                    console.log(`[INFO] 압축 파일 내 총 파일 수: ${totalFiles}`);
                }

                // 백분율 직접 파싱 시도 - "xx%" 형태로 출력되는 경우가 있는지 확인
                const percentMatch = output.match(/(\d+)%/);
                if (percentMatch && percentMatch[1]) {
                    const percentage = parseInt(percentMatch[1], 10);
                    if (!isNaN(percentage)) {
                        // 프로그레스 바 생성 (30칸 길이)
                        const barLength = 30;
                        const completeLength = Math.floor(percentage / 100 * barLength);
                        const remainingLength = barLength - completeLength;
                        const bar = '█'.repeat(completeLength) + '░'.repeat(remainingLength);

                        // 콘솔에 프로그레스 바 표시
                        process.stdout.write(`\r[INFO] 압축 해제 진행률: [${bar}] ${percentage}%`);

                        // 상태창에 진행 상황 표시
                        updateStatusWindow({
                            progress: percentage,
                            message: `압축 해제 진행 중: ${percentage}%`
                        });
                    }
                }

                // 디버깅을 위해 모든 출력 로깅
                if (output) {
                    console.log(`[7z] ${output}`);
                }
            });

            // 에러 출력 처리
            extractProcess.stderr.on('data', (data) => {
                const errorMsg = data.toString().trim();
                console.error(`[7z Error] ${errorMsg}`);
                updateStatusWindow({
                    message: `압축 해제 오류: ${errorMsg}`
                });
            });

            // 압축 해제 완료 처리
            await new Promise((resolve, reject) => {
                extractProcess.on('close', (code) => {
                    // 타이머 중지
                    if (manualProgressTimer) {
                        clearInterval(manualProgressTimer);
                        manualProgressTimer = null;
                    }

                    if (code === 0) {
                        console.log('\n[INFO] Python 환경 압축 해제 완료');
                        process.stdout.write('\n');

                        // 소요 시간 계산
                        const elapsedTime = (Date.now() - startTime) / 1000;
                        console.log(`[INFO] 압축 해제 소요 시간: ${elapsedTime.toFixed(2)}초`);

                        updateStatusWindow({
                            progress: 100,
                            message: `압축 해제 완료! (${elapsedTime.toFixed(1)}초 소요)`
                        });

                        // 해제 후 폴더 구조 정리 - 필요한 경우 폴더 구조 수정
                        fixFolderStructureIfNeeded(pyEnvDir);

                        resolve();
                    } else {
                        const errMsg = `7-Zip process exited with code ${code}`;
                        console.error(`[ERROR] ${errMsg}`);

                        updateStatusWindow({
                            progress: 100,
                            message: `압축 해제 실패: 프로세스 종료 코드 ${code}`
                        });

                        // 오류 발생 시 상태창 업데이트
                        if (global.statusWindow) {
                            global.statusWindow.webContents.executeJavaScript(`
                            document.getElementById('statusText').textContent = '압축 해제 실패: 프로세스 종료 코드 ${code}';
                            document.getElementById('statusText').classList.add('error');
                        `).catch(console.error);
                        }

                        reject(new Error(errMsg));
                    }
                });

                extractProcess.on('error', (err) => {
                    // 타이머 중지
                    if (manualProgressTimer) {
                        clearInterval(manualProgressTimer);
                        manualProgressTimer = null;
                    }

                    console.error(`[ERROR] 압축 해제 실패: ${err}`);

                    updateStatusWindow({
                        progress: 100,
                        message: `압축 해제 실패: ${err.message}`
                    });

                    // 오류 발생 시 상태창 업데이트
                    if (global.statusWindow) {
                        global.statusWindow.webContents.executeJavaScript(`
                        document.getElementById('statusText').textContent = '압축 해제 실패: ${err.message.replace(/'/g, "\\'")}';
                        document.getElementById('statusText').classList.add('error');
                    `).catch(console.error);
                    }

                    reject(err);
                });
            });

        } catch (err) {
            console.error('[ERROR] Decompression failed:', err.message);
            updateStatusWindow({
                progress: 100,
                message: `압축 해제 실패: ${err.message}`
            });

            // 오류 발생 시 상태창 업데이트
            if (global.statusWindow) {
                global.statusWindow.webContents.executeJavaScript(`
                document.getElementById('statusText').classList.add('error');
            `).catch(console.error);
            }

            // 압축 해제 실패 시 앱 종료
            console.log('[ERROR] Setup failed → App quits in 10 seconds');
            setTimeout(() => { closeStatusWindow(); app.quit(); }, 10000);
            return;
        }
    }

    // 최종 검증
    const finalEnvExists = fs.existsSync(pyEnvDir);
    const finalPyExists = fs.existsSync(testLocalServerPy);

    if (finalEnvExists && finalPyExists) {
        console.log('[INFO] Python environment setup completed');
        // 이미 표시되고 있는 상태창이 있으면 닫기
        if (global.statusWindow) {
            console.log('[INFO] Closing status window in 5 seconds');
            setTimeout(closeStatusWindow, 5000);
        }
    } else {
        console.log('[ERROR] Setup incomplete - required components missing');
        updateStatusWindow({
            progress: 100,
            message: `설정 실패: 필요한 구성 요소가 없습니다.`
        });
        console.log('[ERROR] Setup failed → App quits in 10 seconds');
        setTimeout(() => { closeStatusWindow(); app.quit(); }, 10000);
    }
}

// 폴더 구조 수정 - 필요한 경우
function fixFolderStructureIfNeeded(extractToPath) {
    try {
        const items = fs.readdirSync(extractToPath);

        // 압축이 풀렸을 때 단일 폴더가 생겼고 그 안에 실제 내용물이 들어있는 경우
        // 예: py_env/python/ -> py_env/
        if (items.length === 1) {
            const singleItem = items[0];
            const singleItemPath = path.join(extractToPath, singleItem);

            // 단일 항목이 디렉토리인 경우
            if (fs.statSync(singleItemPath).isDirectory()) {
                console.log(`[INFO] 발견된 단일 폴더 '${singleItem}'의 내용을 상위로 이동합니다.`);

                // 내부 항목을 하나씩 상위로 이동
                const innerItems = fs.readdirSync(singleItemPath);
                for (const innerItem of innerItems) {
                    const srcPath = path.join(singleItemPath, innerItem);
                    const destPath = path.join(extractToPath, innerItem);

                    // 이미 존재하면 덮어쓰기 위해 삭제
                    if (fs.existsSync(destPath)) {
                        if (fs.statSync(destPath).isDirectory()) {
                            fs.rmSync(destPath, { recursive: true, force: true });
                        } else {
                            fs.unlinkSync(destPath);
                        }
                    }

                    // 이동
                    if (fs.statSync(srcPath).isDirectory()) {
                        // 디렉토리 복사 함수 (재귀적으로 복사)
                        copyDir(srcPath, destPath);
                    } else {
                        fs.copyFileSync(srcPath, destPath);
                    }
                    console.log(`  이동: ${innerItem}`);
                }

                // 원래 단일 폴더 삭제
                fs.rmSync(singleItemPath, { recursive: true, force: true });
                console.log(`[INFO] 폴더 구조 정리 완료`);
            }
        }
    } catch (err) {
        console.error(`[ERROR] 폴더 구조 정리 실패: ${err.message}`);
    }
}

// 디렉토리 복사 함수 (재귀적으로 복사)
function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (let entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

/** 메인 윈도우 생성 */
function createWindow() {
    const win = new BrowserWindow({
        width: 1000,
        height: 700,
        frame: false, // Remove the default frame/titlebar
        titleBarStyle: 'hidden', // Hide the title bar
        backgroundColor: '#1e1e1e', // Match your dark theme background color
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegrationInSubFrames: true,
            webviewTag: true
        },
    });
    win.loadFile('index.html');

    // Start maximized
    win.maximize();

    // Window control event handlers
    ipcMain.on('window:minimize', () => {
        win.minimize();
    });

    ipcMain.on('window:maximize', () => {
        if (win.isMaximized()) {
            win.unmaximize();
        } else {
            win.maximize();
        }
    });

    ipcMain.on('window:close', () => {
        win.close();
    });

    return win;
}

/** 로컬 서버 시작 */
// startLocalServer 함수를 비동기 함수로 변경
async function startLocalServer() {
    // 기존 프로세스 종료 - await를 사용하여 완전히 종료될 때까지 대기
    await kill_pyhpo();

    // 프로세스 종료 후 추가 안전 대기 시간 (ms)
    await new Promise(resolve => setTimeout(resolve, 1000));

    const { DevPyScripts, testLocalServerPy, base, pythonExe } = getPaths();
    let command, args;

    if (isDev) {
        // 개발 모드 - 시스템 Python으로 스크립트 직접 실행
        command = 'python';
        args = [DevPyScripts, '--root', __dirname];
    } else {
        // 배포 모드 - 내장 Python으로 tls.dll(Python 스크립트) 실행
        command = pythonExe;
        args = [testLocalServerPy, '--root', base];

        // Python 스크립트 존재 여부 확인
        if (!fs.existsSync(testLocalServerPy)) {
            console.error(`[ERROR] Server script not found at: ${testLocalServerPy}`);
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
            cwd: path.dirname(command), // Python 실행 파일이 있는 디렉토리로 변경
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

    const { base } = getPaths();
    const alignerScript = path.join(base, 'iqgen_scripts', 'xfeat_aligner.py');

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
    args = [alignerScript, baseLinePath, otherLinePath, '--root', path.join(base, 'iqgen_scripts')];

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
            if (event && event.sender && !event.sender.isDestroyed()) {
                event.sender.send('alignment:complete', {
                    success: false,
                    error: err.message
                });
            }
        });

        return true;
    } catch (err) {
        console.error('[ERROR] Failed to start XFeat aligner:', err);
        if (event && event.sender && !event.sender.isDestroyed()) {
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

    // 2. 외부 실행 중인 Python 프로세스 종료 (tls.dll을 실행 중인 프로세스)
    try {
        if (process.platform === 'win32') {
            // Windows의 경우 - taskkill 명령으로 Python 프로세스 중 tls.dll 관련 종료
            const { stdout, stderr } = await exec('taskkill /F /IM python.exe /FI "WINDOWTITLE eq *tls.dll*"');
            console.log('[INFO] Python process kill result:', stdout);
            if (stderr) console.error('[INFO] Python process kill stderr:', stderr);

            // 추가로 이름에 tls가 포함된 프로세스도 종료
            try {
                await exec('taskkill /F /FI "IMAGENAME eq python.exe" /FI "WINDOWTITLE eq *tls*"');
            } catch (err) {
                // 프로세스가 없는 경우 무시
            }
        } else {
            // Linux/Mac의 경우 - pkill 명령 사용
            try {
                // tls.dll 문자열을 포함하는 Python 프로세스 종료
                await exec("pkill -9 -f 'python.*tls.dll'");
                console.log('[INFO] Successfully killed Python processes running tls.dll');
            } catch (pkillError) {
                // 프로세스가 없는 경우 에러가 발생하지만 무시해도 됨
                console.log('[INFO] No Python processes running tls.dll found to kill');
            }
        }
    } catch (error) {
        // 프로세스가 없는 경우에도 에러가 발생하지만 무시해도 됨
        if (error.message.includes('not found') || error.message.includes('no process found')) {
            console.log('[INFO] No Python processes running tls.dll found to kill');
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
    // 방법 1: 내부 프로세스 참조 사용
    if (dashboardProcess) {
        console.log('[INFO] Killing dashboard process via process reference');

        // 1-1. Promise를 통한 종료 처리
        const killPromise = new Promise((resolve) => {
            dashboardProcess.on('close', () => {
                console.log('[INFO] Dashboard process terminated via kill()');
                resolve();
            });

            // 강제 종료 (SIGKILL)
            dashboardProcess.kill('SIGKILL');
            dashboardProcess = null;
        });

        // 1-2. 최대 2초까지만 대기
        const timeoutPromise = new Promise(resolve => setTimeout(resolve, 2000));
        await Promise.race([killPromise, timeoutPromise]);
    }

    // 방법 2: 시스템 명령어 사용 (OS별 다른 명령어 실행)
    try {
        // OS 타입 확인
        if (process.platform === 'win32') {
            // Windows: Python 프로세스 강제 종료
            console.log('[INFO] Trying to kill Python processes running optuna-dashboard (Windows)');
            await exec('taskkill /F /FI "WINDOWTITLE eq optuna-dashboard" /FI "IMAGENAME eq python.exe"');
            // 추가 명령어로 더 확실하게 종료
            await exec('taskkill /F /IM python.exe /FI "WINDOWTITLE eq *optuna*"');
        } else {
            // Linux/Mac: 여러 방법 시도
            console.log('[INFO] Trying to kill Python processes running optuna-dashboard (Linux/Mac)');

            // 1. pkill 명령 사용 (가장 정확한 방법)
            try {
                await exec("pkill -9 -f 'optuna_dashboard'");
                console.log('[INFO] Successfully killed dashboard with pkill -9');
            } catch (pkillError) {
                console.log('[INFO] pkill -9 attempt failed:', pkillError.message);
            }

            // 2. ps와 grep을 사용하여 PID 찾고 kill 명령 실행
            try {
                const { stdout } = await exec("ps -ef | grep 'optuna_dashboard' | grep -v grep | awk '{print $2}'");
                if (stdout.trim()) {
                    const pids = stdout.trim().split('\n');
                    for (const pid of pids) {
                        if (pid) {
                            console.log(`[INFO] Killing optuna dashboard process with PID: ${pid}`);
                            await exec(`kill -9 ${pid}`);
                        }
                    }
                }
            } catch (killError) {
                console.log('[INFO] kill attempt failed:', killError.message);
            }

            // 3. 포트 번호로 프로세스 찾기 (8080 포트 사용중)
            try {
                const { stdout: portStdout } = await exec("lsof -i :8080 | grep LISTEN | awk '{print $2}'");
                if (portStdout.trim()) {
                    const portPids = portStdout.trim().split('\n');
                    for (const pid of portPids) {
                        if (pid) {
                            console.log(`[INFO] Killing process using port 8080 with PID: ${pid}`);
                            await exec(`kill -9 ${pid}`);
                        }
                    }
                }
            } catch (portError) {
                console.log('[INFO] port-based kill attempt failed:', portError.message);
            }
        }
        console.log('[INFO] Finished killing external dashboard processes');
    } catch (error) {
        console.error('[ERROR] Kill dashboard process:', error.message);
    }

    // 안전 대기
    await new Promise(resolve => setTimeout(resolve, 1000));
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

// Add handler for checking if files exist
ipcMain.handle('fs:checkFilesExist', async (event, filePaths) => {
    const { base } = getPaths();

    try {
        const results = {};
        let allExist = true;

        for (const filePath of filePaths) {
            const fullPath = path.join(base, filePath);
            try {
                await fs.promises.access(fullPath, fs.constants.F_OK);
                results[filePath] = true;
            } catch (error) {
                results[filePath] = false;
                allExist = false;
            }
        }

        return {
            results,
            allExist
        };
    } catch (error) {
        console.error('Error checking file existence:', error);
        return {
            error: error.message,
            allExist: false
        };
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
        ? path.join(base, 'iqgen_scripts', 'hpo_client.py')
        : path.join(base, 'iqgen_scripts', 'hpo_client.py');

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
    args = [scriptPath, baseLinePath, otherLinePath, '--root', path.join(base, 'iqgen_scripts')];

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
    const scriptPath = path.join(base, 'iqgen_scripts', scriptName);

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
    scriptArgs = [scriptPath, ...args, '--root', path.join(base, 'iqgen_scripts')];
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
                reject(err);
            });
        } catch (err) {
            console.error(`[${scriptName}] error:`, err);
            reject(err);
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