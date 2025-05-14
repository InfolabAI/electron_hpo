const packager = require('electron-packager');
const installer = require('electron-winstaller');
const fs = require('fs');
const path = require('path');
const Seven = require('node-7z');
const sevenBin = require('7zip-bin');

// 추가 리소스 정의
const extraResources = [
    { from: 'db.sqlite3', to: 'db.sqlite3' },
    { from: 'json_files', to: 'json_files' },
    { from: 'hpo_env_win.zip', to: 'hpo_env_win.zip' },
    { from: 'python_scripts/test_local_server.py', to: 'scripts/tls.dll' },
    { from: 'iqgen_scripts', to: 'iqgen_scripts' },
    { from: 'license.key', to: 'license.key' },
    { from: 'node_modules/7zip-bin/win/x64', to: '7zip/win/x64' }, // 7zip 바이너리 추가 (Windows)
    { from: 'node_modules/7zip-bin/linux/x64', to: '7zip/linux/x64' }, // 7zip 바이너리 추가 (Linux)
    { from: 'node_modules/7zip-bin/mac/x64', to: '7zip/mac/x64' } // 7zip 바이너리 추가 (macOS)
];

// 디렉토리 복사 함수
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

// 파일 복사 함수
function copyFile(src, dest) {
    const destDir = path.dirname(dest);
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(src, dest);
}

// ZIP 파일 압축 해제 함수
async function extractZipFile(zipFilePath, extractToPath) {
    return new Promise((resolve, reject) => {
        // OS에 맞는 7-Zip 바이너리 경로 확인
        let zipPath;
        if (process.platform === 'linux') {
            zipPath = path.join(process.cwd(), 'node_modules/7zip-bin/linux/x64/7za');
        } else if (process.platform === 'win32') {
            zipPath = path.join(process.cwd(), 'node_modules/7zip-bin/win/x64/7za.exe');
        } else if (process.platform === 'darwin') {
            zipPath = path.join(process.cwd(), 'node_modules/7zip-bin/mac/x64/7za');
        } else {
            zipPath = sevenBin.path7;
        }

        console.log(`[INFO] Using 7-Zip at: ${zipPath}`);

        // 압축 풀기 경로가 없으면 생성
        fs.mkdirSync(extractToPath, { recursive: true });

        // node-7z 대신 직접 7z 명령어 실행하여 폴더 구조 유지
        const { spawn } = require('child_process');

        // 명령어 구성 (OS에 따라 달라짐)
        const args = ['x', zipFilePath, `-o${extractToPath}`, '-y'];
        console.log(`[INFO] Executing command: ${zipPath} ${args.join(' ')}`);

        const process7z = spawn(zipPath, args);

        // 진행 상황 로깅
        process7z.stdout.on('data', (data) => {
            console.log(`[7z] ${data.toString().trim()}`);
        });

        process7z.stderr.on('data', (data) => {
            console.error(`[7z Error] ${data.toString().trim()}`);
        });

        process7z.on('close', (code) => {
            if (code === 0) {
                console.log(`[INFO] ZIP 파일 압축 해제 완료: ${zipFilePath} -> ${extractToPath}`);

                // 폴더 구조 검증
                console.log(`[INFO] 압축 해제된 디렉토리 내용 검사:`);
                try {
                    // 최상위 항목만 나열
                    const items = fs.readdirSync(extractToPath, { withFileTypes: true });
                    items.forEach(item => {
                        const itemPath = path.join(extractToPath, item.name);
                        const stats = fs.statSync(itemPath);
                        if (stats.isDirectory()) {
                            console.log(`  폴더: ${item.name} (${fs.readdirSync(itemPath).length}개 항목)`);
                        } else {
                            console.log(`  파일: ${item.name} (${stats.size} bytes)`);
                        }
                    });
                } catch (err) {
                    console.error(`[ERROR] 디렉토리 내용 검사 실패: ${err.message}`);
                }

                resolve();
            } else {
                const errMsg = `7-Zip process exited with code ${code}`;
                console.error(`[ERROR] ${errMsg}`);
                reject(new Error(errMsg));
            }
        });
    });
}

