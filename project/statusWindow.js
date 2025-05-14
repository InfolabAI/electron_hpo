// statusWindow.js
const { BrowserWindow } = require('electron');

/**
 * 새 창을 열고, 초기 HTML 문자열을 로드
 * 이미 열려 있으면 일단 닫고 다시 엽니다(필요에 따라 변경 가능).
 */
function openStatusWindow(content) {
    // 이미 열려 있다면 닫는다
    if (global.statusWindow) {
        global.statusWindow.close();
        global.statusWindow = null;
    }

    global.statusWindow = new BrowserWindow({
        width: 500,
        height: 350,
        title: '진행 상태',
        frame: false,
        // 필요 시 webPreferences 설정
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    global.statusWindow.setMenu(null);

    // 기본 HTML 템플릿 - 스타일과 컨테이너 포함
    const htmlTemplate = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>진행 상태</title>
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                margin: 0;
                padding: 20px;
                background-color: #f5f5f5;
                color: #333;
            }
            h1 {
                font-size: 18px;
                margin-bottom: 15px;
                color: #2c3e50;
            }
            .container {
                background-color: white;
                border-radius: 6px;
                padding: 20px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .log-container {
                margin-top: 15px;
                max-height: 180px;
                overflow-y: auto;
                border-top: 1px solid #eee;
                padding-top: 10px;
            }
            .log-entry {
                margin: 8px 0;
                padding: 6px;
                border-left: 3px solid #007aff;
                background-color: #f8f9fa;
                padding-left: 10px;
                font-size: 13px;
            }
            .progress-container {
                margin: 20px 0;
            }
            .progress-bar {
                height: 20px;
                background-color: #e9ecef;
                border-radius: 10px;
                overflow: hidden;
                position: relative;
            }
            .progress-fill {
                height: 100%;
                background-color: #007aff;
                border-radius: 10px;
                width: 0%;
                transition: width 0.3s ease;
            }
            .progress-text {
                position: absolute;
                width: 100%;
                text-align: center;
                top: 50%;
                transform: translateY(-50%);
                font-size: 12px;
                font-weight: bold;
                color: white;
                text-shadow: 0 0 3px rgba(0,0,0,0.5);
            }
            .status {
                margin-top: 8px;
                font-size: 14px;
                font-weight: 500;
            }
            .success {
                color: #28a745;
            }
            .error {
                color: #dc3545;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>환경 초기화</h1>
            <h5>처음 실행에만 진행되며, 모두 완료되면 자동으로 메인화면이 열립니다. 기다려주세요. 이후에는 이 과정이 필요하지 않습니다.</h5>
            <div class="progress-container">
                <div class="progress-bar">
                    <div class="progress-fill" id="progressFill"></div>
                    <div class="progress-text" id="progressText">0%</div>
                </div>
                <div class="status" id="statusText">${content}</div>
            </div>
            <div class="log-container" id="logContainer"></div>
        </div>
    </body>
    </html>
    `;

    // data URL 방식으로 HTML 문자열 직접 로드
    global.statusWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlTemplate)}`);

    // 창이 닫힐 때 참조 해제 (원하지 않으면 생략 가능)
    global.statusWindow.on('closed', () => {
        global.statusWindow = null;
    });

    return global.statusWindow;
}

/**
 * 이미 열린 statusWindow에 메시지를 추가하거나 진행률 업데이트
 * @param {string|object} data - 문자열 메시지 또는 {progress: 숫자, message: 문자열} 형태의 객체
 */
function updateStatusWindow(data) {
    if (!global.statusWindow) return;

    try {
        // 데이터 타입 확인 (문자열 또는 객체)
        if (typeof data === 'string') {
            // 단순 로그 메시지 추가
            const escapedContent = data
                .replace(/\\/g, '\\\\')
                .replace(/'/g, "\\'")
                .replace(/"/g, '\\"');

            global.statusWindow.webContents.executeJavaScript(`
                const logEntry = document.createElement('div');
                logEntry.className = 'log-entry';
                logEntry.textContent = '${escapedContent}';
                document.getElementById('logContainer').appendChild(logEntry);
                document.getElementById('logContainer').scrollTop = document.getElementById('logContainer').scrollHeight;
                document.getElementById('statusText').textContent = '${escapedContent}';
            `).catch(err => {
                console.error('Status window update failed:', err);
            });
        }
        // 진행률을 포함한 객체
        else if (data && typeof data === 'object' && data.progress !== undefined) {
            const progress = Math.min(100, Math.max(0, data.progress)); // 0-100 범위로 제한
            const statusText = data.message || `압축 해제 진행률: ${progress}%`;

            // 진행률과 메시지 업데이트
            global.statusWindow.webContents.executeJavaScript(`
                document.getElementById('progressFill').style.width = '${progress}%';
                document.getElementById('progressText').textContent = '${progress}%';
                document.getElementById('statusText').textContent = '${statusText}';
                
                // 진행률이 100%면 성공 스타일 적용
                if (${progress} === 100) {
                    document.getElementById('statusText').classList.add('success');
                }
            `).catch(err => {
                console.error('Progress update failed:', err);
            });

            // 진행률이 아닌 별도의 메시지가 있으면 로그에 추가
            if (data.message) {
                const escapedMessage = data.message
                    .replace(/\\/g, '\\\\')
                    .replace(/'/g, "\\'")
                    .replace(/"/g, '\\"');

                global.statusWindow.webContents.executeJavaScript(`
                    const logEntry = document.createElement('div');
                    logEntry.className = 'log-entry';
                    logEntry.textContent = '${escapedMessage}';
                    document.getElementById('logContainer').appendChild(logEntry);
                    document.getElementById('logContainer').scrollTop = document.getElementById('logContainer').scrollHeight;
                `).catch(err => {
                    console.error('Log update failed:', err);
                });
            }
        }
    } catch (err) {
        console.error('Status window update error:', err);
    }
}

/**
 * 상태 창을 직접 닫기
 */
function closeStatusWindow() {
    if (global.statusWindow) {
        global.statusWindow.close();
        global.statusWindow = null;
    }
}


// 함수 3개 export
module.exports = {
    openStatusWindow,
    updateStatusWindow,
    closeStatusWindow,
};
