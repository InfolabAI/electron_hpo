const { contextBridge, ipcRenderer } = require('electron');

// 렌더러 프로세스에 노출할 API
contextBridge.exposeInMainWorld('electronAPI', {
    // 디렉토리 선택 대화상자 열기
    openDirectoryDialog: (options) => ipcRenderer.invoke('dialog:openDirectory', options),

    // 디렉토리 읽기 및 파일 목록 가져오기
    readDirectory: (path) => ipcRenderer.invoke('fs:readDirectory', path),

    // 디렉토리 존재 여부 확인
    directoryExists: (path) => ipcRenderer.invoke('fs:directoryExists', path),

    // 메시지 박스 표시
    showMessageBox: (options) => ipcRenderer.invoke('dialog:showMessageBox', options),

    // 이미지 파일 처리 (예: 경로로부터 이미지 로드)
    processImages: (sourcePath, targetPath) => ipcRenderer.invoke('image:process', { sourcePath, targetPath }),

    // 모델 배포
    deployModel: (sourcePath, targetPath) => ipcRenderer.invoke('model:deploy', { sourcePath, targetPath }),

    // 로그 메시지 전송
    logMessage: (message) => ipcRenderer.send('log:message', message),

    // 이미지 정렬 실행
    alignImages: (baseLinePath, otherLinePath) => {
        ipcRenderer.send('image:align', { baseLinePath, otherLinePath });
    },

    // 정렬 진행 상황 이벤트 리스너
    onAlignmentProgress: (callback) => {
        ipcRenderer.on('alignment:progress', (_, progress) => callback(progress));
    },

    // 정렬 완료 이벤트 리스너
    onAlignmentComplete: (callback) => {
        ipcRenderer.on('alignment:complete', (_, result) => callback(result));
    }
});

// 페이지 로드 완료 시 로그 메시지 전송
window.addEventListener('DOMContentLoaded', () => {
    ipcRenderer.send('log:message', 'IQGen 페이지가 로드되었습니다.');
    console.log('preload-iqgen.js: DOM이 로드되었습니다.');
}); 