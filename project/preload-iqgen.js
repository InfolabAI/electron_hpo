const { contextBridge, ipcRenderer } = require('electron');

// 렌더러 프로세스에 노출할 API
contextBridge.exposeInMainWorld('electronAPI', {
    // 디렉토리 선택 대화상자 열기
    openDirectoryDialog: (options) => ipcRenderer.invoke('dialog:openDirectory', options),

    // 디렉토리 읽기 및 파일 목록 가져오기
    readDirectory: (path) => ipcRenderer.invoke('fs:readDirectory', path),

    // 디렉토리 존재 여부 확인
    directoryExists: (path) => ipcRenderer.invoke('fs:directoryExists', path),

    // 파일 존재 여부 확인
    checkFilesExist: (filePaths) => ipcRenderer.invoke('fs:checkFilesExist', filePaths),

    // 메시지 박스 표시
    showMessageBox: (options) => ipcRenderer.invoke('dialog:showMessageBox', options),

    // 이미지 파일 처리 (예: 경로로부터 이미지 로드)
    processImages: (sourcePath, targetPath) => ipcRenderer.invoke('image:process', { sourcePath, targetPath }),

    // 모델 배포
    deployModel: (options) => ipcRenderer.invoke('model:deploy', options),

    // Python 스크립트 실행 (dist_onnx.py 등)
    runPythonScript: (options) => ipcRenderer.invoke('python:run', options),

    // Python 스크립트 진행 상황 이벤트 리스너
    onPythonScriptProgress: (callback) => {
        // 기존 리스너 제거 후 새로 등록 (중복 등록 방지)
        ipcRenderer.removeAllListeners('python:progress');

        // 이벤트 리스너 등록 및 로깅 추가
        console.log('Registering python:progress event listener');

        ipcRenderer.on('python:progress', (_, data) => {
            console.log('Received python:progress event:', data);
            callback(data);
        });
    },

    // 직접 IPC 이벤트 접근을 위한 인터페이스 추가
    ipcRenderer: {
        on: (channel, callback) => {
            if (channel === 'python:progress') {
                ipcRenderer.on(channel, callback);
            }
        },
        removeListener: (channel, callback) => {
            if (channel === 'python:progress') {
                ipcRenderer.removeListener(channel, callback);
            }
        }
    },

    // 로그 메시지 전송
    logMessage: (message) => ipcRenderer.send('log:message', message),

    // 이미지 정렬 실행
    alignImages: (baseLinePath, otherLinePath) => {
        ipcRenderer.send('image:align', { baseLinePath, otherLinePath });
    },

    // 정렬 진행 상황 이벤트 리스너
    onAlignmentProgress: (callback) => {
        // 기존 리스너 제거 후 새로 등록 (중복 등록 방지)
        ipcRenderer.removeAllListeners('alignment:progress');
        ipcRenderer.on('alignment:progress', (_, progress) => callback(progress));
    },

    // 정렬 완료 이벤트 리스너
    onAlignmentComplete: (callback) => {
        // 기존 리스너 제거 후 새로 등록 (중복 등록 방지)
        ipcRenderer.removeAllListeners('alignment:complete');
        ipcRenderer.on('alignment:complete', (_, result) => callback(result));
    },

    // HPO ONNX 스크립트 실행
    runHpoOnnx: (baseLinePath, otherLinePath) => {
        // 디버그 로깅 추가
        console.log('Sending HPO request for paths:', baseLinePath, otherLinePath);
        ipcRenderer.send('hpo:run', { baseLinePath, otherLinePath });
    },

    // HPO 증강 진행 상황 이벤트 리스너
    onAugmentationProgress: (callback) => {
        // 기존 리스너 제거 후 새로 등록 (중복 등록 방지)
        ipcRenderer.removeAllListeners('hpo:progress');
        ipcRenderer.on('hpo:progress', (_, data) => {
            console.log('Received HPO progress:', data);
            callback(data);
        });
    },

    // HPO 프로세스 상태 확인
    checkHpoStatus: () => ipcRenderer.invoke('hpo:checkStatus'),

    // HPO 프로세스 종료
    killHpoProcess: () => ipcRenderer.invoke('hpo:kill'),

    // 탭 전환 이벤트 리스너
    onTabEvent: (callback) => {
        // 기존 리스너 제거 후 새로 등록
        ipcRenderer.removeAllListeners('tab:focus');
        ipcRenderer.removeAllListeners('tab:activated');

        // 탭 포커스 이벤트
        ipcRenderer.on('tab:focus', () => {
            console.log('Tab focus event received');
            callback('focus');
        });

        // 탭 활성화 이벤트
        ipcRenderer.on('tab:activated', () => {
            console.log('Tab activated event received');
            callback('activated');
        });
    }
});

// 페이지 로드 완료 시 로그 메시지 전송
window.addEventListener('DOMContentLoaded', () => {
    ipcRenderer.send('log:message', 'IQGen 페이지가 로드되었습니다.');
    console.log('preload-iqgen.js: DOM이 로드되었습니다.');
}); 