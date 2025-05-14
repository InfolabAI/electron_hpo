// extract_without_asar.js - asar 모듈 없이 app.asar 내부의 main.js만 교체하는 스크립트
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 경로 설정
let targetAsarPath = path.join(__dirname, 'dist', 'HPOptimizer-win32-x64', 'resources', 'app.asar');
const fixedMainJsPath = path.join(__dirname, 'main.js');

// 커스텀 경로 입력 처리
if (process.argv.length > 2) {
    const customPath = process.argv[2];
    if (fs.existsSync(customPath)) {
        console.log(`사용자 지정 경로 사용: ${customPath}`);
        targetAsarPath = customPath;
    }
}

// 필요한 파일 존재 확인
if (!fs.existsSync(fixedMainJsPath)) {
    console.error('수정된 main.js 파일을 찾을 수 없습니다.');
    process.exit(1);
}

if (!fs.existsSync(targetAsarPath)) {
    console.error(`app.asar 파일을 찾을 수 없습니다: ${targetAsarPath}`);
    console.error('다른 경로를 지정하려면: node extract_without_asar.js [경로] 형식으로 실행하세요');
    process.exit(1);
}

// 작업 디렉토리 설정
const tempDir = path.join(__dirname, 'temp_app');
const appDir = path.join(__dirname, 'dist', 'HPOptimizer-win32-x64', 'resources', 'app');

// 기존 app 디렉토리 백업 (있는 경우)
if (fs.existsSync(appDir)) {
    console.log('기존 app 디렉토리 백업 중...');
    const appBackupDir = `${appDir}_backup`;
    if (fs.existsSync(appBackupDir)) {
        fs.rmSync(appBackupDir, { recursive: true, force: true });
    }
    fs.renameSync(appDir, appBackupDir);
}

// 임시 디렉토리 정리
if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
}
fs.mkdirSync(tempDir, { recursive: true });

// app.asar 파일 백업
console.log('app.asar 파일 백업 중...');
const backupPath = `${targetAsarPath}.backup`;
if (fs.existsSync(backupPath)) {
    fs.unlinkSync(backupPath);
}
fs.copyFileSync(targetAsarPath, backupPath);

// app 디렉토리 생성
console.log('app 디렉토리 생성 중...');
fs.mkdirSync(appDir, { recursive: true });

// 외부 명령으로 asar 압축 해제 (npm install -g asar로 전역 설치 필요)
try {
    console.log('asar 명령으로 압축 해제 시도...');
    execSync(`asar extract "${targetAsarPath}" "${tempDir}"`, { stdio: 'inherit' });

    // main.js 교체
    console.log('main.js 파일 교체 중...');
    fs.copyFileSync(fixedMainJsPath, path.join(tempDir, 'main.js'));

    // 필요한 파일들을 app 디렉토리로 복사
    console.log('필수 파일 복사 중...');
    copyDir(tempDir, appDir);

    console.log('app.asar 파일 제거 중...');
    fs.unlinkSync(targetAsarPath);

    console.log('\n작업이 성공적으로 완료되었습니다!');
    console.log(`이제 app.asar 대신 app 디렉토리를 사용합니다.`);
    console.log(`원본 파일은 ${backupPath}에 백업되었습니다.`);
} catch (err) {
    console.error(`오류 발생: ${err.message}`);

    // 복원 시도
    console.log('오류 발생으로 인한 복원 시도...');
    if (fs.existsSync(appDir)) {
        fs.rmSync(appDir, { recursive: true, force: true });
    }

    // 백업에서 app.asar 복원
    fs.copyFileSync(backupPath, targetAsarPath);

    // 백업한 app 디렉토리 복원 (있었던 경우)
    const appBackupDir = `${appDir}_backup`;
    if (fs.existsSync(appBackupDir)) {
        fs.renameSync(appBackupDir, appDir);
    }

    console.error('원래 상태로 복원되었습니다.');
    process.exit(1);
} finally {
    // 임시 디렉토리 정리
    if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

// 디렉토리 복사 함수
function copyDir(src, dest) {
    // 대상 디렉토리가 없으면 생성
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }

    // 소스 디렉토리의 모든 파일 및 디렉토리 읽기
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        // 디렉토리인 경우 재귀적으로 복사
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        }
        // 파일인 경우 복사
        else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
} 