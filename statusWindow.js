// statusWindow.js
const { BrowserWindow } = require('electron');

let statusWindow = null;

/**
 * 새 창을 열고, 초기 HTML 문자열을 로드
 * 이미 열려 있으면 일단 닫고 다시 엽니다(필요에 따라 변경 가능).
 */
function openStatusWindow(content) {
    // 이미 열려 있다면 닫는다
    if (statusWindow) {
        statusWindow.close();
        statusWindow = null;
    }

    statusWindow = new BrowserWindow({
        width: 400,
        height: 300,
        title: '작업 상태',
        // 필요 시 webPreferences 설정
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    // data URL 방식으로 HTML 문자열 직접 로드
    statusWindow.loadURL(
        'data:text/html;charset=utf-8,' + encodeURI(content)
    );

    // 창이 닫힐 때 참조 해제 (원하지 않으면 생략 가능)
    statusWindow.on('closed', () => {
        statusWindow = null;
    });

    return statusWindow;
}

/**
 * 이미 열린 statusWindow에 메시지를 추가
 */
function updateStatusWindow(newLog) {
    if (!statusWindow) return;

    statusWindow.webContents.executeJavaScript(`
        document.body.insertAdjacentHTML('beforeend', '<div>${newLog}</div>');
    `);
}

/**
 * 상태 창을 직접 닫기
 */
function closeStatusWindow() {
    if (statusWindow) {
        statusWindow.close();
        statusWindow = null;
    }
}


// 함수 3개 export
module.exports = {
    openStatusWindow,
    updateStatusWindow,
    closeStatusWindow,
};