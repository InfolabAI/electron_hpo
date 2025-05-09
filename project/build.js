const packager = require('electron-packager');
const fs = require('fs');
const path = require('path');

// 추가 리소스 정의
const extraResources = [
    { from: 'db.sqlite3', to: 'db.sqlite3' },
    { from: 'json_files', to: 'json_files' },
    { from: 'hpo_env_win.zip', to: 'hpo_env_win.zip' },
    { from: 'python_scripts/test_local_server.py', to: 'scripts/tls.dll' },
    { from: 'iqgen_scripts', to: 'iqgen_scripts' },
    { from: 'license.key', to: 'license.key' }
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
            asar: true
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
    } catch (err) {
        console.error('Build failed:', err);
        process.exit(1);
    }
}

packageApp(); 