// 패키징 후 리소스 복사
async function packageApp() {
    try {
        console.log('Packaging app with electron-packager...');
        const appPaths = await packager({
            dir: '.',
            name: 'HPOptimizer',
            platform: 'win32',
            arch: 'x64',
            out: 'dist',
            overwrite: true,
            asar: true,
            ignore: [
                /^\/db\.sqlite3$/,
                /^\/json_files(\/|$)/,
                /^\/hpo_env_win\.zip$/,
                /^\/python_scripts(\/|$)/,
                /^\/iqgen_scripts(\/|$)/,
                /^\/license\.key$/
            ]
        });

        const appPath = appPaths[0]; // 첫 번째 패키지 경로
        const resourcesDir = path.join(appPath, 'resources');

        console.log(`App packaged at: ${appPath}`);
        console.log(`Copying extra resources to: ${resourcesDir}`);

        // 추가 리소스 복사
        for (const resource of extraResources) {
            const src = path.resolve(__dirname, resource.from);
            const dest = path.join(resourcesDir, resource.to);

            try {
                if (fs.existsSync(src)) {
                    if (fs.statSync(src).isDirectory()) {
                        copyDir(src, dest);
                        console.log(`Copied directory: ${resource.from} -> ${resource.to}`);
                    } else {
                        copyFile(src, dest);
                        console.log(`Copied file: ${resource.from} -> ${resource.to}`);
                    }
                } else {
                    console.warn(`Warning: Source not found: ${src}`);
                }
            } catch (err) {
                console.error(`Error copying ${resource.from}: ${err.message}`);
            }
        }

        console.log('Build completed successfully!');

        // hpo_env_win.zip 압축 해제
        //const zipFilePath = path.join(resourcesDir, 'hpo_env_win.zip');
        //const extractToPath = path.join(resourcesDir, 'py_env');

        //if (fs.existsSync(zipFilePath)) {
        //    console.log(`Extracting ${zipFilePath} to ${extractToPath}...`);
        //    await extractZipFile(zipFilePath, extractToPath);

        //    // 해제 후 폴더 구조 정리 - 필요한 경우 폴더 구조 수정
        //    console.log('Verifying folder structure...');
        //    fixFolderStructureIfNeeded(extractToPath);

        //    // 압축 해제 후 원본 ZIP 파일 삭제
        //    console.log(`Deleting original ZIP file: ${zipFilePath}`);
        //    fs.unlinkSync(zipFilePath);
        //    console.log('Original ZIP file deleted successfully');
        //} else {
        //    console.warn(`Warning: ZIP file not found: ${zipFilePath}`);
        //}

        // 설치 파일 생성 시작
        // console.log('Creating Windows installer...');
        // await createWindowsInstaller(appPath);

        console.log('All tasks completed successfully!');
    } catch (err) {
        console.error('Build failed:', err);
        process.exit(1);
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

// Windows 설치 파일 생성
async function createWindowsInstaller(appPath) {
    try {
        const outputDirectory = path.join(__dirname, 'dist', 'installer');

        // 설치 파일 생성 옵션
        const result = await installer.createWindowsInstaller({
            appDirectory: appPath,
            outputDirectory: outputDirectory,
            authors: 'HPOptimizer Team',
            exe: 'HPOptimizer.exe',
            name: 'HPOptimizer',
            title: 'HPOptimizer',
            description: 'HPOptimizer Application',
            noMsi: true,
            setupExe: 'HPOptimizer-Setup.exe'
        });

        console.log(`Windows installer created at: ${outputDirectory}`);
        return result;
    } catch (err) {
        console.error('Failed to create Windows installer:', err);
        throw err;
    }
}

packageApp(); 