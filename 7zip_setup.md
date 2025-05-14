# 7-Zip Setup for HPOptimizer Portable Distribution

## 문제 해결: 7-Zip 바이너리 오류 및 기타 에러

Windows 포터블 배포 버전에서 다음과 같은 오류가 발생할 때 설정 방법입니다:

```
[INFO] Using 7-Zip at: C:\Users\robert.lim\Documents\HPO\output\HPOptimizer-win32-x64\node_modules\7zip-bin\win\x64\7z.exe
[ERROR] Decompression failed: 7-Zip executable not found at: C:\Users\robert.lim\Documents\HPO\output\HPOptimizer-win32-x64\node_modules\7zip-bin\win\x64\7z.exe
Initialization error: ReferenceError: statusWindow is not defined
```

또는 다음과 같은 오류:

```
Initialization error: ReferenceError: log is not defined
    at ensurePythonEnv (C:\Users\robert.lim\Documents\HPO\HPOptimizer_output\HPOptimizer-win32-x64\resources\app.asar\main.js:421:9)
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
    at async C:\Users\robert.lim\Documents\HPO\HPOptimizer_output\HPOptimizer-win32-x64\resources\app.asar\main.js:845:9
(node:18188) MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 did-stop-loading listeners added to [WebContents]. Use emitter.setMaxListeners() to increase limit
```

## 해결 방법 

### 1. 자동 설정 방법 (권장)

최신 버전의 코드는 `build.js` 파일에 자동으로 7-Zip 바이너리를 리소스 폴더에 복사하는 기능이 추가되어 있습니다. 따라서 `npm run build` 명령어로 빌드하면 필요한 파일이 자동으로 포함됩니다.

### 2. 수동 설정 방법 (자동 설정이 실패한 경우)

1. 배포 패키지 내 `resources` 폴더를 찾습니다.
2. `resources` 폴더 내에 다음 디렉토리 구조를 만듭니다:
   ```
   resources/
   └── 7zip/
       └── win/
           └── x64/
               └── 7z.exe   (이 파일을 복사)
   ```

3. 필요한 7z.exe 파일은 개발 환경의 다음 경로에서 복사할 수 있습니다:
   - 개발 환경: `node_modules/7zip-bin/win/x64/7z.exe`
   - Linux/macOS 지원을 위해 다음 경로도 필요한 경우 복사하세요:
     - Linux: `node_modules/7zip-bin/linux/x64/7za`
     - macOS: `node_modules/7zip-bin/mac/x64/7za`

## 테스트 방법

설정 후 다음을 확인하세요:

1. 앱 실행 시 더 이상 7-Zip 관련 오류가 발생하지 않아야 합니다.
2. Python 환경 압축 해제가 정상적으로 진행되어야 합니다.

## 코드 변경 내용 요약

1. `main.js`: 
   - 7-Zip 바이너리 경로 로직 개선 (배포 모드일 때 `resources` 내에서 검색)
   - `statusWindow` 변수 전역화하여 참조 오류 해결
   - 존재하지 않는 `log` 함수를 `console.log`로 대체
   - `global.statusWindow` 사용 시 null 체크 추가
   - 이벤트 리스너 메모리 누수 경고 해결을 위해 최대 리스너 수 증가

2. `build.js`: 
   - 빌드 시 7-Zip 바이너리를 리소스 폴더에 자동 복사하도록 설정

3. `statusWindow.js`: 
   - 전역 `statusWindow` 변수 사용하도록 수정 