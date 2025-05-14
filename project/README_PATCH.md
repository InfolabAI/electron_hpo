# HPOptimizer 패치 적용 가이드

이 패치는 배포된 HPOptimizer 애플리케이션에서 발생하는 다음 문제들을 해결합니다:

1. `7-Zip executable not found` 오류 - 배포판에서 7z.exe 경로 문제
2. `ReferenceError: statusWindow is not defined` 오류 - 상태창 참조 오류
3. `ReferenceError: log is not defined` 오류 - log 함수 참조 오류
4. `MaxListenersExceededWarning` 경고 - 이벤트 리스너 메모리 누수 경고

## 패치 적용 방법

### Windows 사용자

1. 패치 파일들(`replace_main.js`, `patch_installer.bat`, `main.js`)을 HPOptimizer 배포 패키지가 있는 디렉토리에 복사합니다.
2. `patch_installer.bat` 파일을 더블 클릭하여 실행합니다.
3. 설치 과정이 완료될 때까지 기다립니다.
4. 패치가 적용된 후, HPOptimizer를 다시 실행하여 문제가 해결되었는지 확인합니다.

### Linux/macOS 사용자

1. 패치 파일들(`replace_main.js`, `patch_installer.sh`, `main.js`)을 HPOptimizer 배포 패키지가 있는 디렉토리에 복사합니다.
2. 터미널을 열고 패치 파일이 있는 디렉토리로 이동합니다:
   ```
   cd /path/to/hpoptimizer/directory
   ```
3. 실행 권한을 부여합니다:
   ```
   chmod +x patch_installer.sh
   ```
4. 패치 설치 스크립트를 실행합니다:
   ```
   ./patch_installer.sh
   ```
5. 설치 과정이 완료될 때까지 기다립니다.
6. 패치가 적용된 후, HPOptimizer를 다시 실행하여 문제가 해결되었는지 확인합니다.

## 주의사항

- 패치를 적용하기 전에 HPOptimizer 애플리케이션이 실행 중이라면 종료해주세요.
- 패치를 적용하면 원본 `app.asar` 파일의 백업(`app.asar.backup`)이 생성됩니다.
- 문제가 발생하면 이 백업 파일로 복원할 수 있습니다.
- Node.js가 설치되어 있어야 패치를 적용할 수 있습니다. 설치되어 있지 않은 경우 [Node.js 웹사이트](https://nodejs.org/)에서 다운로드하여 설치해주세요.

## 패치 내용 설명

1. **7-Zip 경로 문제 해결**
   - 수정된 main.js 파일은 배포 환경에서 7-Zip 바이너리를 `resources` 폴더 내에서 찾도록 수정되었습니다.
   - 패치 프로세스는 필요한 7-Zip 바이너리 파일을 배포 패키지의 적절한 위치에 복사합니다.

2. **statusWindow 참조 오류 해결**
   - 전역 변수로 statusWindow를 선언하고 관리하여 모듈 간 참조 문제를 해결했습니다.

3. **log 함수 참조 오류 해결**
   - 존재하지 않는 `log` 함수 호출을 `console.log`로 대체했습니다.

4. **이벤트 리스너 경고 해결**
   - 최대 이벤트 리스너 수를 20으로 늘려 메모리 누수 경고를 방지합니다.

## 문제 해결

패치 적용 후에도 문제가 계속 발생하는 경우:

1. 원본 상태로 복원하려면 생성된 백업 파일(`app.asar.backup`)의 이름을 `app.asar`로 변경하세요.
2. Node.js가 올바르게 설치되어 있는지 확인하세요.
3. 패치 적용 중 발생한 오류 메시지를 개발자에게 보고해주세요.

## 개발자 정보

이 패치는 HPOptimizer의 배포 모드에서 발생하는 특정 문제를 해결하기 위해 개발되었습니다. 추가 지원이 필요하거나 새로운 문제가 발견되면 개발팀에 문의해주세요. 